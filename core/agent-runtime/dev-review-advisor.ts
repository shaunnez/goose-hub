import { spawnSync } from 'node:child_process';
import {
  type DevReviewResponseOutput,
  DevReviewResponseOutputSchema,
} from '@goose-hub/skills/dev-review-response/schema.js';
import devReviewResponseConfig from '@goose-hub/skills/dev-review-response/skill.config.js';
import {
  type DevReviewOutput,
  DevReviewOutputSchema,
} from '@goose-hub/skills/dev-review/schema.js';
import devReviewConfig from '@goose-hub/skills/dev-review/skill.config.js';
import { readProjectDevReviewSettings } from '../db/repositories/project-dev-review-settings.js';
import type { AgentEvent, AppendEventInput } from '../event-stream/store.js';
import { eventStore } from '../event-stream/store.js';
import { getProjectBySlug } from '../projects/loader.js';
import type { WorkItem } from '../state-source/interface.js';
import type { AgentConfig } from '../types.js';
import { GIT_ENV } from '../workspaces/git-env.js';
import type { AgentRuntime } from './interface.js';
import { readPromptWithContext } from './read-prompt.js';
import { reconcileDecisionSummaries } from './reconcile-decisions.js';
import { resolveBudgetsForProject } from './resolve-for-project.js';
import { toJsonSchema } from './schema-bridge.js';
import { selectPersona } from './select-persona.js';
import { selectRuntime } from './select-runtime.js';

// ─── Trigger-on priority ordering ─────────────────────────────────────────────

const PRIORITY_ORDER = ['low', 'medium', 'high', 'critical'] as const;
type Priority = (typeof PRIORITY_ORDER)[number];

/** Returns true when the work item's priority satisfies the configured triggerOn. */
export function shouldRunDevReview(triggerOn: string, priority: string): boolean {
  const idx = PRIORITY_ORDER.indexOf(priority as Priority);
  if (idx === -1) return false;
  if (triggerOn === 'all') return true;
  if (triggerOn === 'priority:medium+') return idx >= PRIORITY_ORDER.indexOf('medium');
  if (triggerOn === 'priority:high+') return idx >= PRIORITY_ORDER.indexOf('high');
  if (triggerOn === 'priority:critical') return idx >= PRIORITY_ORDER.indexOf('critical');
  return false;
}

// ─── Diff helper ──────────────────────────────────────────────────────────────

/**
 * Returns the unified diff of the integration worktree vs base branch.
 * Pure git diff — no shell interpolation (FACTORY_RULES rule 29).
 * Truncated at 200 KB to avoid blowing Codex's context.
 */
export function getDiffForDevReview(worktreePath: string, baseBranch = 'main'): string {
  const result = spawnSync('git', ['diff', `${baseBranch}...HEAD`], {
    cwd: worktreePath,
    encoding: 'utf8',
    maxBuffer: 200 * 1024,
    env: GIT_ENV,
  });
  if (result.error) throw result.error;
  return result.stdout ?? '';
}

// ─── Effective config ─────────────────────────────────────────────────────────

export interface EffectiveDevReviewConfig {
  enabled: boolean;
  triggerOn: string;
  maxRevisionTurns: number;
  perCycleMaxUsd: number;
  timeoutMs: number;
}

/**
 * Resolves the effective dev-review config for a project, with DB row
 * winning over project.config.ts values, which win over hard defaults.
 */
export function resolveDevReviewConfig(
  projectId: string,
  configDevReview: AgentConfig['devReview'] | undefined,
): EffectiveDevReviewConfig {
  const dbRow = readProjectDevReviewSettings(projectId);
  return {
    enabled: dbRow?.enabled ?? configDevReview?.enabled ?? false,
    triggerOn: dbRow?.triggerOn ?? configDevReview?.triggerOn ?? 'priority:high+',
    maxRevisionTurns: dbRow?.maxRevisionTurns ?? configDevReview?.maxRevisionTurns ?? 1,
    perCycleMaxUsd: dbRow?.perCycleMaxUsd ?? configDevReview?.perCycleMaxUsd ?? 2.0,
    timeoutMs: dbRow?.timeoutMs ?? configDevReview?.timeoutMs ?? 180_000,
  };
}

// ─── Input types ──────────────────────────────────────────────────────────────

export interface RunDevReviewInput {
  runId: string;
  projectId: string;
  workItemId: string;
  workItem: { title: string; body: string; number: number; priority: string };
  worktreePath: string;
  baseBranch?: string;
  stack?: { testCommand?: string; lintCommand?: string; typecheckCommand?: string };
  /** Optional runtime override — defaults to CodexCliRuntime via selectRuntime('auto'). */
  runtime?: AgentRuntime;
  appendEvent: (input: AppendEventInput) => AgentEvent;
}

export interface RunDevReviewResponseInput {
  runId: string;
  projectId: string;
  workItemId: string;
  workItem: { title: string; body: string; number: number; priority: string };
  prDiff: string;
  devReviewFindings: DevReviewOutput['findings'];
  worktreePath: string;
  stack?: { testCommand?: string; lintCommand?: string; typecheckCommand?: string };
  /** Optional runtime override — defaults to ClaudeCliRuntime (Claude developer). */
  runtime?: AgentRuntime;
  appendEvent: (input: AppendEventInput) => AgentEvent;
}

// ─── runDevReview ─────────────────────────────────────────────────────────────

/**
 * Runs the `dev-review` Codex skill against the diff in the integration
 * worktree. Returns the parsed output. Emits decision summaries and a
 * `dev-review.completed` event.
 *
 * Mirrors the `adviseOnPlan` pattern in `advisor.ts`.
 */
export async function runDevReview(input: RunDevReviewInput): Promise<DevReviewOutput> {
  const projectConfig = await getProjectBySlug(input.projectId);
  const configRuntime = projectConfig?.agentConfig?.runtime ?? 'auto';

  const runtime =
    input.runtime ?? selectRuntime({ configRuntime, skillProvider: devReviewConfig.provider });

  const { personaId } = selectPersona(input.projectId, devReviewConfig.role ?? 'dev-reviewer');
  const prompt = readPromptWithContext('dev-review', input.projectId);
  const outputJsonSchema = toJsonSchema(DevReviewOutputSchema) as Record<string, unknown>;
  const budgets = resolveBudgetsForProject('dev-review', projectConfig?.budgets, input.projectId);

  const prDiff = getDiffForDevReview(input.worktreePath, input.baseBranch ?? 'main');
  const devReviewRunId = `${input.runId}:dev-review`;

  input.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'dev-review.started',
    payload: { runId: devReviewRunId, worktreePath: input.worktreePath },
    runId: devReviewRunId,
  });

  const result = await runtime.run({
    runId: devReviewRunId,
    role: devReviewConfig.role ?? 'dev-reviewer',
    skill: 'dev-review',
    context: {
      projectId: input.projectId,
      workItemId: input.workItemId,
      workItem: input.workItem,
      prDiff,
      projectCommands: input.stack,
    },
    contextAllowlist: devReviewConfig.contextAllowlist ?? [],
    freshContext: devReviewConfig.freshContext as true,
    toolBundles: devReviewConfig.toolBundles,
    toolExtras: [],
    ...budgets,
    personaId,
    outputJsonSchema,
    appendSystemPrompt: prompt,
  });

  const parsed = DevReviewOutputSchema.safeParse(result.output);
  if (!parsed.success) {
    input.appendEvent({
      projectId: input.projectId,
      workItemId: input.workItemId,
      kind: 'dev-review.failed',
      payload: { runId: devReviewRunId, error: 'dev-review output validation failed' },
      runId: devReviewRunId,
    });
    throw new Error('dev-review output validation failed');
  }

  reconcileDecisionSummaries(
    devReviewRunId,
    input.projectId,
    input.workItemId,
    'dev-review',
    parsed.data.decisionSummaries,
  );

  input.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'dev-review.completed',
    payload: {
      runId: devReviewRunId,
      verdict: parsed.data.verdict,
      findingCount: parsed.data.findings.length,
    },
    runId: devReviewRunId,
  });

  return parsed.data;
}

// ─── runDevReviewResponse ─────────────────────────────────────────────────────

/**
 * Runs the `dev-review-response` Claude skill in the integration worktree.
 * The developer receives findings in context, may make code changes, and
 * returns a structured disposition per finding.
 *
 * For each finding disposition, emits an `agent.decision-summary` event of
 * kind `DEV_REVIEW_ADDRESSED` or `DEV_REVIEW_DISMISSED`. These events are
 * excluded from QA/Reviewer context by HOLDOUT_FORBIDDEN_KEYS in
 * context-assembly.ts.
 */
export async function runDevReviewResponse(
  input: RunDevReviewResponseInput,
): Promise<DevReviewResponseOutput> {
  const projectConfig = await getProjectBySlug(input.projectId);
  const configRuntime = projectConfig?.agentConfig?.runtime ?? 'claude-cli';

  const runtime =
    input.runtime ??
    // dev-review-response uses Claude (developer role) — not Codex.
    selectRuntime({ configRuntime: configRuntime === 'codex-cli' ? 'claude-cli' : configRuntime });

  const { personaId } = selectPersona(input.projectId, devReviewResponseConfig.role ?? 'developer');
  const prompt = readPromptWithContext('dev-review-response', input.projectId);
  const outputJsonSchema = toJsonSchema(DevReviewResponseOutputSchema) as Record<string, unknown>;
  const budgets = resolveBudgetsForProject(
    'dev-review-response',
    projectConfig?.budgets,
    input.projectId,
  );

  const responseRunId = `${input.runId}:dev-review-response`;

  input.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'dev-review.response-started',
    payload: { runId: responseRunId, findingCount: input.devReviewFindings.length },
    runId: responseRunId,
  });

  const result = await runtime.run({
    runId: responseRunId,
    role: devReviewResponseConfig.role ?? 'developer',
    skill: 'dev-review-response',
    context: {
      projectId: input.projectId,
      workItemId: input.workItemId,
      workItem: input.workItem,
      prDiff: input.prDiff,
      devReviewFindings: input.devReviewFindings,
      worktreePath: input.worktreePath,
      stack: input.stack,
    },
    contextAllowlist: devReviewResponseConfig.contextAllowlist ?? [],
    freshContext: false,
    toolBundles: devReviewResponseConfig.toolBundles,
    toolExtras: [],
    ...budgets,
    personaId,
    outputJsonSchema,
    appendSystemPrompt: prompt,
    workspaceDir: input.worktreePath,
  });

  const parsed = DevReviewResponseOutputSchema.safeParse(result.output);
  if (!parsed.success) {
    input.appendEvent({
      projectId: input.projectId,
      workItemId: input.workItemId,
      kind: 'dev-review.response-failed',
      payload: { runId: responseRunId, error: 'dev-review-response output validation failed' },
      runId: responseRunId,
    });
    throw new Error('dev-review-response output validation failed');
  }

  // Synthesize per-finding decision summaries from disposition output.
  // Passed as parsedSummaries fallback; DB rows win if hook captured them.
  const dispositionSummaries = parsed.data.findingDispositions.map((disp) => ({
    kind: (disp.disposition === 'addressed'
      ? 'DEV_REVIEW_ADDRESSED'
      : 'DEV_REVIEW_DISMISSED') as import('./decision-types.js').DecisionKind,
    summary:
      disp.disposition === 'addressed'
        ? `Addressed ${disp.severity} finding at ${disp.findingRef}`
        : `Dismissed ${disp.severity} finding at ${disp.findingRef}: ${disp.reason ?? '(no reason)'}`,
    evidence: disp.findingRef,
  }));
  reconcileDecisionSummaries(
    responseRunId,
    input.projectId,
    input.workItemId,
    'dev-review-response',
    dispositionSummaries,
  );

  input.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'dev-review.response-completed',
    payload: {
      runId: responseRunId,
      addressed: parsed.data.findingDispositions.filter((d) => d.disposition === 'addressed')
        .length,
      dismissed: parsed.data.findingDispositions.filter((d) => d.disposition === 'dismissed')
        .length,
    },
    runId: responseRunId,
  });

  return parsed.data;
}
