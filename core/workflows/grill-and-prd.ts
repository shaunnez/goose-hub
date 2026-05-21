/**
 * M13.05 — grill-and-prd workflow.
 *
 * Orchestrates the three Discover-Lane skills (grill-me → write-prd →
 * advise-on-prd, conditional) with a human-in-loop gate at the grill step.
 *
 * One call to runGrillAndPrdWorkflow advances exactly ONE round; the
 * orchestrator drives the loop across ticks and rebuilds priorReplies from
 * issue comments between each tick.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PRDOutput } from '../../skills/write-prd/schema.js';
import type { AgentRuntime } from '../agent-runtime/interface.js';
import { reconcileDecisionSummaries } from '../agent-runtime/reconcile-decisions.js';
import { totalSpendForSkill as _totalSpendForSkill } from '../cost/repository.js';
import { emitStateTransitionEvent } from '../event-stream/state-transition.js';
import { eventStore } from '../event-stream/store.js';
import { getProjectBySlug } from '../projects/loader.js';
import type { StateName } from '../state-machine/states.js';
import type { StateSource, WorkItem } from '../state-source/interface.js';
import type { ProjectConfig, StackConfig } from '../types.js';
import { cleanupWorktree, createWorktree } from '../workspaces/worktree.js';
import { runAdvisorReview } from './grill-and-prd/advisor-review.js';
import { runGrillRound } from './grill-and-prd/grill-round.js';
import { runPrdDraft } from './grill-and-prd/prd-draft.js';
import { WorktreeCreationError, withManagedWorktree } from './grill-and-prd/worktree-lifecycle.js';

export interface ProjectContextBundle {
  stackSummary: string;
  contextMd: string;
  adrSummaries: Array<{
    filename: string;
    title: string;
    status: string;
    oneLiner: string;
  }>;
  claudeMd: string;
}

function serializeStack(stack: StackConfig | undefined): string {
  if (stack == null) return '';
  const parts: string[] = [];
  parts.push(`runtime: ${stack.runtime}`);
  parts.push(`packageManager: ${stack.packageManager}`);
  if (stack.buildCommand) parts.push(`build: ${stack.buildCommand}`);
  parts.push(`test: ${stack.testCommand}`);
  if (stack.lintCommand) parts.push(`lint: ${stack.lintCommand}`);
  if (stack.typecheckCommand) parts.push(`typecheck: ${stack.typecheckCommand}`);
  if (stack.e2eCommand) parts.push(`e2e: ${stack.e2eCommand}`);
  return parts.join('\n');
}

function extractAdrMeta(
  filename: string,
  content: string,
): { title: string; status: string; oneLiner: string } {
  const lines = content.split('\n');
  const title =
    lines
      .find((l) => l.startsWith('# '))
      ?.slice(2)
      .trim() ?? filename;
  const statusLine = lines.find((l) => /\*\*status:\*\*/i.test(l));
  const status = statusLine?.replace(/.*\*\*status:\*\*\s*/i, '').trim() ?? 'unknown';
  // Find first sentence of the Context section
  const contextIdx = lines.findIndex((l) => /^#+\s*context/i.test(l));
  let oneLiner = '';
  if (contextIdx !== -1) {
    for (let i = contextIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length === 0) continue;
      if (line.startsWith('#')) break;
      const sentenceMatch = line.match(/^([^.!?]+[.!?])/);
      oneLiner = sentenceMatch ? sentenceMatch[1].trim() : line.slice(0, 120);
      break;
    }
  }
  return { title, status, oneLiner };
}

/**
 * Walk the event-store crystallizations for a work item and attach each
 * decision to its corresponding `agent` entry in priorReplies. Round N's
 * crystallization decorates the Nth agent entry (1-indexed).
 */
function augmentPriorRepliesWithCrystallizations(
  priorReplies: Array<{ role: 'user' | 'agent'; content: string; crystallized?: string }>,
  projectId: string,
  workItemId: string,
): Array<{ role: 'user' | 'agent'; content: string; crystallized?: string }> {
  const events = eventStore.replay({ projectId, workItemId });
  const byRound = new Map<number, string>();
  for (const ev of events) {
    if (ev.kind !== 'grill.decision-crystallized') continue;
    const payload = ev.payload as { roundNumber?: number; decision?: string };
    if (typeof payload.roundNumber !== 'number' || typeof payload.decision !== 'string') continue;
    byRound.set(payload.roundNumber, payload.decision);
  }
  let agentIdx = 0;
  return priorReplies.map((entry) => {
    if (entry.role !== 'agent') return entry;
    if (entry.content.startsWith('<!-- factory:prd -->')) return entry;
    agentIdx += 1;
    const decision = byRound.get(agentIdx);
    return decision != null ? { ...entry, crystallized: decision } : entry;
  });
}

export async function buildProjectContextBundle(localPath: string): Promise<ProjectContextBundle> {
  const expanded = localPath.startsWith('~/')
    ? join(process.env.HOME ?? '/root', localPath.slice(2))
    : localPath;

  const readSafe = async (filePath: string): Promise<string> => {
    try {
      return await readFile(filePath, 'utf-8');
    } catch {
      return '';
    }
  };

  const [contextMd, claudeMd] = await Promise.all([
    readSafe(join(expanded, 'CONTEXT.md')),
    readSafe(join(expanded, 'CLAUDE.md')),
  ]);

  let adrSummaries: ProjectContextBundle['adrSummaries'] = [];
  try {
    const adrDir = join(expanded, 'docs', 'adr');
    const entries = await readdir(adrDir);
    const mdFiles = entries.filter((f) => f.endsWith('.md')).sort();
    adrSummaries = await Promise.all(
      mdFiles.map(async (filename) => {
        const content = await readSafe(join(adrDir, filename));
        const { title, status, oneLiner } = extractAdrMeta(filename, content);
        return { filename, title, status, oneLiner };
      }),
    );
  } catch {
    adrSummaries = [];
  }

  return { stackSummary: '', contextMd, adrSummaries, claudeMd };
}

export interface RunGrillAndPrdInput {
  workItem: WorkItem;
  stateSource: StateSource;
  projectId: string;
  /** Existing reply history sourced from issue comments before this tick */
  priorReplies: Array<{ role: 'user' | 'agent'; content: string }>;
  /** When present, skip grill rounds and revise the prior PRD instead */
  priorPrd?: PRDOutput;
  /** Concerns from the human to address during revision */
  humanConcerns?: string[];
  /** When true: skip grill-me entirely and go straight to write-prd.
   * Recovers refinedIntent from the last grill.completed event in the event store. */
  skipGrill?: boolean;
  deps?: {
    runtime?: AgentRuntime;
    /**
     * Pre-resolved project config. When omitted the workflow falls back to
     * `getProjectBySlug(projectId)`. Tests inject this so they don't have to
     * stub the loader (loader reads disk and caches per-process).
     */
    projectConfig?: Pick<ProjectConfig, 'budgets' | 'stack' | 'targetRepo'> | null;
    /**
     * Stubbed in tests to avoid hitting the real DB. Defaults to the real
     * `totalSpendForSkill` from `core/cost/repository`.
     */
    totalSpendForSkill?: (projectId: string, skill: string) => number;
    /**
     * Stubbed in tests to avoid real filesystem reads. Defaults to
     * `buildProjectContextBundle`.
     */
    buildContext?: (localPath: string) => Promise<ProjectContextBundle>;
    /** Stubbed in tests to avoid real git worktree creation. */
    createWorktreeImpl?: typeof createWorktree;
    /** Stubbed in tests to avoid real git worktree cleanup. */
    cleanupWorktreeImpl?: typeof cleanupWorktree;
    /**
     * Absolute path to the target repository on disk. When provided, overrides
     * `projectConfig.targetRepo.localPath`. Callers that know the repo root
     * (e.g. `REPO_ROOT` in dispatch.ts) should always pass this.
     */
    repoRoot?: string;
  };
}

export interface GrillAndPrdResult {
  phase: 'grilling' | 'prd-review' | 'needs-human';
  questionPosted?: string;
  prdOutput?: unknown;
}

/**
 * Move the work item into `factory:gate-pending` and emit a `state.transitioned`
 * event. The legal-transition table does not allow `factory:grilling ->
 * factory:gate-pending` directly, so this helper attempts `transitionState`
 * first and falls back to `forceState`. The emitted event lets
 * `dispatchResumeIssue` inspect the `from` field and route back to the correct
 * workflow without knowing skill names.
 */
async function ensureGatePending(
  stateSource: StateSource,
  externalId: string,
  fromState: StateName,
  projectId: string,
  workItemId: string,
): Promise<void> {
  if (fromState === 'factory:gate-pending') return;
  try {
    await stateSource.transitionState(externalId, fromState, 'factory:gate-pending');
  } catch {
    await stateSource.forceState(externalId, 'factory:gate-pending');
  }
  emitStateTransitionEvent({
    projectId,
    workItemId,
    from: fromState,
    to: 'factory:gate-pending',
    by: 'grill-and-prd',
  });
}

export async function runGrillAndPrdWorkflow(
  input: RunGrillAndPrdInput,
): Promise<GrillAndPrdResult> {
  const {
    workItem,
    stateSource,
    projectId,
    priorReplies,
    priorPrd,
    humanConcerns,
    deps = {},
  } = input;
  const workflowRunId = crypto.randomUUID();
  const childRunId = (skill: string) => `${workflowRunId}:${skill}`;
  const runtime = deps.runtime;
  const totalSpendForSkill = deps.totalSpendForSkill ?? _totalSpendForSkill;
  const _buildContext = deps.buildContext ?? buildProjectContextBundle;
  const createWorktreeFn = deps.createWorktreeImpl ?? createWorktree;
  const cleanupWorktreeFn = deps.cleanupWorktreeImpl ?? cleanupWorktree;

  const isReviseMode = priorPrd != null;
  const skipGrill = input.skipGrill === true;

  // Pre-condition: only run when the orchestrator has placed us in the
  // discover lane. Anything else means the workflow was invoked out of band.
  // Revise mode accepts prd-review state (re-running write-prd with concerns).
  const validStates: string[] = isReviseMode
    ? ['factory:grilling', 'factory:gate-pending', 'factory:prd-review']
    : skipGrill
      ? ['factory:prd-drafting']
      : ['factory:grilling', 'factory:gate-pending'];
  if (!validStates.includes(workItem.state)) {
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      workItemId: workItem.id,
      runId: workflowRunId,
      payload: {
        skill: 'grill-and-prd',
        workflowRunId,
        error: `expected workItem.state in {${validStates.join(', ')}}, got '${workItem.state}'`,
      },
    });
    return { phase: 'needs-human' };
  }

  const projectConfig =
    deps.projectConfig !== undefined ? deps.projectConfig : await getProjectBySlug(projectId);

  // Build project context bundle for injection into grill-me and write-prd.
  const localPath =
    deps.repoRoot ?? (projectConfig as ProjectConfig | null)?.targetRepo?.localPath ?? '';
  const projectContext = localPath
    ? await _buildContext(localPath).catch(() => ({
        stackSummary: '',
        contextMd: '',
        adrSummaries: [],
        claudeMd: '',
      }))
    : { stackSummary: '', contextMd: '', adrSummaries: [], claudeMd: '' };

  // Merge stackSummary from config into the bundle
  const stackSummary = serializeStack((projectConfig as ProjectConfig | null)?.stack);
  const fullProjectContext = { ...projectContext, stackSummary };

  // ─── Skip-grill mode: jump directly to write-prd ─────────────────────────
  if (skipGrill) {
    const allEvents = eventStore.replay({ projectId, workItemId: workItem.id });
    const grillCompleted = [...allEvents].reverse().find((e) => e.kind === 'grill.completed');
    const refinedIntent =
      (grillCompleted?.payload as { refinedIntent?: string } | null)?.refinedIntent ??
      workItem.title;
    return runWritePrdStep({
      workItem,
      stateSource,
      projectId,
      workflowRunId,
      runtime,
      projectConfig,
      totalSpendForSkill,
      fullProjectContext,
      refinedIntent,
      priorReplies: augmentPriorRepliesWithCrystallizations(priorReplies, projectId, workItem.id),
    });
  }

  // ─── Revise mode: skip grill rounds, go straight to write-prd ───────────
  if (isReviseMode) {
    return runWritePrdStep({
      workItem,
      stateSource,
      projectId,
      workflowRunId,
      runtime,
      projectConfig,
      totalSpendForSkill,
      fullProjectContext,
      refinedIntent: priorPrd?.title ?? workItem.title,
      priorPrd,
      humanConcerns,
      priorReplies: augmentPriorRepliesWithCrystallizations(priorReplies, projectId, workItem.id),
    });
  }

  // Create a per-round detached-HEAD worktree so the grill-me agent has a
  // real checkout to read from. Cleanup always runs in the finally block.
  const localRepoPath =
    deps.repoRoot ?? (projectConfig as ProjectConfig | null)?.targetRepo?.localPath;
  if (localRepoPath == null || localRepoPath === '') {
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      workItemId: workItem.id,
      runId: workflowRunId,
      payload: {
        skill: 'grill-and-prd',
        workflowRunId,
        error: 'cannot create worktree: targetRepo.localPath is missing',
      },
    });
    await stateSource.comment(
      workItem.externalId,
      '<!-- factory:system -->\nGrill cannot run: project is missing `targetRepo.localPath`. Configure it in `target-projects/<slug>/project.config.ts` and resume.',
    );
    await stateSource.forceState(workItem.externalId, 'factory:needs-human');
    return { phase: 'needs-human' };
  }

  // Deferred result variables — all grill-phase exits set these so the finally
  // block always fires before we return or fall through to write-prd.
  let grillPhaseReturn: GrillAndPrdResult | null = null;
  let refinedIntentForPrd: string | null = null;

  // Augment priorReplies with crystallizations from the event store. Hoisted
  // outside try/finally so the post-finally write-prd call can re-augment.
  const augmentedPriorReplies = augmentPriorRepliesWithCrystallizations(
    priorReplies,
    projectId,
    workItem.id,
  );

  try {
    await withManagedWorktree(
      localRepoPath,
      workflowRunId,
      async (worktreePath) => {
        const roundNumber =
          augmentedPriorReplies.filter(
            (r) => r.role === 'agent' && !r.content.startsWith('<!-- factory:prd -->'),
          ).length + 1;

        const grillRunId = childRunId('grill-me');

        const outcome = await runGrillRound({
          workItem: {
            id: workItem.id,
            title: workItem.title,
            body: workItem.body,
            externalId: workItem.externalId,
          },
          projectId,
          workItemId: workItem.id,
          runId: grillRunId,
          workflowRunId,
          worktreePath,
          priorReplies: augmentedPriorReplies,
          projectContext: fullProjectContext,
          projectConfig,
          deps: { runtime },
        });

        if (outcome.status === 'invalid' || outcome.status === 'failed') {
          const errMsg =
            outcome.status === 'invalid'
              ? 'grill-me returned invalid output; waiting for human to resume grilling.'
              : 'grill-me failed; waiting for human to resume grilling.';
          eventStore.appendEvent({
            kind: 'agent.run-failed',
            projectId,
            workItemId: workItem.id,
            runId: grillRunId,
            payload: { skill: 'grill-me', workflowRunId, error: outcome.error },
          });
          await stateSource.comment(workItem.externalId, `<!-- factory:system -->\n${errMsg}`);
          await ensureGatePending(
            stateSource,
            workItem.externalId,
            workItem.state,
            projectId,
            workItem.id,
          );
          grillPhaseReturn = { phase: 'grilling' };
          return;
        }

        const grillOutput = outcome.output;

        if (
          typeof grillOutput.crystallizedDecision === 'string' &&
          grillOutput.crystallizedDecision.trim() !== '' &&
          roundNumber > 1
        ) {
          eventStore.appendEvent({
            kind: 'grill.decision-crystallized',
            projectId,
            workItemId: workItem.id,
            runId: workflowRunId,
            payload: {
              displaySkill: 'grill-me',
              workflowRunId,
              roundNumber: roundNumber - 1,
              decision: grillOutput.crystallizedDecision.trim(),
            },
          });
        }

        reconcileDecisionSummaries(
          grillRunId,
          projectId,
          workItem.id,
          'grill-me',
          grillOutput.decisionSummaries,
        );

        if (outcome.status === 'question') {
          const recommendedBlock =
            outcome.recommendedAnswer != null
              ? `\n<!-- factory:recommended-answer -->\nRecommended: ${outcome.recommendedAnswer}`
              : '';
          await stateSource.comment(
            workItem.externalId,
            `<!-- factory:grill-question -->\n**Round ${roundNumber}** — ${outcome.question}${recommendedBlock}`,
          );
          await ensureGatePending(
            stateSource,
            workItem.externalId,
            workItem.state,
            projectId,
            workItem.id,
          );
          eventStore.appendEvent({
            kind: 'grill.question-posted',
            projectId,
            workItemId: workItem.id,
            runId: workflowRunId,
            payload: {
              displaySkill: 'grill-me',
              workflowRunId,
              roundNumber,
              question: outcome.question,
            },
          });
          grillPhaseReturn = { phase: 'grilling', questionPosted: outcome.question };
          return;
        }

        // outcome.status === 'ready'
        const forced = outcome.forced === true;
        eventStore.appendEvent({
          kind: 'grill.completed',
          projectId,
          workItemId: workItem.id,
          runId: workflowRunId,
          payload: {
            displaySkill: 'grill-me',
            workflowRunId,
            refinedIntent: outcome.refinedIntent,
            rounds: roundNumber,
            ...(forced && { forced: true }),
          },
        });
        refinedIntentForPrd = outcome.refinedIntent;
      },
      (err) => {
        eventStore.appendEvent({
          kind: 'agent.run-failed',
          projectId,
          workItemId: workItem.id,
          runId: workflowRunId,
          payload: {
            skill: 'grill-and-prd',
            workflowRunId,
            error: `worktree cleanup failed: ${String(err)}`,
          },
        });
      },
      { createWorktreeImpl: createWorktreeFn, cleanupWorktreeImpl: cleanupWorktreeFn },
    );
  } catch (err) {
    const isWorktreeCreation = err instanceof WorktreeCreationError;
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      workItemId: workItem.id,
      runId: workflowRunId,
      payload: {
        skill: 'grill-and-prd',
        workflowRunId,
        error: isWorktreeCreation
          ? `worktree creation failed: ${String(err)}`
          : `grill round failed: ${String(err)}`,
      },
    });
    await stateSource.comment(
      workItem.externalId,
      isWorktreeCreation
        ? '<!-- factory:system -->\nGrill could not start: failed to create the per-round worktree. Check the target repo and resume.'
        : '<!-- factory:system -->\nGrill round failed unexpectedly. Check the error log and resume.',
    );
    await ensureGatePending(
      stateSource,
      workItem.externalId,
      workItem.state,
      projectId,
      workItem.id,
    );
    return { phase: 'grilling' };
  }

  if (grillPhaseReturn != null) {
    return grillPhaseReturn;
  }

  return runWritePrdStep({
    workItem,
    stateSource,
    projectId,
    workflowRunId,
    runtime,
    projectConfig,
    totalSpendForSkill,
    fullProjectContext,
    refinedIntent: refinedIntentForPrd ?? workItem.title,
    priorReplies: augmentPriorRepliesWithCrystallizations(
      augmentedPriorReplies,
      projectId,
      workItem.id,
    ),
  });
}

interface WritePrdStepInput {
  workItem: WorkItem;
  stateSource: StateSource;
  projectId: string;
  workflowRunId: string;
  runtime?: AgentRuntime;
  projectConfig: Pick<ProjectConfig, 'budgets' | 'stack' | 'targetRepo'> | null | undefined;
  totalSpendForSkill: (projectId: string, skill: string) => number;
  fullProjectContext: ProjectContextBundle;
  refinedIntent: string;
  priorPrd?: PRDOutput;
  humanConcerns?: string[];
  priorReplies?: Array<{ role: 'user' | 'agent'; content: string; crystallized?: string }>;
}

async function runWritePrdStep(input: WritePrdStepInput): Promise<GrillAndPrdResult> {
  const {
    workItem,
    stateSource,
    projectId,
    workflowRunId,
    runtime,
    projectConfig,
    totalSpendForSkill,
    fullProjectContext,
    refinedIntent,
    priorPrd,
    humanConcerns,
    priorReplies,
  } = input;

  try {
    if (workItem.state === 'factory:grilling') {
      await stateSource.transitionState(
        workItem.externalId,
        'factory:grilling',
        'factory:prd-drafting',
      );
    } else {
      await stateSource.forceState(workItem.externalId, 'factory:prd-drafting');
    }
  } catch {
    await stateSource.forceState(workItem.externalId, 'factory:prd-drafting');
  }

  const prdRunId = `${workflowRunId}:write-prd`;

  const prdDraftOutcome = await runPrdDraft({
    workItem,
    projectId,
    workItemId: workItem.id,
    runId: prdRunId,
    workflowRunId,
    refinedIntent,
    fullProjectContext,
    projectConfig,
    priorReplies,
    priorPrd,
    humanConcerns,
    deps: { runtime },
  });

  if (prdDraftOutcome.status === 'invalid' || prdDraftOutcome.status === 'failed') {
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      workItemId: workItem.id,
      runId: prdRunId,
      payload: {
        skill: 'write-prd',
        workflowRunId,
        error: prdDraftOutcome.error,
        ...(prdDraftOutcome.status === 'invalid' && prdDraftOutcome.issues != null
          ? { issues: prdDraftOutcome.issues }
          : {}),
      },
    });
    return { phase: 'needs-human' };
  }

  let prdOutput = prdDraftOutcome.prdOutput;

  reconcileDecisionSummaries(
    prdRunId,
    projectId,
    workItem.id,
    'write-prd',
    prdOutput.decisionSummaries,
  );

  const advisorRunId = `${workflowRunId}:advise-on-prd`;

  const advisorOutcome = await runAdvisorReview({
    workItem,
    projectId,
    workItemId: workItem.id,
    runId: advisorRunId,
    workflowRunId,
    prdOutput,
    projectConfig,
    totalSpendForSkill,
    deps: { runtime },
  });

  let advisorConcerns: string[] | null = null;

  if (advisorOutcome.status === 'skipped') {
    eventStore.appendEvent({
      kind: 'prd.advisor-skipped',
      projectId,
      workItemId: workItem.id,
      runId: workflowRunId,
      payload: { workflowRunId, reason: advisorOutcome.reason },
    });
  } else if (advisorOutcome.status === 'invalid' || advisorOutcome.status === 'failed') {
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      workItemId: workItem.id,
      runId: advisorRunId,
      payload: { skill: 'advise-on-prd', workflowRunId, error: advisorOutcome.error },
    });
    await stateSource.forceState(workItem.externalId, 'factory:needs-human');
    return { phase: 'needs-human' };
  } else {
    prdOutput = advisorOutcome.prdOutput;
    advisorConcerns = advisorOutcome.concerns;
    reconcileDecisionSummaries(
      advisorRunId,
      projectId,
      workItem.id,
      'advise-on-prd',
      advisorOutcome.decisionSummaries,
    );
  }

  const concernsBlock =
    advisorConcerns != null && advisorConcerns.length > 0
      ? `\n\n## Advisor concerns\n${advisorConcerns.map((c) => `- ${c}`).join('\n')}`
      : '';
  const commentBody = `<!-- factory:prd -->\n# PRD\n\n\`\`\`json\n${JSON.stringify(prdOutput, null, 2)}\n\`\`\`${concernsBlock}`;

  try {
    await stateSource.comment(workItem.externalId, commentBody);
    await stateSource.transitionState(
      workItem.externalId,
      'factory:prd-drafting',
      'factory:prd-review',
    );
  } catch (err) {
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      workItemId: workItem.id,
      runId: workflowRunId,
      payload: { skill: 'grill-and-prd', workflowRunId, error: String(err) },
    });
    await stateSource.forceState(workItem.externalId, 'factory:needs-human');
    return { phase: 'needs-human' };
  }

  try {
    eventStore.appendEvent({
      kind: 'prd.drafted',
      projectId,
      workItemId: workItem.id,
      runId: workflowRunId,
      payload: { displaySkill: 'write-prd', workflowRunId, prd: prdOutput, advisorConcerns },
    });
  } catch (err) {
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      workItemId: workItem.id,
      runId: prdRunId,
      payload: {
        skill: 'write-prd',
        workflowRunId,
        error: `prd.drafted emit failed: ${String(err)}`,
      },
    });
    return { phase: 'needs-human' };
  }
  return { phase: 'prd-review', prdOutput };
}
