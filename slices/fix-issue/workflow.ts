import { execFileSync } from 'node:child_process';
import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import { adviseOnPlan } from '@goose-hub/core/agent-runtime/advisor.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { openPR } from '@goose-hub/core/connectors/github/open-pr.js';
import { emitStateTransitionEvent } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { orchestratorCommitAll } from '@goose-hub/core/workspaces/orchestrator-git.js';
import {
  cleanupWorktree,
  createWorktree,
  prewarmWorktree,
} from '@goose-hub/core/workspaces/worktree.js';
import { EvidencePostSchema } from '@goose-hub/skills/evidence-post/schema.js';
import { ImplementSchema } from '@goose-hub/skills/implement/schema.js';
import { afterImplement, resolveImplementExecution, runImplement } from './implement-phase.js';
import { deriveStack, resolveWorktreeHeadSha } from './pr-helpers.js';

// Re-export for test access (slice.test.ts imports resolveWorktreeHeadSha from workflow.js).
export { resolveWorktreeHeadSha } from './pr-helpers.js';

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
  /** Override the runtime (used by tests). Defaults to provider-aware runtime dispatch. */
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
  const implementExecution = await resolveImplementExecution({
    projectId,
    workItem,
    injectedRuntime: deps.runtime,
  });
  const runtime = implementExecution.runtime;
  const worktreePath = createWtFn(targetRepo, runId);

  try {
    // Transition into in-progress as soon as the worktree exists.
    await stateSource.transitionState(
      workItem.externalId,
      'factory:dev-ready',
      'factory:in-progress',
    );
    emitStateTransitionEvent({
      projectId,
      workItemId: workItem.id,
      from: 'factory:dev-ready',
      to: 'factory:in-progress',
      by: 'fix-issue',
      runId,
    });

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
        execution: implementExecution,
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
        emitStateTransitionEvent({
          projectId,
          workItemId: workItem.id,
          from: 'factory:in-progress',
          to: 'factory:needs-human',
          by: 'fix-issue',
          runId,
        });
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
      execution: implementExecution,
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
    emitStateTransitionEvent({
      projectId,
      workItemId: workItem.id,
      from: 'factory:in-progress',
      to: 'factory:needs-human',
      by: 'fix-issue',
      runId,
    });
    // Error path: no PR was opened, no merge is coming — clean up now.
    cleanupWtFn(runId);
  }
  // Success path: worktree persists until PR merge so QA can run in the same environment.
  // Cleanup happens in approveIssue() when the PR is merged.
}
