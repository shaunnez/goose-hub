import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { maybeStoreLargePayload } from '../agent-artifacts/repository.js';
import type { ArtifactRef } from '../agent-artifacts/types.js';
import { readProjectDevReviewSettings } from '../db/repositories/project-dev-review-settings.js';
import type { AgentEvent, AppendEventInput } from '../event-stream/store.js';
import { eventStore } from '../event-stream/store.js';
import { getProjectBySlug } from '../projects/loader.js';
import type { WorkItem } from '../state-source/interface.js';
import {
  emitSymbolIndexHintsUsedEvent,
  offeredHintsFromSymbolImpact,
} from '../symbol-index/hints-used.js';
import { lookupChangedExportImpact } from '../symbol-index/lookup.js';
import type { AgentConfig } from '../types.js';
import { GIT_ENV } from '../workspaces/git-env.js';
import { type DiffDigest, buildDiffDigest, formatDiffDigestSummary } from './diff-digest.js';
import type { AgentRuntime } from './interface.js';
import { safeParseOutputForSchema } from './output-normalization.js';
import { readPromptWithContext } from './read-prompt.js';
import { reconcileDecisionSummaries } from './reconcile-decisions.js';
import { resolveBudgetsForProject } from './resolve-for-project.js';
import { resolveProjectAgentExecution } from './resolve-runtime-for-project.js';
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
 * The prompt handoff stores large diffs as artifacts before spawning Codex.
 */
export function getDiffForDevReview(worktreePath: string, baseBranch = 'main'): string {
  const result = spawnSync('git', ['diff', `${baseBranch}...HEAD`], {
    cwd: worktreePath,
    encoding: 'utf8',
    maxBuffer: 5 * 1024 * 1024,
    env: GIT_ENV,
  });
  if (result.error) throw result.error;
  return result.stdout ?? '';
}

function summarizePrDiff(prDiff: string): string {
  return formatDiffDigestSummary(buildDiffDigest(prDiff));
}

function diffArtifactKey(
  projectId: string,
  workItemId: string,
  runId: string,
  prDiff: string,
): string {
  const hash = createHash('sha256')
    .update(JSON.stringify({ projectId, workItemId, runId, prDiff }))
    .digest('hex')
    .slice(0, 24);
  return `pr-diff:${hash}`;
}

export function preparePrDiffContext(input: {
  projectId: string;
  workItemId: string;
  runId: string;
  prDiff: string;
  thresholdBytes?: number;
}): {
  prDiffContext: string;
  artifactRef?: ArtifactRef;
  summary: string;
  changedFiles: string[];
  digest: DiffDigest;
  disclosure?: {
    kind: 'diff_summarized';
    rawBytes: number;
    contextBytes: number;
    bytesSaved: number;
    artifactKeys: string[];
  };
} {
  const summary = summarizePrDiff(input.prDiff);
  const maybeStored = maybeStoreLargePayload({
    projectId: input.projectId,
    workItemId: input.workItemId,
    runId: input.runId,
    kind: 'pr-diff',
    payload: input.prDiff,
    summary,
    thresholdBytes: input.thresholdBytes,
    artifactKey: diffArtifactKey(input.projectId, input.workItemId, input.runId, input.prDiff),
  });

  const rawBytes = Buffer.byteLength(input.prDiff, 'utf8');

  if (maybeStored.stored === false) {
    const digest = buildDiffDigest(maybeStored.payload);
    return {
      prDiffContext: [
        'PR diff digest:',
        JSON.stringify(digest, null, 2),
        '',
        'Full PR diff kept inline because it is below the artifact threshold:',
        maybeStored.payload,
      ].join('\n'),
      summary: formatDiffDigestSummary(digest),
      changedFiles: digest.changedFiles.map((file) => file.path),
      digest,
    };
  }

  const digest = buildDiffDigest(input.prDiff, maybeStored);
  const prDiffContext = [
    'PR diff digest:',
    JSON.stringify(digest, null, 2),
    '',
    'Full PR diff omitted from prompt context and stored as an agent artifact.',
    `ArtifactRef: ${JSON.stringify(maybeStored)}`,
    'Review from this digest plus targeted file reads in the worktree. Do not fabricate line-specific findings unless verified from provided context or a file read.',
  ].join('\n');
  const contextBytes = Buffer.byteLength(prDiffContext, 'utf8');

  return {
    prDiffContext,
    artifactRef: maybeStored,
    summary: formatDiffDigestSummary(digest),
    changedFiles: digest.changedFiles.map((file) => file.path),
    digest,
    disclosure: {
      kind: 'diff_summarized',
      rawBytes,
      contextBytes,
      bytesSaved: Math.max(0, rawBytes - contextBytes),
      artifactKeys: [maybeStored.artifactKey],
    },
  };
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
  /** Optional runtime override — otherwise resolved from project skill runtime settings. */
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
  const preparedDiff = preparePrDiffContext({
    projectId: input.projectId,
    workItemId: input.workItemId,
    runId: input.runId,
    prDiff,
  });
  const symbolImpact = lookupChangedExportImpact(preparedDiff.changedFiles, {
    worktreePath: input.worktreePath,
  });

  if (preparedDiff.disclosure != null) {
    input.appendEvent({
      projectId: input.projectId,
      workItemId: input.workItemId,
      kind: 'agent.disclosure',
      payload: {
        ...preparedDiff.disclosure,
        skill: 'dev-review',
      },
      runId: devReviewRunId,
    });
  }

  input.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'dev-review.started',
    payload: {
      runId: devReviewRunId,
      worktreePath: input.worktreePath,
      diffSummary: preparedDiff.summary,
      diffArtifactRef: preparedDiff.artifactRef,
      diffDigest: preparedDiff.digest,
    },
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
      prDiff: preparedDiff.prDiffContext,
      projectCommands: input.stack,
      ...(symbolImpact.length > 0 ? { symbolImpact } : {}),
    },
    contextAllowlist: devReviewConfig.contextAllowlist ?? [],
    freshContext: devReviewConfig.freshContext as true,
    toolBundles: devReviewConfig.toolBundles,
    toolExtras: [],
    ...budgets,
    personaId,
    outputJsonSchema,
    appendSystemPrompt: prompt,
    workspaceDir: input.worktreePath,
  });
  emitSymbolIndexHintsUsedEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    consumerSkill: 'dev-review',
    runId: devReviewRunId,
    parentRunId: input.runId,
    personaId,
    offeredHints: offeredHintsFromSymbolImpact(symbolImpact),
    toolEvents: eventStore.replay({ runId: devReviewRunId, kind: 'agent.tool-call' }),
    worktreePath: input.worktreePath,
    appendEvent: input.appendEvent,
  });

  const parsed = safeParseOutputForSchema(DevReviewOutputSchema, result.output);
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
 * Runs the `dev-review-response` skill in the integration worktree. The
 * developer receives findings in context, may make code changes, and returns a
 * structured disposition per finding.
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
  const role = devReviewResponseConfig.role ?? 'developer';
  const { runtime, resolvedBudget } = resolveProjectAgentExecution({
    skill: 'dev-review-response',
    role,
    projectId: input.projectId,
    projectConfig,
    injectedRuntime: input.runtime,
    skillProvider: devReviewResponseConfig.provider,
  });

  const { personaId } = selectPersona(input.projectId, role);
  const prompt = readPromptWithContext('dev-review-response', input.projectId);
  const outputJsonSchema = toJsonSchema(DevReviewResponseOutputSchema) as Record<string, unknown>;

  const responseRunId = `${input.runId}:dev-review-response`;
  const preparedDiff = preparePrDiffContext({
    projectId: input.projectId,
    workItemId: input.workItemId,
    runId: input.runId,
    prDiff: input.prDiff,
  });

  if (preparedDiff.disclosure != null) {
    input.appendEvent({
      projectId: input.projectId,
      workItemId: input.workItemId,
      kind: 'agent.disclosure',
      payload: {
        ...preparedDiff.disclosure,
        skill: 'dev-review-response',
      },
      runId: responseRunId,
    });
  }

  input.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'dev-review.response-started',
    payload: {
      runId: responseRunId,
      findingCount: input.devReviewFindings.length,
      diffSummary: preparedDiff.summary,
      diffArtifactRef: preparedDiff.artifactRef,
      diffDigest: preparedDiff.digest,
    },
    runId: responseRunId,
  });

  const result = await runtime.run({
    runId: responseRunId,
    role,
    skill: 'dev-review-response',
    context: {
      projectId: input.projectId,
      workItemId: input.workItemId,
      workItem: input.workItem,
      prDiff: preparedDiff.prDiffContext,
      devReviewFindings: input.devReviewFindings,
      stack: input.stack,
    },
    contextAllowlist: devReviewResponseConfig.contextAllowlist ?? [],
    freshContext: false,
    toolBundles: devReviewResponseConfig.toolBundles,
    toolExtras: [],
    ...resolvedBudget,
    personaId,
    outputJsonSchema,
    appendSystemPrompt: prompt,
    workspaceDir: input.worktreePath,
  });

  const parsed = safeParseOutputForSchema(DevReviewResponseOutputSchema, result.output);
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
