import type { AcceptanceContract } from '@goose-hub/core/acceptance-contracts/types.js';
import type { AgentRuntime, AgentSpec } from '@goose-hub/core/agent-runtime/interface.js';
// slices/review/review-spec.ts
import type { resolveBudgetsForProject } from '@goose-hub/core/agent-runtime/resolve-for-project.js';
import type { ReviewerSlot } from '@goose-hub/core/db/repositories/project-review-settings.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import type { ReviewOutput } from '@goose-hub/skills/review/schema.js';

export const DEFAULT_MAX_REVIEW_ROUNDS = 3;

/** Composite deduplication key for a review finding. Maps `description` as ruleId surrogate. */
export interface FindingKey {
  file: string;
  line: number;
  ruleId: string;
  isCritical: boolean;
}

export interface ReviewWaveResult {
  roundFindings: FindingKey[];
  newCriticalFindings: FindingKey[];
  reviewerOutputs: Array<{
    parsed: ReviewOutput;
    runId: string;
    round: number;
    slotIndex: number;
    slotModel: ReviewerSlot['model'];
    promptVariant: ReviewerSlot['prompt'];
  }>;
  parseFailure: boolean;
  parseFailureError?: string;
  /** True if any reviewer returned verdict: 'needs-human' — must escalate immediately. */
  anyNeedsHuman: boolean;
  /** True if any reviewer returned verdict: 'needs-fix' — prevents convergence counting. */
  anyNeedsFix: boolean;
  /** True when some reviewers approved and others returned needs-fix — escalate immediately. */
  verdictsDiverge: boolean;
}

export interface DispatchReviewWaveOpts {
  pr: { externalId: string; prDiff: string };
  qaResult?: { verdict: string; overallScore: number };
  acceptanceContract?: AcceptanceContract | null;
  round: number;
  /** Findings from the immediately prior round (empty for round 1). */
  priorFindings: FindingKey[];
  workItem: WorkItem;
  projectSlug: string;
  reviewWorkflowRunId: string;
  /** Returns the runtime to use for a given slot model. */
  runtimeForSlot: (model: ReviewerSlot['model']) => AgentRuntime;
}

export function toFindingKey(f: {
  file?: string;
  line?: number;
  description: string;
  severity: string;
}): FindingKey {
  return {
    file: f.file ?? '',
    line: f.line ?? -1,
    ruleId: f.description,
    isCritical: f.severity === 'blocker',
  };
}

export function findingKeyStr(k: FindingKey): string {
  return JSON.stringify([k.file, k.line, k.ruleId]);
}

export function deduplicateFindings(
  findings: Array<{ file?: string; line?: number; description: string; severity: string }>,
): FindingKey[] {
  const seen = new Set<string>();
  const result: FindingKey[] = [];
  for (const f of findings) {
    const key = toFindingKey(f);
    const str = findingKeyStr(key);
    if (!seen.has(str)) {
      seen.add(str);
      result.push(key);
    }
  }
  return result;
}

export function extractChangedFilePaths(prDiff: string): string[] {
  const paths: string[] = [];
  for (const line of prDiff.split('\n')) {
    const m = line.match(/^diff --git a\/.+ b\/(.+)$/);
    if (m?.[1] != null) paths.push(m[1]);
  }
  return paths;
}

/** Default reviewer slots: constrained + unconstrained, both on claude. */
export const DEFAULT_REVIEWER_SLOTS: ReviewerSlot[] = [
  { model: 'claude', prompt: 'default' },
  { model: 'claude', prompt: 'unconstrained' },
];

/** Shared spec builder for both single and convergent review paths. */
export function buildReviewSpec(params: {
  runId: string;
  projectSlug: string;
  workItem: WorkItem;
  prDiff: string;
  qaResult?: { verdict: string; overallScore: number };
  acceptanceContract?: AcceptanceContract | null;
  personaId: string;
  reviewPrompt: string;
  reviewJsonSchema: Record<string, unknown>;
  resolvedBudgets: ReturnType<typeof resolveBudgetsForProject>;
  extraEventPayload?: Record<string, unknown>;
}): AgentSpec {
  return {
    runId: params.runId,
    role: 'reviewer',
    skill: 'review',
    context: {
      projectId: params.projectSlug,
      workItemId: params.workItem.id,
      workItem: {
        title: params.workItem.title,
        body: params.workItem.body,
        number: Number(params.workItem.externalId),
      },
      prDiff: params.prDiff,
      qaVerdict: params.qaResult,
      acceptanceContract: params.acceptanceContract ?? undefined,
    },
    contextAllowlist: ['workItem', 'prDiff', 'qaVerdict', 'acceptanceContract'],
    freshContext: true,
    toolBundles: ['read', 'validate'],
    toolExtras: [],
    ...params.resolvedBudgets,
    personaId: params.personaId,
    outputJsonSchema: params.reviewJsonSchema,
    appendSystemPrompt: params.reviewPrompt,
    extraEventPayload: params.extraEventPayload,
  };
}
