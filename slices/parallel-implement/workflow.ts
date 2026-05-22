import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AcceptanceContract } from '@goose-hub/core/acceptance-contracts/types.js';
import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import {
  type EffectiveDevReviewConfig,
  getDiffForDevReview,
  resolveDevReviewConfig,
  runDevReview,
  runDevReviewResponse,
  shouldRunDevReview,
} from '@goose-hub/core/agent-runtime/dev-review-advisor.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import {
  latestInvestigationContext,
  pathsTouchInvestigationSurface,
} from '@goose-hub/core/agent-runtime/investigation-context.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { resolveGlobalSettingsForProject } from '@goose-hub/core/agent-runtime/resolve-for-project.js';
import { resolveProjectAgentExecution } from '@goose-hub/core/agent-runtime/resolve-runtime-for-project.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { openPR } from '@goose-hub/core/connectors/github/open-pr.js';
import type { AgentEvent, AppendEventInput } from '@goose-hub/core/event-stream/store.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { resolveLatestPrd } from '@goose-hub/core/prd/read-model.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import {
  type ObservedChangedFilesPacket,
  deriveObservedChangedFiles,
} from '@goose-hub/core/workspaces/observed-changes.js';
import {
  cleanupAllWpWorktrees,
  createWpScratchWorktree,
  orchestratorCommitAll,
  orchestratorCommitWp,
  revertWpChanges,
} from '@goose-hub/core/workspaces/orchestrator-git.js';
import {
  type cleanupWorktree,
  createWorktree,
  prewarmWorktree,
  resolveWorkflowBase,
} from '@goose-hub/core/workspaces/worktree.js';
import { ImplementWpSchema } from '@goose-hub/skills/implement-wp/schema.js';
import type { EngineeringSpec } from '@goose-hub/skills/spec-author/schema.js';
import { normalizeEngineeringSpecPaths } from '../spec-author/path-normalization.js';
import { buildPrdPlanningContext } from '../spec-author/prd-planning-context.js';
import {
  type WpDispatchResult,
  buildParallelPrBody,
  getLastWpStatus,
  recordWpIteration,
  runWithConcurrencyCap,
} from './parallel-helpers.js';
import { runOneWpBuilder } from './wp-builder.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type { WpDispatchResult } from './parallel-helpers.js';

export type ParallelImplementWorkflowResult =
  | { status: 'success'; devRunId: string; worktreePath: string; prNumber: number; prUrl: string }
  | { status: 'failed'; devRunId: string; errorReason: string };

export interface ParallelImplementDeps {
  runtime?: AgentRuntime;
  /** Separate runtime for the dev-review Codex pass (defaults to auto-selected Codex runtime). */
  devReviewRuntime?: AgentRuntime;
  /** Separate runtime for the dev-review-response pass (defaults to project skill settings). */
  devReviewResponseRuntime?: AgentRuntime;
  openPRImpl?: typeof openPR;
  createWpWorktreeImpl?: typeof createWpScratchWorktree;
  createIssueWorktreeImpl?: typeof createWorktree;
  /** Override dependency prewarm for tests or alternate package managers. */
  prewarmWorktreeImpl?: typeof prewarmWorktree;
  resolveWorkflowBaseImpl?: typeof resolveWorkflowBase;
  cleanupWpWorktreesImpl?: typeof cleanupAllWpWorktrees;
  cleanupIssueWorktreeImpl?: typeof cleanupWorktree;
  orchestratorCommitWpImpl?: typeof orchestratorCommitWp;
  revertWpChangesImpl?: typeof revertWpChanges;
  recordIterationImpl?: typeof recordWpIteration;
  getLastStatusImpl?: typeof getLastWpStatus;
  appendEvent?: (input: AppendEventInput) => AgentEvent;
  /** Override getDiffForDevReview for testing. */
  getDiffImpl?: (worktreePath: string, baseBranch?: string) => string;
  /** Override the resolved dev-review config (for testing without a real project DB). */
  devReviewConfigOverride?: EffectiveDevReviewConfig;
  /** Override runDevReview for testing (avoids hitting DB/FS/Codex). */
  runDevReviewImpl?: typeof runDevReview;
  /** Override runDevReviewResponse for testing (avoids hitting DB/FS/Claude). */
  runDevReviewResponseImpl?: typeof runDevReviewResponse;
  /** Override the orchestrator commit-all for dev-review-response edits (for testing). */
  commitDevReviewResponseImpl?: (worktreePath: string, msg: string) => string;
  /** Override persona selection for tests that should not touch SQLite routing state. */
  selectPersonaImpl?: typeof selectPersona;
  /** Override observed changed-file derivation for tests. */
  deriveObservedChangedFilesImpl?: typeof deriveObservedChangedFiles;
}

function uniqueSorted(paths: string[]): string[] {
  return [...new Set(paths)].sort();
}

function compactPaths(paths: string[], limit = 40): { count: number; paths: string[] } {
  const sorted = uniqueSorted(paths);
  return {
    count: sorted.length,
    paths: sorted.slice(0, limit),
  };
}

function filterWpObservedFiles(
  packet: ObservedChangedFilesPacket,
): ObservedChangedFilesPacket['files'] {
  return packet.files.filter(
    (file) => file.path !== '.claude/settings.local.json' && file.path !== '.codex/hooks.json',
  );
}

function declaredWpFilesWritten(paths: Array<{ path: string }>): string[] {
  return uniqueSorted(paths.map((file) => file.path));
}

function acceptanceContractFromSpec(
  spec: EngineeringSpec,
  pipelineRunId: string,
): AcceptanceContract {
  return {
    source: 'engineering-spec',
    runId: pipelineRunId,
    criteria: spec.acceptanceCriteria.map((ac, index) => ({
      id: ac.id ?? `AC-${index + 1}`,
      statement: ac.statement,
      verifyCommand: ac.verifyCommand,
      ...(ac.tolerance != null ? { tolerance: ac.tolerance } : {}),
      ...(ac.journeyRef != null ? { journeyRef: ac.journeyRef } : {}),
      ...(ac.stepIdx != null ? { stepIdx: ac.stepIdx } : {}),
      ...(ac.crossCutting != null ? { crossCutting: ac.crossCutting } : {}),
      sourceRef: 'engineering_specs.spec.acceptanceCriteria',
    })),
  };
}

function emitWpObservedMismatch(input: {
  append: (input: AppendEventInput) => AgentEvent;
  projectId: string;
  workItemId: string;
  wpId: string;
  wpRunId: string;
  modelDeclaredPaths: string[];
  observedPaths: string[];
  reason?: string;
}): void {
  const declared = new Set(input.modelDeclaredPaths);
  const observed = new Set(input.observedPaths);
  const observedNotDeclared = input.observedPaths.filter((path) => !declared.has(path));
  const declaredNotObserved = input.modelDeclaredPaths.filter((path) => !observed.has(path));
  if (
    input.reason == null &&
    observedNotDeclared.length === 0 &&
    declaredNotObserved.length === 0
  ) {
    return;
  }

  input.append({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'agent.output-fact-mismatch',
    payload: {
      runId: input.wpRunId,
      skill: 'implement-wp',
      wpId: input.wpId,
      reason: input.reason ?? 'declared-files-written-differ-from-observed-changes',
      modelDeclaredFiles: compactPaths(input.modelDeclaredPaths),
      observedChangedFiles: compactPaths(input.observedPaths),
      mismatches: {
        observedNotDeclared: compactPaths(observedNotDeclared),
        declaredNotObserved: compactPaths(declaredNotObserved),
      },
    },
    runId: input.wpRunId,
  });
}

function observedOutsideOwned(input: { observedPaths: string[]; filesOwned: string[] }): string[] {
  const owned = new Set(input.filesOwned);
  return input.observedPaths.filter((path) => !owned.has(path));
}

function applyObservedFileToIssueWorktree(input: {
  issueWorktreePath: string;
  scratchWorktreePath: string;
  observedFile: ObservedChangedFilesPacket['files'][number];
}): void {
  const destPath = join(input.issueWorktreePath, input.observedFile.path);
  if (input.observedFile.status === 'deleted') {
    rmSync(destPath, { force: true });
    return;
  }

  const sourcePath = join(input.scratchWorktreePath, input.observedFile.path);
  if (!existsSync(sourcePath)) {
    throw new Error(
      `observed changed file missing from scratch worktree: ${input.observedFile.path}`,
    );
  }
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(sourcePath, destPath);
}

// ─── Main workflow ─────────────────────────────────────────────────────────────

export async function runParallelImplementWorkflow(
  workItem: WorkItem,
  spec: EngineeringSpec,
  pipelineRunId: string,
  stateSource: StateSource,
  projectId: string,
  targetRepo: string,
  deps: ParallelImplementDeps = {},
): Promise<ParallelImplementWorkflowResult> {
  const runId = crypto.randomUUID();
  const baseAppend = deps.appendEvent ?? ((input) => eventStore.appendEvent(input));
  const append = (input: AppendEventInput): AgentEvent => {
    const payload =
      input.payload != null && typeof input.payload === 'object' && !Array.isArray(input.payload)
        ? { ...(input.payload as Record<string, unknown>), pipelineRunId }
        : { value: input.payload, pipelineRunId };
    return baseAppend({ ...input, payload });
  };
  const openPRFn = deps.openPRImpl ?? openPR;
  const createWpFn = deps.createWpWorktreeImpl ?? createWpScratchWorktree;
  const createIssueFn = deps.createIssueWorktreeImpl ?? createWorktree;
  const prewarmWtFn =
    deps.prewarmWorktreeImpl ??
    (deps.createIssueWorktreeImpl == null && deps.createWpWorktreeImpl == null
      ? prewarmWorktree
      : () => undefined);
  const resolveWorkflowBaseFn = deps.resolveWorkflowBaseImpl ?? resolveWorkflowBase;
  const cleanupWpsFn = deps.cleanupWpWorktreesImpl ?? cleanupAllWpWorktrees;
  // cleanupIssueWorktreeImpl is available for test injection but unused in production:
  // the integration worktree persists until PR merge so QA can reuse the same environment.
  const commitWpFn = deps.orchestratorCommitWpImpl ?? orchestratorCommitWp;
  const revertFn = deps.revertWpChangesImpl ?? revertWpChanges;
  const recordFn = deps.recordIterationImpl ?? recordWpIteration;
  const getStatusFn = deps.getLastStatusImpl ?? getLastWpStatus;
  const deriveObservedChangedFilesFn =
    deps.deriveObservedChangedFilesImpl ?? deriveObservedChangedFiles;

  const projectConfig = await getProjectBySlug(projectId);
  const workflowBase = resolveWorkflowBaseFn(targetRepo, projectConfig?.targetRepo?.defaultBranch);
  const { runtime, resolvedBudget: implementWpBudget } = resolveProjectAgentExecution({
    skill: 'implement-wp',
    role: 'developer',
    projectId,
    projectConfig,
    injectedRuntime: deps.runtime,
  });
  const globalSettings = resolveGlobalSettingsForProject(projectId, projectConfig?.budgets);
  const maxParallel = globalSettings.maxParallelAgents ?? 3;
  const maxRetries = globalSettings.maxRetries ?? 2;
  const wpTimeoutMs = 900_000;
  const devReviewCfg =
    deps.devReviewConfigOverride ??
    resolveDevReviewConfig(projectId, projectConfig?.agentConfig?.devReview);
  const getDiffFn = deps.getDiffImpl ?? getDiffForDevReview;
  const devReviewFn = deps.runDevReviewImpl ?? runDevReview;
  const devReviewResponseFn = deps.runDevReviewResponseImpl ?? runDevReviewResponse;
  const commitDevReviewFn =
    deps.commitDevReviewResponseImpl ??
    ((wt: string, msg: string) => orchestratorCommitAll(wt, msg));

  const { personaId } = (deps.selectPersonaImpl ?? selectPersona)(projectId, 'developer');
  const implementWpPrompt = readPromptWithContext('implement-wp', projectId);
  const implementWpJsonSchema = toJsonSchema(ImplementWpSchema);
  const investigation = latestInvestigationContext({
    projectId,
    workItemId: workItem.id,
    worktreePath: targetRepo,
  });
  const latestPrd =
    workItem.type === 'feature'
      ? await resolveLatestPrd({
          projectId,
          workItemId: workItem.id,
          loadLegacyComments: () => stateSource.listComments(workItem.externalId),
        })
      : null;
  const parentPrdContext =
    latestPrd != null
      ? (buildPrdPlanningContext({
          projectId,
          parentWorkItemId: workItem.id,
          pipelineRunId,
          latestPrd,
        }) ?? undefined)
      : undefined;
  const normalizedSpec = normalizeEngineeringSpecPaths({
    spec,
    worktreePath: targetRepo,
    referencePaths: investigation?.keyFiles.map((file) => file.path) ?? [],
  });
  if (normalizedSpec.fields.length > 0) {
    append({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.path-normalized',
      payload: {
        runId,
        skill: 'parallel-implement',
        fields: normalizedSpec.fields,
      },
      runId,
    });
  }
  if (normalizedSpec.ambiguousFields.length > 0) {
    await stateSource.comment(
      workItem.externalId,
      buildAgentComment('Dev', 'Failed', 'Parallel implement blocked by ambiguous paths', [
        `Ambiguous paths: ${normalizedSpec.ambiguousFields
          .map((field) => `${field.field} (${field.from})`)
          .join(', ')}`,
      ]),
    );
    return {
      status: 'failed',
      devRunId: runId,
      errorReason: 'engineering spec contains ambiguous repo-relative paths',
    };
  }
  const specForRun = normalizedSpec.spec;
  const acceptanceContract = acceptanceContractFromSpec(specForRun, pipelineRunId);

  const stack = projectConfig?.stack
    ? {
        testCommand: projectConfig.stack.testCommand,
        lintCommand: projectConfig.stack.lintCommand,
        typecheckCommand: projectConfig.stack.typecheckCommand,
      }
    : { testCommand: 'pnpm test' };

  const allWpIds = specForRun.workPackages.map((wp) => wp.id);
  const scratchWorktrees = new Map<string, string>(); // wpId → path
  let issueWorktreePath: string | undefined;

  try {
    const plannedWpFiles = specForRun.workPackages.flatMap((wp) => wp.filesOwned);
    if (!pathsTouchInvestigationSurface(plannedWpFiles, investigation)) {
      append({
        projectId,
        workItemId: workItem.id,
        kind: 'agent.wrong-surface-guard',
        payload: {
          runId,
          skill: 'parallel-implement',
          reason: 'engineering-spec-missed-investigation-surface',
          expectedKeyFiles: investigation?.keyFiles.map((f) => f.path) ?? [],
          touchedPaths: plannedWpFiles,
          investigationRunId: investigation?.investigationRunId ?? null,
        },
        runId,
      });
      await stateSource.comment(
        workItem.externalId,
        buildAgentComment('Dev', 'Failed', 'Parallel implement blocked by wrong-surface guard', [
          `Expected one of: ${investigation?.keyFiles.map((f) => f.path).join(', ')}`,
        ]),
      );
      return {
        status: 'failed',
        devRunId: runId,
        errorReason: 'engineering spec did not target investigated key files',
      };
    }

    // Create the integration worktree (all WP commits land here).
    issueWorktreePath = createIssueFn(targetRepo, runId, workflowBase.ref);
    prewarmWtFn(issueWorktreePath);

    // Create per-WP scratch worktrees. Sandbox is written in runOneWpBuilder
    // (per-spawn, so retries always get a fresh sandbox with correct opts).
    for (const wp of specForRun.workPackages) {
      const wtPath = createWpFn(targetRepo, runId, wp.id, workflowBase.ref);
      prewarmWtFn(wtPath);
      scratchWorktrees.set(wp.id, wtPath);
    }

    const allWpResults: WpDispatchResult[] = [];

    for (let iteration = 1; iteration <= maxRetries + 1; iteration++) {
      // Carry-forward: skip WPs that are already ok.
      const wpsToRun = specForRun.workPackages.filter((wp) => {
        const lastStatus = getStatusFn(runId, wp.id);
        return lastStatus !== 'ok';
      });

      if (wpsToRun.length === 0) break;

      append({
        projectId,
        workItemId: workItem.id,
        kind: 'parallel-implement.iteration-started',
        payload: { iteration, wpCount: wpsToRun.length, wpIds: wpsToRun.map((w) => w.id) },
        runId,
      });

      // Execute batches in order (respecting executionOrder).
      // Phase 1: WPs within the same batch build concurrently.
      // Phase 2: successful builds commit serially to the integration worktree
      //          to avoid git index lock contention (ADR 0031).
      for (const batch of specForRun.executionOrder) {
        const batchWps = wpsToRun.filter((wp) => batch.wpIds.includes(wp.id));
        if (batchWps.length === 0) continue;

        // Phase 1 — concurrent build (no git writes to integration worktree).
        const buildPhaseResults = await runWithConcurrencyCap(batchWps, maxParallel, (wp) =>
          runOneWpBuilder({
            wp,
            iteration,
            runId,
            projectId,
            workItemId: workItem.id,
            workItem,
            scratchWorktreePath: scratchWorktrees.get(wp.id) ?? '/tmp/missing-scratch',
            stack,
            runtime,
            budgets: implementWpBudget.budgets,
            modelOverride: implementWpBudget.modelOverride,
            personaId,
            wpTimeoutMs,
            appendEvent: append,
            revertWpChangesFn: revertFn,
            recordIterationFn: recordFn,
            implementWpPrompt,
            implementWpJsonSchema,
            investigation,
            acceptanceContract,
            parentPrdContext,
          }),
        );

        // Phase 2 — serial commit (one WP at a time into the integration worktree).
        for (const buildResult of buildPhaseResults) {
          if (buildResult.status !== 'built') {
            const r = buildResult;
            allWpResults.push({
              wpId: r.wpId,
              status: r.status,
              errorReason: r.errorReason,
              runId: r.runId,
            });
            continue;
          }

          const { wp, parsedFilesWritten, wpRunId, commitMsg, scratchWorktreePath } = buildResult;
          const issueWt = issueWorktreePath ?? '/tmp/missing-issue';
          const observedChangedFiles = deriveObservedChangedFilesFn(scratchWorktreePath);
          const filteredObservedFiles = filterWpObservedFiles(observedChangedFiles);
          const changedPaths = uniqueSorted(filteredObservedFiles.map((file) => file.path));
          const modelDeclaredPaths = declaredWpFilesWritten(parsedFilesWritten);

          if (!observedChangedFiles.gitAvailable) {
            emitWpObservedMismatch({
              append,
              projectId,
              workItemId: workItem.id,
              wpId: wp.id,
              wpRunId,
              modelDeclaredPaths,
              observedPaths: changedPaths,
              reason: 'observed-changes-unavailable',
            });
            for (const fileWritten of parsedFilesWritten) {
              const sourcePath = join(scratchWorktreePath, fileWritten.path);
              if (!existsSync(sourcePath)) continue;
              const destPath = join(issueWt, fileWritten.path);
              mkdirSync(dirname(destPath), { recursive: true });
              copyFileSync(sourcePath, destPath);
            }
          } else {
            if (changedPaths.length === 0) {
              emitWpObservedMismatch({
                append,
                projectId,
                workItemId: workItem.id,
                wpId: wp.id,
                wpRunId,
                modelDeclaredPaths,
                observedPaths: changedPaths,
                reason: 'no-observed-changed-files',
              });
              const reason = 'no observed changed files in WP scratch worktree';
              append({
                projectId,
                workItemId: workItem.id,
                kind: 'parallel-implement.wp-commit-failed',
                payload: { wpId: wp.id, wpRunId, errorReason: reason },
                runId: wpRunId,
              });
              revertFn(scratchWorktreePath, changedPaths);
              recordFn(runId, wp.id, iteration, 'failed', reason);
              allWpResults.push({
                wpId: wp.id,
                status: 'failed',
                errorReason: reason,
                runId: wpRunId,
              });
              continue;
            }

            emitWpObservedMismatch({
              append,
              projectId,
              workItemId: workItem.id,
              wpId: wp.id,
              wpRunId,
              modelDeclaredPaths,
              observedPaths: changedPaths,
            });

            const outsideOwned = observedOutsideOwned({
              observedPaths: changedPaths,
              filesOwned: wp.filesOwned,
            });
            if (outsideOwned.length > 0) {
              const reason = `observed changes outside filesOwned: ${outsideOwned.join(', ')}`;
              append({
                projectId,
                workItemId: workItem.id,
                kind: 'agent.contract-gate-blocked',
                payload: {
                  runId: wpRunId,
                  skill: 'implement-wp',
                  wpId: wp.id,
                  gate: 'implement-wp-observed-changes',
                  reason: 'observed-changes-outside-files-owned',
                  filesOwned: compactPaths(wp.filesOwned),
                  observedChangedFiles: compactPaths(changedPaths),
                  outsideOwned: compactPaths(outsideOwned),
                },
                runId: wpRunId,
              });
              append({
                projectId,
                workItemId: workItem.id,
                kind: 'parallel-implement.wp-commit-failed',
                payload: { wpId: wp.id, wpRunId, errorReason: reason },
                runId: wpRunId,
              });
              revertFn(scratchWorktreePath, changedPaths);
              recordFn(runId, wp.id, iteration, 'failed', reason);
              allWpResults.push({
                wpId: wp.id,
                status: 'failed',
                errorReason: reason,
                runId: wpRunId,
              });
              continue;
            }

            for (const observedFile of filteredObservedFiles) {
              applyObservedFileToIssueWorktree({
                issueWorktreePath: issueWt,
                scratchWorktreePath,
                observedFile,
              });
            }
          }

          let commitSha: string | undefined;
          try {
            const commitPaths =
              observedChangedFiles.gitAvailable && changedPaths.length > 0
                ? changedPaths
                : modelDeclaredPaths;
            commitSha = commitWpFn(issueWt, commitPaths, commitMsg);
          } catch (commitErr) {
            const reason = commitErr instanceof Error ? commitErr.message : String(commitErr);
            append({
              projectId,
              workItemId: workItem.id,
              kind: 'parallel-implement.wp-commit-failed',
              payload: { wpId: wp.id, wpRunId, errorReason: reason },
              runId: wpRunId,
            });
            revertFn(scratchWorktreePath, wp.filesOwned);
            recordFn(runId, wp.id, iteration, 'failed', `commit-failed: ${reason}`);
            allWpResults.push({
              wpId: wp.id,
              status: 'failed',
              errorReason: reason,
              runId: wpRunId,
            });
            continue;
          }

          append({
            projectId,
            workItemId: workItem.id,
            kind: 'parallel-implement.wp-committed',
            payload: { wpId: wp.id, wpRunId, commitSha },
            runId: wpRunId,
          });
          recordFn(runId, wp.id, iteration, 'ok');
          allWpResults.push({ wpId: wp.id, status: 'ok', commitSha, runId: wpRunId });
        }
      }

      const stillFailed = allWpIds.filter((id) => getStatusFn(runId, id) !== 'ok');

      if (stillFailed.length === 0) break;

      if (iteration === maxRetries + 1) {
        // Exhausted retries — escalate to needs-human.
        append({
          projectId,
          workItemId: workItem.id,
          kind: 'parallel-implement.exhausted',
          payload: { runId, failedWpIds: stillFailed },
          runId,
        });
        await stateSource.comment(
          workItem.externalId,
          buildAgentComment(
            'Dev',
            'Failed',
            `Parallel implement exhausted ${maxRetries + 1} iterations — escalating`,
            [`Failed WPs: ${stillFailed.join(', ')}`],
          ),
        );
        return {
          status: 'failed',
          devRunId: runId,
          errorReason: `Parallel implement exhausted ${maxRetries + 1} iterations`,
        };
      }
    }

    // ── Dev-review advisor step with maxRevisionTurns loop (M19.25) ─────────
    // Runs after all WPs are committed, before the PR is opened.
    // Budget guard: skip if perCycleMaxUsd <= 0.
    if (
      devReviewCfg.enabled &&
      shouldRunDevReview(devReviewCfg.triggerOn, workItem.priority) &&
      issueWorktreePath != null
    ) {
      if (devReviewCfg.perCycleMaxUsd <= 0) {
        append({
          projectId,
          workItemId: workItem.id,
          kind: 'dev-review.budget-skipped',
          payload: { runId, reason: 'perCycleMaxUsd is zero or negative' },
          runId,
        });
      } else {
        try {
          const maxTurns = Math.max(1, Math.min(5, devReviewCfg.maxRevisionTurns));
          let turns = 0;
          while (turns < maxTurns) {
            // Each iteration = one Codex dev-review call.
            // Use turn-scoped runId so multi-turn events are distinguishable.
            const turnRunId = turns === 0 ? runId : `${runId}:turn-${turns}`;
            const devReviewOutput = await devReviewFn({
              runId: turnRunId,
              projectId,
              workItemId: workItem.id,
              workItem: {
                title: workItem.title,
                body: workItem.body,
                number: Number(workItem.externalId),
                priority: workItem.priority,
              },
              worktreePath: issueWorktreePath,
              baseBranch: workflowBase.branch,
              stack,
              runtime: deps.devReviewRuntime,
              appendEvent: append,
            });

            if (devReviewOutput.verdict === 'no-blockers') break;
            // On the last turn, inconclusive = no more passes available; skip response.
            if (devReviewOutput.verdict === 'inconclusive' && turns === maxTurns - 1) break;

            // Re-fetch diff after any previous response commits so Codex sees current state.
            const currentDiff = getDiffFn(issueWorktreePath, workflowBase.branch);
            await devReviewResponseFn({
              runId: turnRunId,
              projectId,
              workItemId: workItem.id,
              workItem: {
                title: workItem.title,
                body: workItem.body,
                number: Number(workItem.externalId),
                priority: workItem.priority,
              },
              prDiff: currentDiff,
              devReviewFindings: devReviewOutput.findings,
              worktreePath: issueWorktreePath,
              stack,
              runtime: deps.devReviewResponseRuntime,
              appendEvent: append,
            });
            // Commit response edits so the next iteration's Codex diff is current.
            // orchestratorCommitAll uses --allow-empty, so no-ops when nothing changed.
            commitDevReviewFn(
              issueWorktreePath,
              `chore: dev-review-response turn-${turns} addressing/dismissing findings`,
            );
            turns++;
          }
        } catch (devReviewErr) {
          // Dev-review failures are non-fatal. Log and continue to PR.
          const msg = devReviewErr instanceof Error ? devReviewErr.message : String(devReviewErr);
          append({
            projectId,
            workItemId: workItem.id,
            kind: 'dev-review.error',
            payload: { runId, error: msg },
            runId,
          });
        }
      }
    }

    // All WPs committed — open PR.
    const token = process.env.GITHUB_TOKEN ?? '';
    if (!deps.openPRImpl && token.length === 0 && process.env.MOCK_OPEN_PR !== 'true') {
      throw new Error('GITHUB_TOKEN env var is required to open PR');
    }

    const branchName = `factory/${runId}`;
    const title = `M19.XX: ${workItem.title.slice(0, 50)}`;
    const body = buildParallelPrBody({ workItem, spec: specForRun, wpResults: allWpResults });

    const prResult = await openPRFn({
      worktreePath: issueWorktreePath ?? '',
      repo: stateSource.repoRef,
      issueNumber: Number(workItem.externalId),
      title,
      body,
      branchName,
      baseBranch: workflowBase.branch,
      token,
    });

    append({
      projectId,
      workItemId: workItem.id,
      kind: 'pr.opened',
      payload: {
        prNumber: prResult.prNumber,
        prUrl: prResult.prUrl,
        branch: prResult.branch,
        baseBranch: prResult.base,
        worktreePath: issueWorktreePath ?? '',
        devRunId: runId,
      },
      runId,
    });

    await stateSource.comment(
      workItem.externalId,
      buildAgentComment(
        'Dev',
        'Complete',
        `PR #${prResult.prNumber} opened — transitioning to needs-qa`,
        [`PR: ${prResult.prUrl}`],
      ),
    );

    return {
      status: 'success',
      devRunId: runId,
      worktreePath: issueWorktreePath ?? '',
      prNumber: prResult.prNumber,
      prUrl: prResult.prUrl,
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    append({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: { runId, error: error.message },
      runId,
    });
    await stateSource.comment(
      workItem.externalId,
      buildAgentComment('Dev', 'Failed', 'Parallel implement failed — escalating', [
        `Error: ${error.message}`,
      ]),
    );
    return { status: 'failed', devRunId: runId, errorReason: error.message };
  } finally {
    cleanupWpsFn(runId, allWpIds);
    if (issueWorktreePath != null) {
      // Integration worktree persists until PR merge (QA reuses it). Cleanup on merge.
      // Scratch worktrees are removed immediately — they are build-only.
    }
  }
}
