import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import type {
  AgentResult,
  AgentRuntime,
  AgentSpec,
} from '@goose-hub/core/agent-runtime/interface.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { resolveGlobalSettingsForProject } from '@goose-hub/core/agent-runtime/resolve-for-project.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { openPR } from '@goose-hub/core/connectors/github/open-pr.js';
import { db } from '@goose-hub/core/db/db.js';
import { wpIterations } from '@goose-hub/core/db/schema.js';
import type { AgentEvent, AppendEventInput } from '@goose-hub/core/event-stream/store.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { writeWpBuilderSandbox } from '@goose-hub/core/tool-layer/sandbox.js';
import {
  cleanupAllWpWorktrees,
  createWpScratchWorktree,
  orchestratorCommitWp,
  revertWpChanges,
} from '@goose-hub/core/workspaces/orchestrator-git.js';
import { type cleanupWorktree, createWorktree } from '@goose-hub/core/workspaces/worktree.js';
import { ImplementWpSchema } from '@goose-hub/skills/implement-wp/schema.js';
import type { EngineeringSpec, WorkPackage } from '@goose-hub/skills/spec-author/schema.js';
import { and, desc, eq } from 'drizzle-orm';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WpDispatchResult {
  wpId: string;
  status: 'ok' | 'failed' | 'timeout';
  commitSha?: string;
  errorReason?: string;
  runId: string;
}

export interface ParallelImplementDeps {
  runtime?: AgentRuntime;
  openPRImpl?: typeof openPR;
  createWpWorktreeImpl?: typeof createWpScratchWorktree;
  createIssueWorktreeImpl?: typeof createWorktree;
  cleanupWpWorktreesImpl?: typeof cleanupAllWpWorktrees;
  cleanupIssueWorktreeImpl?: typeof cleanupWorktree;
  orchestratorCommitWpImpl?: typeof orchestratorCommitWp;
  revertWpChangesImpl?: typeof revertWpChanges;
  recordIterationImpl?: typeof recordWpIteration;
  getLastStatusImpl?: typeof getLastWpStatus;
  appendEvent?: (input: AppendEventInput) => AgentEvent;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

function recordWpIteration(
  runId: string,
  wpId: string,
  iteration: number,
  status: 'in-progress' | 'ok' | 'failed',
  errorReason?: string,
): void {
  db.insert(wpIterations)
    .values({ runId, wpId, iteration, status, errorReason: errorReason ?? null })
    .onConflictDoUpdate({
      target: [wpIterations.runId, wpIterations.wpId, wpIterations.iteration],
      set: { status, errorReason: errorReason ?? null },
    })
    .run();
}

function getLastWpStatus(runId: string, wpId: string): 'ok' | 'failed' | 'in-progress' | null {
  const rows = db
    .select()
    .from(wpIterations)
    .where(and(eq(wpIterations.runId, runId), eq(wpIterations.wpId, wpId)))
    .orderBy(desc(wpIterations.iteration))
    .limit(1)
    .all();
  return (rows[0]?.status as 'ok' | 'failed' | 'in-progress' | null) ?? null;
}

// ─── Concurrency primitives ───────────────────────────────────────────────────

async function runWithConcurrencyCap<T, R>(
  items: T[],
  cap: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(cap, items.length));
  const workers: Promise<void>[] = [];
  for (let w = 0; w < workerCount; w++) {
    workers.push(
      (async (): Promise<void> => {
        while (true) {
          const idx = next++;
          if (idx >= items.length) return;
          const item = items[idx];
          if (item === undefined) return;
          results[idx] = await fn(item, idx);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return results;
}

// ─── PR body ─────────────────────────────────────────────────────────────────

function buildParallelPrBody(opts: {
  workItem: WorkItem;
  spec: EngineeringSpec;
  wpResults: WpDispatchResult[];
}): string {
  const wpChangelog = opts.wpResults
    .map((r) => {
      const wp = opts.spec.workPackages.find((w) => w.id === r.wpId);
      const status = r.status === 'ok' ? '✓' : '✗';
      return `- ${status} **${r.wpId}**: ${wp?.changes.slice(0, 120) ?? '(unknown)'}`;
    })
    .join('\n');

  return `## Summary

${opts.workItem.title}

## Work Packages

${wpChangelog}

Closes #${opts.workItem.externalId}
`;
}

// ─── Single-WP builder runner ─────────────────────────────────────────────────

// Internal result from the concurrent build phase, before the serial commit phase.
type WpBuildPhaseResult =
  | {
      status: 'built';
      wp: WorkPackage;
      parsedFilesWritten: Array<{ path: string; reason?: string }>;
      wpRunId: string;
      commitMsg: string;
      scratchWorktreePath: string;
    }
  | { status: 'failed' | 'timeout'; wpId: string; errorReason?: string; runId: string };

interface RunOneWpBuilderOptions {
  wp: WorkPackage;
  iteration: number;
  runId: string;
  projectId: string;
  workItemId?: string;
  workItem: WorkItem;
  scratchWorktreePath: string;
  stack: { testCommand: string; lintCommand?: string; typecheckCommand?: string };
  runtime: AgentRuntime;
  personaId: string;
  wpTimeoutMs: number;
  appendEvent: (input: AppendEventInput) => AgentEvent;
  revertWpChangesFn: typeof revertWpChanges;
  recordIterationFn: typeof recordWpIteration;
  implementWpPrompt: string;
  implementWpJsonSchema: Record<string, unknown>;
}

async function runOneWpBuilder(opts: RunOneWpBuilderOptions): Promise<WpBuildPhaseResult> {
  const { wp, iteration, runId, projectId, workItemId } = opts;
  const wpRunId = `${runId}:wp:${wp.id}:iter:${iteration}`;

  opts.recordIterationFn(runId, wp.id, iteration, 'in-progress');

  opts.appendEvent({
    projectId,
    workItemId: workItemId ?? null,
    kind: 'parallel-implement.wp-started',
    payload: { wpId: wp.id, iteration, wpRunId, scratchPath: opts.scratchWorktreePath },
    runId: wpRunId,
  });

  const spawnSpec: AgentSpec = {
    runId: wpRunId,
    role: 'developer',
    skill: 'implement-wp',
    workspaceDir: opts.scratchWorktreePath,
    context: {
      projectId,
      workItemId,
      workItem: {
        title: opts.workItem.title,
        body: opts.workItem.body,
        number: Number(opts.workItem.externalId),
        priority: opts.workItem.priority,
      },
      wp: {
        id: wp.id,
        filesOwned: wp.filesOwned,
        changes: wp.changes,
        dependsOn: wp.dependsOn,
      },
      worktreePath: opts.scratchWorktreePath,
      stack: opts.stack,
    },
    contextAllowlist: [
      'workItem.title',
      'workItem.body',
      'workItem.number',
      'workItem.priority',
      'wp.id',
      'wp.filesOwned',
      'wp.changes',
      'wp.dependsOn',
      'worktreePath',
      'stack.testCommand',
      'stack.lintCommand',
      'stack.typecheckCommand',
    ],
    freshContext: false,
    toolBundles: ['dev-tools'],
    toolExtras: [],
    budgets: { maxTurns: 150, maxBudgetUsd: 10.0, timeoutMs: opts.wpTimeoutMs },
    personaId: opts.personaId,
    outputJsonSchema: opts.implementWpJsonSchema,
    appendSystemPrompt: opts.implementWpPrompt,
    env: {
      FACTORY_WP_FILESOWNED: wp.filesOwned.join(':'),
      FACTORY_WP_ID: wp.id,
    },
  };

  let result: AgentResult | undefined;
  let errorReason: string | undefined;
  let timedOut = false;

  const start = Date.now();

  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('wp-timeout')), opts.wpTimeoutMs),
    );
    result = await Promise.race([opts.runtime.run(spawnSpec), timeout]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'wp-timeout') {
      timedOut = true;
    } else {
      errorReason = msg;
    }
  }

  if (timedOut) {
    opts.appendEvent({
      projectId,
      workItemId: workItemId ?? null,
      kind: 'parallel-implement.wp-timeout',
      payload: { wpId: wp.id, wpRunId, elapsedMs: Date.now() - start },
      runId: wpRunId,
    });
    opts.revertWpChangesFn(opts.scratchWorktreePath, wp.filesOwned);
    opts.recordIterationFn(runId, wp.id, iteration, 'failed', 'timeout');
    return { status: 'timeout', wpId: wp.id, errorReason: 'timeout', runId: wpRunId };
  }

  if (errorReason != null || result == null) {
    opts.appendEvent({
      projectId,
      workItemId: workItemId ?? null,
      kind: 'parallel-implement.wp-failed',
      payload: { wpId: wp.id, wpRunId, errorReason: errorReason ?? 'unknown' },
      runId: wpRunId,
    });
    opts.revertWpChangesFn(opts.scratchWorktreePath, wp.filesOwned);
    opts.recordIterationFn(runId, wp.id, iteration, 'failed', errorReason ?? 'unknown');
    return { status: 'failed', wpId: wp.id, errorReason: errorReason ?? 'unknown', runId: wpRunId };
  }

  const parsed = ImplementWpSchema.safeParse(result.output);
  if (!parsed.success) {
    const reason = `schema validation failed: ${parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')}`;
    opts.appendEvent({
      projectId,
      workItemId: workItemId ?? null,
      kind: 'parallel-implement.wp-failed',
      payload: { wpId: wp.id, wpRunId, errorReason: reason },
      runId: wpRunId,
    });
    opts.revertWpChangesFn(opts.scratchWorktreePath, wp.filesOwned);
    opts.recordIterationFn(runId, wp.id, iteration, 'failed', reason);
    return { status: 'failed', wpId: wp.id, errorReason: reason, runId: wpRunId };
  }

  // Build succeeded — return files for the serial commit phase.
  const commitMsg = `M:${wp.id} ${wp.changes.slice(0, 60)}\n\nBuilt by ${opts.personaId}`;
  return {
    status: 'built',
    wp,
    parsedFilesWritten: parsed.data.filesWritten,
    wpRunId,
    commitMsg,
    scratchWorktreePath: opts.scratchWorktreePath,
  };
}

// ─── Main workflow ─────────────────────────────────────────────────────────────

export async function runParallelImplementWorkflow(
  workItem: WorkItem,
  spec: EngineeringSpec,
  stateSource: StateSource,
  projectId: string,
  targetRepo: string,
  deps: ParallelImplementDeps = {},
): Promise<void> {
  const runId = crypto.randomUUID();
  const append = deps.appendEvent ?? ((input) => eventStore.appendEvent(input));
  const runtime =
    deps.runtime ??
    (() => {
      throw new Error('runtime required');
    })();
  const openPRFn = deps.openPRImpl ?? openPR;
  const createWpFn = deps.createWpWorktreeImpl ?? createWpScratchWorktree;
  const createIssueFn = deps.createIssueWorktreeImpl ?? createWorktree;
  const cleanupWpsFn = deps.cleanupWpWorktreesImpl ?? cleanupAllWpWorktrees;
  // cleanupIssueWorktreeImpl is available for test injection but unused in production:
  // the integration worktree persists until PR merge so QA can reuse the same environment.
  const commitWpFn = deps.orchestratorCommitWpImpl ?? orchestratorCommitWp;
  const revertFn = deps.revertWpChangesImpl ?? revertWpChanges;
  const recordFn = deps.recordIterationImpl ?? recordWpIteration;
  const getStatusFn = deps.getLastStatusImpl ?? getLastWpStatus;

  const projectConfig = await getProjectBySlug(projectId);
  const globalSettings = resolveGlobalSettingsForProject(projectId, projectConfig?.budgets);
  const maxParallel = globalSettings.maxParallelAgents ?? 3;
  const maxRetries = globalSettings.maxRetries ?? 2;
  const wpTimeoutMs = 900_000;

  const { personaId } = selectPersona(projectId, 'developer');
  const implementWpPrompt = readPromptWithContext('implement-wp', projectId);
  const implementWpJsonSchema = toJsonSchema(ImplementWpSchema);

  const stack = projectConfig?.stack
    ? {
        testCommand: projectConfig.stack.testCommand,
        lintCommand: projectConfig.stack.lintCommand,
        typecheckCommand: projectConfig.stack.typecheckCommand,
      }
    : { testCommand: 'pnpm test' };

  const allWpIds = spec.workPackages.map((wp) => wp.id);
  const scratchWorktrees = new Map<string, string>(); // wpId → path
  let issueWorktreePath: string | undefined;

  try {
    await stateSource.transitionState(
      workItem.externalId,
      'factory:dev-ready',
      'factory:in-progress',
    );

    // Create the integration worktree (all WP commits land here).
    issueWorktreePath = createIssueFn(targetRepo, runId);

    // Create per-WP scratch worktrees and write file-guard sandboxes.
    for (const wp of spec.workPackages) {
      const wtPath = createWpFn(targetRepo, runId, wp.id);
      scratchWorktrees.set(wp.id, wtPath);
      writeWpBuilderSandbox(wtPath, wp.filesOwned, wp.id);
    }

    const allWpResults: WpDispatchResult[] = [];

    for (let iteration = 1; iteration <= maxRetries + 1; iteration++) {
      // Carry-forward: skip WPs that are already ok.
      const wpsToRun = spec.workPackages.filter((wp) => {
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
      for (const batch of spec.executionOrder) {
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
            personaId,
            wpTimeoutMs,
            appendEvent: append,
            revertWpChangesFn: revertFn,
            recordIterationFn: recordFn,
            implementWpPrompt,
            implementWpJsonSchema,
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

          for (const fileWritten of parsedFilesWritten) {
            const destPath = join(issueWt, fileWritten.path);
            mkdirSync(dirname(destPath), { recursive: true });
            copyFileSync(join(scratchWorktreePath, fileWritten.path), destPath);
          }

          let commitSha: string | undefined;
          try {
            commitSha = commitWpFn(issueWt, wp.filesOwned, commitMsg);
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
        await stateSource.transitionState(
          workItem.externalId,
          'factory:in-progress',
          'factory:needs-human',
        );
        return;
      }
    }

    // All WPs committed — open PR.
    const token = process.env.GITHUB_TOKEN ?? '';
    if (!deps.openPRImpl && token.length === 0 && process.env.MOCK_OPEN_PR !== 'true') {
      throw new Error('GITHUB_TOKEN env var is required to open PR');
    }

    const branchName = `factory/${runId}`;
    const title = `M19.XX: ${workItem.title.slice(0, 50)}`;
    const body = buildParallelPrBody({ workItem, spec, wpResults: allWpResults });

    const prResult = await openPRFn({
      worktreePath: issueWorktreePath ?? '',
      repo: stateSource.repoRef,
      issueNumber: Number(workItem.externalId),
      title,
      body,
      branchName,
      baseBranch: 'main',
      token,
    });

    append({
      projectId,
      workItemId: workItem.id,
      kind: 'pr.opened',
      payload: { prNumber: prResult.prNumber, prUrl: prResult.prUrl, branch: prResult.branch },
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

    await stateSource.transitionState(
      workItem.externalId,
      'factory:in-progress',
      'factory:needs-qa',
    );
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
    await stateSource.transitionState(
      workItem.externalId,
      'factory:in-progress',
      'factory:needs-human',
    );
  } finally {
    cleanupWpsFn(runId, allWpIds);
    if (issueWorktreePath != null) {
      // Integration worktree persists until PR merge (QA reuses it). Cleanup on merge.
      // Scratch worktrees are removed immediately — they are build-only.
    }
  }
}
