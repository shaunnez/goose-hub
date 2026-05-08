import { execFileSync } from 'node:child_process';
import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import { adviseOnPlan } from '@goose-hub/core/agent-runtime/advisor.js';
import { ClaudeCliRuntime } from '@goose-hub/core/agent-runtime/claude-cli.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { selectModel } from '@goose-hub/core/agent-runtime/model-router.js';
import { defaultModelForTier, tierOf } from '@goose-hub/core/agent-runtime/models.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { resolveBudgetsForProject } from '@goose-hub/core/agent-runtime/resolve-for-project.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { runWithEscalation } from '@goose-hub/core/agent-runtime/with-escalation.js';
import { openPR } from '@goose-hub/core/connectors/github/open-pr.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { orchestratorCommitAll } from '@goose-hub/core/workspaces/orchestrator-git.js';
import {
  cleanupWorktree,
  createWorktree,
  prewarmWorktree,
} from '@goose-hub/core/workspaces/worktree.js';
import { EvidencePostSchema } from '@goose-hub/skills/evidence-post/schema.js';
import { ImplementSchema } from '@goose-hub/skills/implement/schema.js';

function isAdvisorGated(priority: string): priority is 'high' | 'critical' {
  return priority === 'high' || priority === 'critical';
}

function resolveBaseBranch(repoPath: string): string {
  try {
    return execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd: repoPath,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'main';
  }
}

export interface FixIssueDeps {
  /** Override the runtime (used by tests). Defaults to ClaudeCliRuntime. */
  runtime?: AgentRuntime;
  /** Override openPR (used by tests). Defaults to the real connector. */
  openPRImpl?: typeof openPR;
  /** Override the advisor wrapper (used by tests). Defaults to adviseOnPlan. */
  adviseOnPlanImpl?: typeof adviseOnPlan;
  /** Override createWorktree (used by tests). */
  createWorktreeImpl?: typeof createWorktree;
  /** Override cleanupWorktree (used by tests). */
  cleanupWorktreeImpl?: typeof cleanupWorktree;
  /** Override prewarmWorktree (used by tests to skip pnpm install). */
  prewarmWorktreeImpl?: typeof prewarmWorktree;
  /** Override resolveWorktreeHeadSha (used by tests to avoid real git subprocess). */
  resolveWorktreeHeadShaImpl?: typeof resolveWorktreeHeadSha;
  /** Override resolveBaseBranch (used by tests to avoid real git subprocess). */
  resolveBaseBranchImpl?: (repoPath: string) => string;
  /**
   * Override orchestratorCommitAll (used by tests). Orchestrator commits the
   * implement skill's output before opening the PR (ADR 0031 — builder no-commit rule).
   */
  orchestratorCommitAllImpl?: typeof orchestratorCommitAll;
}

/**
 * Runs the M7 fix-issue workflow for a work item in `factory:dev-ready` state.
 *
 * Sequence (single-pipeline; parallel/merge phases deferred per #183 reference):
 *
 *   1. createWorktree
 *   2. Transition factory:dev-ready → factory:in-progress
 *   2a. prewarmWorktree (pnpm install --frozen-lockfile)
 *   3. (Optional) advisor on plan — only for priority:high/critical
 *      - On `proceed`: continue
 *      - On `revise`: re-spawn implement once with feedback (max 1 pass per FACTORY_RULES rule 21)
 *      - On `abort`: transition to factory:needs-human and return
 *   4. Run the implement skill (TDD: tests first, then implementation, then lint)
 *   5. Open PR via the GitHub connector (#184)
 *   6. evidence-post wiring (#234) — best-effort, non-blocking
 *   7. Transition to factory:approved (M7 skips QA/Review; M8 will insert them)
 *
 * On failure at any step (other than evidence-post): cleanup worktree, post a
 * comment, transition to factory:needs-human.
 */
export async function runFixIssueWorkflow(
  workItem: WorkItem,
  stateSource: StateSource,
  projectId: string,
  targetRepo: string,
  deps: FixIssueDeps = {},
): Promise<void> {
  const runId = crypto.randomUUID();
  const runtime = deps.runtime ?? new ClaudeCliRuntime();
  const openPRFn = deps.openPRImpl ?? openPR;
  const advisorFn = deps.adviseOnPlanImpl ?? adviseOnPlan;
  const createWtFn = deps.createWorktreeImpl ?? createWorktree;
  const cleanupWtFn = deps.cleanupWorktreeImpl ?? cleanupWorktree;
  const prewarmWtFn = deps.prewarmWorktreeImpl ?? prewarmWorktree;
  const resolveHeadShaFn = deps.resolveWorktreeHeadShaImpl ?? resolveWorktreeHeadSha;
  const resolveBaseBranchFn = deps.resolveBaseBranchImpl ?? resolveBaseBranch;
  const orchestratorCommitFn = deps.orchestratorCommitAllImpl ?? orchestratorCommitAll;

  const implementPrompt = readPromptWithContext('implement', projectId);
  const implementJsonSchema = toJsonSchema(ImplementSchema);
  const evidencePostPrompt = readPromptWithContext('evidence-post', projectId);
  const evidencePostJsonSchema = toJsonSchema(EvidencePostSchema);

  const { personaId: implementPersonaId } = selectPersona(projectId, 'developer');
  const baseBranch = resolveBaseBranchFn(targetRepo);
  const worktreePath = createWtFn(targetRepo, runId);

  try {
    // Transition into in-progress as soon as the worktree exists.
    await stateSource.transitionState(
      workItem.externalId,
      'factory:dev-ready',
      'factory:in-progress',
    );

    // Pre-warm: install dependencies before spawning the agent so it doesn't
    // waste its first turn running pnpm install.
    prewarmWtFn(worktreePath);

    // Step 3: optional advisor on plan (priority:high/critical only).
    let advisorFeedback: string | undefined;
    let revisionPass: 0 | 1 = 0;
    if (isAdvisorGated(workItem.priority)) {
      // We don't have the plan yet — implement returns it. Per CONTEXT.md
      // "Advisor Flow", the canonical pattern is: implement writes plan,
      // advisor reviews plan, primary continues / re-spawns / aborts.
      // For the first pass we run implement to get a plan, then ask the
      // advisor on the produced plan; on revise, we re-spawn implement
      // once with the feedback. Single revise pass per rule 21.
      const firstAttempt = await runImplement({
        runtime,
        runId,
        projectId,
        workItem,
        worktreePath,
        stack: await deriveStack(projectId),
        appendSystemPrompt: implementPrompt,
        outputJsonSchema: implementJsonSchema,
        personaId: implementPersonaId,
        revisionPass: 0,
      });

      const verdict = await advisorFn({
        runId: crypto.randomUUID(),
        projectId,
        workItemId: workItem.id,
        workItem: {
          title: workItem.title,
          body: workItem.body,
          number: Number(workItem.externalId),
          priority: workItem.priority,
        },
        plan: firstAttempt.plan,
      });

      if (verdict.verdict === 'abort') {
        await stateSource.comment(
          workItem.externalId,
          buildAgentComment('Dev', 'Aborted', 'Advisor aborted — escalating to needs-human', [
            `Reason: ${verdict.reason}`,
          ]),
        );
        await stateSource.transitionState(
          workItem.externalId,
          'factory:in-progress',
          'factory:needs-human',
        );
        accumulatePersonaStats({
          personaName: implementPersonaId,
          role: 'developer',
          outcome: 'failure',
        });
        return;
      }

      if (verdict.verdict === 'revise') {
        advisorFeedback = verdict.feedback;
        revisionPass = 1;
        // Fall through to step 4 to re-spawn implement with the feedback.
      } else {
        // proceed — first attempt's output is final.
        await afterImplement({
          implementOutput: firstAttempt,
          workItem,
          stateSource,
          projectId,
          targetRepo,
          runId,
          worktreePath,
          baseBranch,
          openPRFn,
          runtime,
          evidencePostPrompt,
          evidencePostJsonSchema,
          resolveHeadShaFn,
          orchestratorCommitFn,
        });
        accumulatePersonaStats({
          personaName: implementPersonaId,
          role: 'developer',
          outcome: 'success',
        });
        return;
      }
    }

    // Step 4: implement (or re-spawn after revise).
    const implementOutput = await runImplement({
      runtime,
      runId,
      projectId,
      workItem,
      worktreePath,
      stack: await deriveStack(projectId),
      appendSystemPrompt: implementPrompt,
      outputJsonSchema: implementJsonSchema,
      personaId: implementPersonaId,
      advisorFeedback,
      revisionPass,
    });

    await afterImplement({
      implementOutput,
      workItem,
      stateSource,
      projectId,
      targetRepo,
      runId,
      worktreePath,
      baseBranch,
      openPRFn,
      runtime,
      evidencePostPrompt,
      evidencePostJsonSchema,
      resolveHeadShaFn,
      orchestratorCommitFn,
    });
    accumulatePersonaStats({
      personaName: implementPersonaId,
      role: 'developer',
      outcome: 'success',
    });
  } catch (err) {
    accumulatePersonaStats({
      personaName: implementPersonaId,
      role: 'developer',
      outcome: 'failure',
    });
    const error = err instanceof Error ? err : new Error(String(err));
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: { runId, error: error.message },
      runId,
    });
    await stateSource.comment(
      workItem.externalId,
      buildAgentComment('Dev', 'Failed', 'Fix-issue failed — escalating to needs-human', [
        `Error: ${error.message}`,
      ]),
    );
    await stateSource.transitionState(
      workItem.externalId,
      'factory:in-progress',
      'factory:needs-human',
    );
    // Error path: no PR was opened, no merge is coming — clean up now.
    cleanupWtFn(runId);
  }
  // Success path: worktree persists until PR merge so QA can run in the same environment.
  // Cleanup happens in approveIssue() when the PR is merged.
}

interface RunImplementInput {
  runtime: AgentRuntime;
  runId: string;
  projectId: string;
  workItem: WorkItem;
  worktreePath: string;
  stack: { testCommand: string; lintCommand?: string; typecheckCommand?: string };
  appendSystemPrompt: string;
  outputJsonSchema: Record<string, unknown>;
  personaId: string;
  advisorFeedback?: string;
  revisionPass?: 0 | 1;
}

interface ImplementOutputShape {
  plan: string;
  filesWritten: { path: string; reason: string }[];
  testsWritten: { path: string; cases: number }[];
  testsRun: { command: string; paths: string[] };
  prUrl: string;
  evidenceSpecPath: string | null;
  confidence: 'low' | 'medium' | 'high';
  decisionSummaries: { kind: string; summary: string; evidence?: string }[];
}

async function runImplement(input: RunImplementInput): Promise<ImplementOutputShape> {
  const projectConfig = await getProjectBySlug(input.projectId);
  const { budgets, modelOverride: budgetModelOverride } = resolveBudgetsForProject(
    'implement',
    projectConfig?.budgets,
    input.projectId,
  );

  const routerResult = selectModel({
    workItem: input.workItem,
    role: 'developer',
    projectId: input.projectId,
    modelRouterConfig: projectConfig?.agentConfig?.modelRouter,
  });
  const modelOverride =
    routerResult != null ? defaultModelForTier(routerResult.tier) : budgetModelOverride;

  eventStore.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItem.id,
    kind: 'agent.model-selected',
    payload: {
      runId: input.runId,
      role: 'developer',
      selectedTier: routerResult?.tier ?? tierOf(budgetModelOverride),
      reason: routerResult?.reason ?? 'budget-default',
    },
    runId: input.runId,
  });

  const { output } = await runWithEscalation({
    runtime: input.runtime,
    schema: ImplementSchema,
    projectId: input.projectId,
    workItemId: input.workItem.id,
    projectBudgets: projectConfig?.budgets,
    spec: {
      runId: input.runId,
      role: 'developer',
      skill: 'implement',
      context: {
        projectId: input.projectId,
        workItemId: input.workItem.id,
        workItem: {
          title: input.workItem.title,
          body: input.workItem.body,
          number: Number(input.workItem.externalId),
          priority: input.workItem.priority,
        },
        worktreePath: input.worktreePath,
        stack: input.stack,
        advisorFeedback: input.advisorFeedback,
        revisionPass: input.revisionPass ?? 0,
      },
      contextAllowlist: [
        'workItem.title',
        'workItem.body',
        'workItem.number',
        'workItem.priority',
        'worktreePath',
        'stack.testCommand',
        'stack.lintCommand',
        'stack.typecheckCommand',
        'advisorFeedback',
        'revisionPass',
      ],
      freshContext: false,
      toolBundles: ['dev-tools'],
      toolExtras: [],
      budgets,
      modelOverride,
      personaId: input.personaId,
      outputJsonSchema: input.outputJsonSchema,
      appendSystemPrompt: input.appendSystemPrompt,
    },
  });
  return output;
}

interface AfterImplementInput {
  implementOutput: ImplementOutputShape;
  workItem: WorkItem;
  stateSource: StateSource;
  projectId: string;
  targetRepo: string;
  runId: string;
  worktreePath: string;
  baseBranch: string;
  openPRFn: typeof openPR;
  runtime: AgentRuntime;
  evidencePostPrompt: string;
  evidencePostJsonSchema: Record<string, unknown>;
  resolveHeadShaFn: typeof resolveWorktreeHeadSha;
  /** Orchestrator commits before openPR (ADR 0031 — builder no-commit rule). */
  orchestratorCommitFn: typeof orchestratorCommitAll;
}

async function afterImplement(input: AfterImplementInput): Promise<void> {
  const { implementOutput, workItem, stateSource, projectId, runId, worktreePath } = input;

  // Orchestrator commits the builder's work before opening the PR (ADR 0031).
  // The implement skill writes files but no longer commits; this call stages
  // all changes and creates a single commit attributed to the workflow run.
  input.orchestratorCommitFn(
    worktreePath,
    `fix(#${workItem.externalId}): ${workItem.title.slice(0, 60)}`,
  );

  // Emit implement decision summaries (#206 pattern).
  for (const summary of implementOutput.decisionSummaries) {
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.decision-summary',
      payload: { skill: 'implement', ...summary },
      runId,
    });
  }
  eventStore.appendEvent({
    projectId,
    workItemId: workItem.id,
    kind: 'agent.implement-complete',
    payload: {
      filesWritten: implementOutput.filesWritten.length,
      testsWritten: implementOutput.testsWritten.length,
      confidence: implementOutput.confidence,
      // #467 — preserved verbatim so QA's workflow can pull dev's targeted
      // test command + paths into its context as `devTestsRun` and bucket
      // full-suite failures as inside- vs outside-targeted.
      testsRun: implementOutput.testsRun,
    },
    runId,
  });

  // Step 5: open PR.
  const token = process.env.GITHUB_TOKEN ?? '';
  if (token.length === 0 && process.env.MOCK_OPEN_PR !== 'true') {
    throw new Error('GITHUB_TOKEN env var is required to open PR');
  }
  const repoRef = stateSource.repoRef;
  const branchName = `factory/${runId}`;
  const title = `M7.XX: ${workItem.title.slice(0, 50)}`;
  const body = buildPrBody({ workItem, implementOutput });

  const prResult = await input.openPRFn({
    worktreePath,
    repo: repoRef,
    issueNumber: Number(workItem.externalId),
    title,
    body,
    branchName,
    baseBranch: input.baseBranch,
    token,
  });

  eventStore.appendEvent({
    projectId,
    workItemId: workItem.id,
    kind: 'pr.opened',
    payload: {
      prNumber: prResult.prNumber,
      prUrl: prResult.prUrl,
      branch: prResult.branch,
      worktreePath,
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

  // Step 6: evidence-post wiring (#234) — best-effort.
  // Resolve the worktree HEAD to the real commit SHA so evidence-post pins
  // its raw URLs to an immutable ref (#233 SHA-pinning contract).
  const prHeadSha = input.resolveHeadShaFn(worktreePath);

  // Look up the BEFORE-state comment posted by playwright-repro during
  // investigation (type:bug only). Absent for feature/chore.
  const investigationEvents = eventStore.replay({ workItemId: workItem.id });
  const investigationComplete = [...investigationEvents]
    .reverse()
    .find((e) => e.kind === 'agent.investigation-complete');
  const beforeCommentUrl = (
    investigationComplete?.payload as { playwrightRepro?: { commentUrl?: string } } | undefined
  )?.playwrightRepro?.commentUrl;

  await runEvidencePost({
    workItem,
    projectId,
    runId,
    runtime: input.runtime,
    appendSystemPrompt: input.evidencePostPrompt,
    outputJsonSchema: input.evidencePostJsonSchema,
    prNumber: prResult.prNumber,
    prHeadSha,
    repoRef,
    evidenceSpecPath: implementOutput.evidenceSpecPath,
    beforeCommentUrl,
    worktreePath,
  });

  // Step 7: M8 path — route through QA before approval (factory:in-progress → factory:needs-qa)
  await stateSource.transitionState(workItem.externalId, 'factory:in-progress', 'factory:needs-qa');
}

interface RunEvidencePostInput {
  workItem: WorkItem;
  projectId: string;
  runId: string;
  runtime: AgentRuntime;
  appendSystemPrompt: string;
  outputJsonSchema: Record<string, unknown>;
  prNumber: number;
  prHeadSha: string;
  repoRef: string;
  evidenceSpecPath: string | null;
  /**
   * Permalink to the BEFORE-state comment posted by playwright-repro during
   * investigation. Present only for type:bug; undefined for feature/chore.
   */
  beforeCommentUrl?: string;
  /**
   * Dev worktree path. Passed as `workspaceDir` so the agent runs inside the
   * git repo it must read from (spec source, app code) and push from. Without
   * this, the runtime falls back to a fresh empty directory and every git
   * command in the skill fails.
   */
  worktreePath: string;
}

/**
 * #234 wiring. Best-effort: failures emit `evidence.post-failed` and are
 * swallowed so the workflow can still transition to factory:approved.
 * If the developer skill did not declare an `evidenceSpecPath`, emit
 * `evidence.no-spec-declared` and skip.
 */
async function runEvidencePost(input: RunEvidencePostInput): Promise<void> {
  if (input.evidenceSpecPath == null) {
    eventStore.appendEvent({
      projectId: input.projectId,
      workItemId: input.workItem.id,
      kind: 'evidence.no-spec-declared',
      payload: { runId: input.runId },
      runId: input.runId,
    });
    return;
  }

  const evidenceRunId = crypto.randomUUID();
  const projectConfig = await getProjectBySlug(input.projectId);
  try {
    const result = await input.runtime.run({
      runId: evidenceRunId,
      role: 'developer',
      skill: 'evidence-post',
      workspaceDir: input.worktreePath,
      context: {
        projectId: input.projectId,
        workItemId: input.workItem.id,
        workItem: {
          number: Number(input.workItem.externalId),
          repo: input.repoRef,
          title: input.workItem.title,
          beforeCommentUrl: input.beforeCommentUrl,
        },
        prNumber: input.prNumber,
        prHeadSha: input.prHeadSha,
        specPath: input.evidenceSpecPath,
      },
      contextAllowlist: [
        'workItem.number',
        'workItem.repo',
        'workItem.title',
        'workItem.beforeCommentUrl',
        'prNumber',
        'prHeadSha',
        'specPath',
      ],
      freshContext: false,
      toolBundles: ['validate'],
      toolExtras: [],
      env: { WEB_PORT: String(5200 + (Number(input.workItem.externalId) % 800)) },
      ...resolveBudgetsForProject('evidence-post', projectConfig?.budgets, input.projectId),
      personaId: selectPersona(input.projectId, 'developer').personaId,
      outputJsonSchema: input.outputJsonSchema,
      appendSystemPrompt: input.appendSystemPrompt,
    });

    const parsed = EvidencePostSchema.safeParse(result.output);
    if (!parsed.success) {
      throw new Error('evidence-post output validation failed');
    }
    eventStore.appendEvent({
      projectId: input.projectId,
      workItemId: input.workItem.id,
      kind: 'evidence.posted',
      payload: { commentUrl: parsed.data.commentUrl, runId: evidenceRunId },
      runId: evidenceRunId,
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    eventStore.appendEvent({
      projectId: input.projectId,
      workItemId: input.workItem.id,
      kind: 'evidence.post-failed',
      payload: { runId: evidenceRunId, error: error.message },
      runId: evidenceRunId,
    });
    // Swallow — best-effort.
  }
}

function buildPrBody(opts: {
  workItem: WorkItem;
  implementOutput: ImplementOutputShape;
}): string {
  // Body intentionally contains NO implementation reasoning (FACTORY_RULES
  // rule 1 — QA / Reviewer holdouts read this on M8). Lists files written
  // and test files added; the work-item link plus `Closes #N` ties back
  // to the issue.
  const filesList = opts.implementOutput.filesWritten
    .map((f) => `- \`${f.path}\` — ${f.reason}`)
    .join('\n');
  const testsList = opts.implementOutput.testsWritten
    .map((t) => `- \`${t.path}\` (${t.cases} cases)`)
    .join('\n');

  return `## Summary

${opts.workItem.title}

## Files
${filesList || '_no files reported_'}

## Tests
${testsList || '_no tests reported_'}

Closes #${opts.workItem.externalId}
`;
}

/**
 * Resolves the worktree's current HEAD to a 40-char commit SHA so
 * evidence-post can pin raw.githubusercontent.com URLs to an immutable
 * ref (the #233 SHA-pinning contract). Falls back to `'HEAD'` only if
 * `git rev-parse` fails — the EvidencePostSchema requires `prHeadSha.length >= 7`,
 * which `'HEAD'` does NOT satisfy, so a fallback there will surface as
 * a schema validation error and be caught by runEvidencePost's
 * best-effort handler. That's intentional: a missing SHA is loud, not silent.
 *
 * Exported for test access — the chore-shipping path needs a real git repo
 * to exercise the rev-parse, and isolating the call here keeps the
 * workflow tests deps-injected for everything else.
 */
export function resolveWorktreeHeadSha(worktreePath: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: worktreePath,
      encoding: 'utf8',
    }).trim();
  } catch {
    // Triggers a schema validation failure inside runEvidencePost,
    // which emits evidence.post-failed and continues.
    return 'HEAD';
  }
}

async function deriveStack(projectId: string): Promise<{
  testCommand: string;
  lintCommand?: string;
  typecheckCommand?: string;
}> {
  const config = await getProjectBySlug(projectId);
  if (config?.stack) {
    return {
      testCommand: config.stack.testCommand,
      lintCommand: config.stack.lintCommand,
      typecheckCommand: config.stack.typecheckCommand,
    };
  }
  return {
    testCommand: 'pnpm test',
    lintCommand: 'pnpm lint',
    typecheckCommand: 'pnpm typecheck',
  };
}
