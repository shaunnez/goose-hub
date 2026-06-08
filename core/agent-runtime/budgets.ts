import type { ModelProvider, ModelTier, RuntimeEffort } from '../types.js';
import type { AgentBudgets } from './interface.js';
import { defaultModelForTierAndProvider } from './models.js';

export interface SkillBudget {
  maxTurns: number;
  maxBudgetUsd: number;
  timeoutMs: number;
  modelTier: ModelTier;
  /** Runtime reasoning effort. Only enforced by runtimes that support it. */
  effort?: RuntimeEffort | null;
  /** Default provider for this skill. Omit for Claude (the default). */
  provider?: ModelProvider;
  /**
   * Escalation policy for schema-validation failures. When present,
   * `runWithEscalation` may retry once at the escalated tier with the
   * supplied budget. Sonnet costs ~10× haiku per token, so escalated
   * `maxBudgetUsd` should be sized accordingly — reuse of the base haiku
   * budget would risk hitting the cap mid-run.
   *
   * Only set this on skills where retry is worth the cost (`implement`).
   * Triage / repo-match / evidence-post fail loudly instead — the savings
   * there don't justify the complexity.
   */
  escalation?: {
    modelTier: ModelTier;
    maxBudgetUsd: number;
    maxTurns?: number;
    timeoutMs?: number;
  };
}

export type SkillBudgetOverride = Partial<SkillBudget>;

/**
 * Canonical per-skill budget defaults. Derived from observed run telemetry
 * with a 3-5× safety margin. modelTier drives the starting model; workflows
 * may escalate to a higher tier on schema-validation failure (future).
 *
 * Numbers sourced from actual runs — not guesses:
 *   triage: 39s, <10 turns, $0.0003
 *   repo-match: 10s, <10 turns, $0.0003
 *   evidence-post: 3min, 17 turns, $0.53
 *   implement: 6min, 45 turns, $1.61  (simple feature)
 *   qa: 3.5min, 29 turns, $0.66
 *   review: 35s, <10 turns, $0.09
 *   retro-light: 34s, <10 turns, $0.06
 *   retro-deep: 1.5min, <10 turns, $0.11
 */
export const SKILL_BUDGETS: Record<string, SkillBudget> = {
  triage: { maxTurns: 25, maxBudgetUsd: 1, timeoutMs: 120_000, modelTier: 'haiku' },
  'repo-match': { maxTurns: 25, maxBudgetUsd: 1, timeoutMs: 60_000, modelTier: 'haiku' },
  'bug-enhance': { maxTurns: 15, maxBudgetUsd: 0.5, timeoutMs: 120_000, modelTier: 'haiku' },
  'feature-frame': {
    maxTurns: 20,
    maxBudgetUsd: 1.0,
    timeoutMs: 180_000,
    modelTier: 'sonnet',
  },
  'feature-enhance': {
    maxTurns: 15,
    maxBudgetUsd: 0.5,
    timeoutMs: 120_000,
    modelTier: 'haiku',
    effort: 'low',
  },
  'feature-grounding': {
    maxTurns: 50,
    maxBudgetUsd: 2.0,
    timeoutMs: 300_000,
    modelTier: 'haiku',
  },
  'evidence-post': { maxTurns: 60, maxBudgetUsd: 2.0, timeoutMs: 300_000, modelTier: 'haiku' },
  implement: {
    maxTurns: 150,
    maxBudgetUsd: 6.0,
    timeoutMs: 900_000,
    modelTier: 'sonnet',
    // Sonnet retry: ~2.5× haiku cap to absorb the per-token price delta on
    // a comparable turn count. Keep maxTurns/timeoutMs from the base.
    escalation: { modelTier: 'sonnet', maxBudgetUsd: 15.0 },
  },
  qa: { maxTurns: 100, maxBudgetUsd: 3.0, timeoutMs: 600_000, modelTier: 'sonnet' },
  review: { maxTurns: 25, maxBudgetUsd: 0.5, timeoutMs: 180_000, modelTier: 'sonnet' },
  'resolve-conflict': { maxTurns: 75, maxBudgetUsd: 4.0, timeoutMs: 600_000, modelTier: 'sonnet' },
  investigate: { maxTurns: 50, maxBudgetUsd: 4.0, timeoutMs: 180_000, modelTier: 'sonnet' },
  'acceptance-contract': {
    maxTurns: 20,
    maxBudgetUsd: 0.5,
    timeoutMs: 120_000,
    modelTier: 'haiku',
  },
  'playwright-repro': { maxTurns: 60, maxBudgetUsd: 3.0, timeoutMs: 600_000, modelTier: 'sonnet' },
  'advise-on-plan': { maxTurns: 15, maxBudgetUsd: 1.5, timeoutMs: 180_000, modelTier: 'opus' },
  'spec-author': { maxTurns: 50, maxBudgetUsd: 7, timeoutMs: 900_000, modelTier: 'sonnet' },
  'retrospective-light': {
    maxTurns: 25,
    maxBudgetUsd: 0.3,
    timeoutMs: 180_000,
    modelTier: 'haiku',
  },
  'retrospective-deep': {
    maxTurns: 30,
    maxBudgetUsd: 0.5,
    timeoutMs: 300_000,
    modelTier: 'sonnet',
  },
  // Cross-run retro reasons over a window of lifecycles (M11.12). Larger
  // context window than per-merge retros, so a higher turn/budget cap.
  'retrospective-cross-run': {
    maxTurns: 40,
    maxBudgetUsd: 1.0,
    timeoutMs: 420_000,
    modelTier: 'sonnet',
  },
  // Skill coach reads skill source + evidence patterns and proposes diffs (M11.13).
  // Reasoning-heavy; sonnet is the starting tier, opus available as escalation path
  // via project config override if needed.
  'skill-coach': {
    maxTurns: 50,
    maxBudgetUsd: 2.0,
    timeoutMs: 600_000,
    modelTier: 'sonnet',
  },
  // M13 Discover Lane — one focused question per round, capped at 7 rounds.
  // Cheap per-round; the workflow is the loop, not the skill.
  'grill-me': {
    maxTurns: 100,
    maxBudgetUsd: 6,
    timeoutMs: 300_000,
    modelTier: 'sonnet',
  },
  // M13 — fresh-context PRD writer. Three-layer artefact (Journey →
  // FunctionalSpec → SliceOutline) is reasoning-heavy; opus fits the role
  // model declared in goose-hub-self/project.config.ts.
  'write-prd': {
    maxTurns: 40,
    maxBudgetUsd: 2.0,
    timeoutMs: 420_000,
    modelTier: 'opus',
  },
  // M13 — priority-gated PRD advisor. One revision pass; cheap.
  'advise-on-prd': {
    maxTurns: 15,
    maxBudgetUsd: 1.0,
    timeoutMs: 180_000,
    modelTier: 'opus',
  },
  // M13 — turns SliceOutlines into vertical-slice issue bodies.
  'decompose-issues': {
    maxTurns: 30,
    maxBudgetUsd: 0.5,
    timeoutMs: 240_000,
    modelTier: 'sonnet',
  },
  // M13 — milestone-rollup writer (sprint review issue at milestone end).
  'sprint-review': {
    maxTurns: 25,
    maxBudgetUsd: 1,
    timeoutMs: 240_000,
    modelTier: 'sonnet',
  },
  // M19.01 — Wave-1 scouts. Read-only fact-gathering; cheap and bounded.
  // Schema scouting should exit after locating a contract surface or declaring
  // uncertainty; longer runs tend to duplicate code-path/runtime scouts.
  'scout-schema': {
    maxTurns: 20,
    maxBudgetUsd: 1,
    timeoutMs: 120_000,
    modelTier: 'sonnet',
    effort: 'low',
  },
  'scout-code-path': {
    maxTurns: 50,
    maxBudgetUsd: 2,
    timeoutMs: 240_000,
    modelTier: 'haiku',
    effort: 'low',
  },
  'scout-pattern': {
    maxTurns: 20,
    maxBudgetUsd: 1,
    timeoutMs: 240_000,
    modelTier: 'haiku',
    effort: 'low',
  },
  'scout-test-inventory': {
    maxTurns: 50,
    maxBudgetUsd: 2,
    timeoutMs: 240_000,
    modelTier: 'haiku',
    effort: 'low',
  },
  'scout-dependency': {
    maxTurns: 20,
    maxBudgetUsd: 1,
    timeoutMs: 240_000,
    modelTier: 'sonnet',
    effort: 'low',
  },
  'scout-user-journey': {
    maxTurns: 20,
    maxBudgetUsd: 1,
    timeoutMs: 240_000,
    modelTier: 'haiku',
    effort: 'low',
  },
  // M19.01 — Wave-2 deep agents. Synthesise paste-ready artefacts from
  // scout reports; sonnet-tier for the reasoning step. Higher turn cap
  // because the designer may need to verify scout citations in the
  // worktree.
  'wave2-interface-designer': {
    maxTurns: 30,
    maxBudgetUsd: 1.0,
    timeoutMs: 240_000,
    modelTier: 'sonnet',
    effort: 'medium',
  },
  'wave2-risk-analyst': {
    maxTurns: 30,
    maxBudgetUsd: 1.0,
    timeoutMs: 240_000,
    modelTier: 'sonnet',
    effort: 'medium',
  },
  // M19.11/M19.12 — Codex pre-QA diff review. Single-pass, read-only.
  // Codex CLI is fast for diffing; 3-min timeout with room for moderately
  // large diffs. perCycleMaxUsd is the project-level budget guard (M19.12).
  'dev-review': {
    maxTurns: 20,
    maxBudgetUsd: 2.0,
    timeoutMs: 180_000,
    modelTier: 'sonnet',
    provider: 'codex',
  },
  // M19.12 — Developer response to dev-review findings. One revision turn
  // in the integration worktree; sonnet-tier matches dev-review.
  'dev-review-response': {
    maxTurns: 60,
    maxBudgetUsd: 3.0,
    timeoutMs: 360_000,
    modelTier: 'sonnet',
  },
  // M19.03 — Per-WP builder. Budget is per-WP, not per-issue.
  'implement-wp': {
    maxTurns: 150,
    maxBudgetUsd: 10.0,
    timeoutMs: 900_000,
    modelTier: 'sonnet',
    escalation: { modelTier: 'opus', maxBudgetUsd: 20.0 },
  },
  // Repair/debug loops need their own tier so cheap implement overrides do not
  // send verification recovery into a weaker model by accident.
  'fix-feedback': {
    maxTurns: 100,
    maxBudgetUsd: 6.0,
    timeoutMs: 900_000,
    modelTier: 'sonnet',
    escalation: { modelTier: 'opus', maxBudgetUsd: 12.0 },
  },
  // M19.22 (#698) — code-quality-audit. Opus-tier qualitative scoring across
  // 8 categories; read-only + git log/blame access. Higher turn cap to allow
  // the auditor to verify evidence across multiple files.
  'code-quality-audit': {
    maxTurns: 60,
    maxBudgetUsd: 3.0,
    timeoutMs: 480_000,
    modelTier: 'opus',
  },
  // M21 — read-only operator intervention proposer. It explains why an item is
  // blocked and returns registry-validated action options; appliers perform all
  // side effects server-side.
  'intervention-proposer': {
    maxTurns: 20,
    maxBudgetUsd: 1.0,
    timeoutMs: 180_000,
    modelTier: 'sonnet',
  },
  // Test / eval harness skill — not used in production workflows.
  'echo-test': { maxTurns: 5, maxBudgetUsd: 0.1, timeoutMs: 30_000, modelTier: 'sonnet' },
  // M20 — Hub Chat. One round per call; cheap and snappy. Sonnet is the
  // baseline so chat replies feel coherent without the latency tax of opus.
  'hub-chat': {
    maxTurns: 12,
    maxBudgetUsd: 0.4,
    timeoutMs: 90_000,
    modelTier: 'haiku',
  },
};

export interface ResolvedBudget {
  budgets: AgentBudgets;
  /** Resolved model ID — maps directly to AgentSpec.modelOverride. */
  modelOverride: string;
  /** Runtime reasoning effort when configured. Unsupported runtimes ignore it. */
  effort?: RuntimeEffort;
}

/** DB-sourced per-skill override. Passed in by callers that have a projectId. */
export interface DbSkillOverride {
  maxTurns?: number | null;
  maxBudgetUsd?: number | null;
  timeoutMs?: number | null;
  modelTier?: ModelTier | string | null;
  modelProvider?: string | null;
  effort?: RuntimeEffort | string | null;
  escalationModelTier?: ModelTier | string | null;
  escalationMaxBudgetUsd?: number | null;
  escalationMaxTurns?: number | null;
  escalationTimeoutMs?: number | null;
}

function isRuntimeEffort(value: unknown): value is RuntimeEffort {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh';
}

function isModelTier(value: unknown): value is ModelTier {
  return value === 'haiku' || value === 'sonnet' || value === 'opus';
}

function isModelProvider(value: unknown): value is ModelProvider {
  return value === 'claude' || value === 'codex';
}

/**
 * Resolves the effective budget and starting model for a skill.
 *
 * Resolution order (later wins):
 *   1. Built-in SKILL_BUDGETS default
 *   2. project.config.ts skillBudgetOverrides[skill]
 *   3. dbOverride (UI-editable, sourced from project_skill_settings by the caller)
 *
 * perWorkflowMaxUsd cap: dbPerWorkflowMaxUsd wins over the config value.
 *
 * Throws if the skill is not registered. Per-skill DB rows are overrides for
 * known skills, not a fallback registration mechanism.
 */
export function resolveBudgets(
  skill: string,
  projectBudgets?: {
    perWorkflowMaxUsd?: number;
    perAgentMaxUsd?: number;
    skillBudgetOverrides?: Record<string, SkillBudgetOverride>;
  },
  dbOverride?: DbSkillOverride,
  dbPerWorkflowMaxUsd?: number | null,
  dbPerAgentMaxUsd?: number | null,
): ResolvedBudget {
  const base = SKILL_BUDGETS[skill];
  const configOverride = projectBudgets?.skillBudgetOverrides?.[skill];

  if (base == null && configOverride == null) {
    throw new Error(
      `resolveBudgets: no budget registered for skill '${skill}'. Add it to SKILL_BUDGETS in core/agent-runtime/budgets.ts or add a skillBudgetOverrides entry in the project config.`,
    );
  }

  const fallback: SkillBudget = {
    maxTurns: 10,
    maxBudgetUsd: 1,
    timeoutMs: 120_000,
    modelTier: 'sonnet' as ModelTier,
  };

  const merged: SkillBudget = {
    ...(base ?? fallback),
    ...configOverride,
    // DB row fields only applied when non-null (null means "not set, inherit")
    ...(dbOverride?.maxTurns != null ? { maxTurns: dbOverride.maxTurns } : {}),
    ...(dbOverride?.maxBudgetUsd != null ? { maxBudgetUsd: dbOverride.maxBudgetUsd } : {}),
    ...(dbOverride?.timeoutMs != null ? { timeoutMs: dbOverride.timeoutMs } : {}),
    ...(isRuntimeEffort(dbOverride?.effort) ? { effort: dbOverride.effort } : {}),
  };

  const effectivePerWorkflowCap = dbPerWorkflowMaxUsd ?? projectBudgets?.perWorkflowMaxUsd;
  let maxBudgetUsd = merged.maxBudgetUsd;
  if (effectivePerWorkflowCap != null && maxBudgetUsd > effectivePerWorkflowCap) {
    maxBudgetUsd = effectivePerWorkflowCap;
  }

  const effectivePerAgentCap = dbPerAgentMaxUsd ?? projectBudgets?.perAgentMaxUsd;
  if (effectivePerAgentCap != null && maxBudgetUsd > effectivePerAgentCap) {
    maxBudgetUsd = effectivePerAgentCap;
  }

  const effort = isRuntimeEffort(merged.effort) ? merged.effort : undefined;
  return {
    budgets: { maxTurns: merged.maxTurns, maxBudgetUsd, timeoutMs: merged.timeoutMs },
    modelOverride: defaultModelForTierAndProvider(merged.modelTier, 'claude'),
    ...(effort != null ? { effort } : {}),
  };
}

/**
 * Resolves the escalated budget for a skill — used by `runWithEscalation` to
 * retry once at a higher tier when the haiku output fails schema validation.
 *
 * Returns `null` when the skill has no escalation policy (most skills don't);
 * the caller must then surface the validation error.
 *
 * `maxTurns` and `timeoutMs` default to the base entry's values; `maxBudgetUsd`
 * comes from the escalation block (sonnet pricing > haiku, so the cap must
 * grow). `perWorkflowMaxUsd` cap: dbPerWorkflowMaxUsd wins over config value.
 */
export function resolveEscalatedBudgets(
  skill: string,
  projectBudgets?: {
    perWorkflowMaxUsd?: number;
    perAgentMaxUsd?: number;
    skillBudgetOverrides?: Record<string, SkillBudgetOverride>;
  },
  dbPerWorkflowMaxUsd?: number | null,
  dbPerAgentMaxUsd?: number | null,
  dbOverride?: DbSkillOverride | null,
): ResolvedBudget | null {
  const base = SKILL_BUDGETS[skill];
  const override = projectBudgets?.skillBudgetOverrides?.[skill];

  const inheritedEscalation = override?.escalation ?? base?.escalation;
  const hasDbEscalation =
    isModelTier(dbOverride?.escalationModelTier) ||
    dbOverride?.escalationMaxBudgetUsd != null ||
    dbOverride?.escalationMaxTurns != null ||
    dbOverride?.escalationTimeoutMs != null;
  const escalation =
    hasDbEscalation && inheritedEscalation != null
      ? {
          ...inheritedEscalation,
          ...(isModelTier(dbOverride?.escalationModelTier)
            ? { modelTier: dbOverride.escalationModelTier }
            : {}),
          ...(dbOverride?.escalationMaxBudgetUsd != null
            ? { maxBudgetUsd: dbOverride.escalationMaxBudgetUsd }
            : {}),
          ...(dbOverride?.escalationMaxTurns != null
            ? { maxTurns: dbOverride.escalationMaxTurns }
            : {}),
          ...(dbOverride?.escalationTimeoutMs != null
            ? { timeoutMs: dbOverride.escalationTimeoutMs }
            : {}),
        }
      : hasDbEscalation &&
          isModelTier(dbOverride?.escalationModelTier) &&
          dbOverride?.escalationMaxBudgetUsd != null
        ? {
            modelTier: dbOverride.escalationModelTier,
            maxBudgetUsd: dbOverride.escalationMaxBudgetUsd,
            ...(dbOverride.escalationMaxTurns != null
              ? { maxTurns: dbOverride.escalationMaxTurns }
              : {}),
            ...(dbOverride.escalationTimeoutMs != null
              ? { timeoutMs: dbOverride.escalationTimeoutMs }
              : {}),
          }
        : inheritedEscalation;
  if (escalation == null) return null;

  const baseTurns = override?.maxTurns ?? base?.maxTurns ?? 10;
  const baseTimeout = override?.timeoutMs ?? base?.timeoutMs ?? 120_000;

  const maxTurns = escalation.maxTurns ?? baseTurns;
  const timeoutMs = escalation.timeoutMs ?? baseTimeout;
  let maxBudgetUsd = escalation.maxBudgetUsd;

  const effectivePerWorkflowCap = dbPerWorkflowMaxUsd ?? projectBudgets?.perWorkflowMaxUsd;
  if (effectivePerWorkflowCap != null && maxBudgetUsd > effectivePerWorkflowCap) {
    maxBudgetUsd = effectivePerWorkflowCap;
  }

  const effectivePerAgentCap = dbPerAgentMaxUsd ?? projectBudgets?.perAgentMaxUsd;
  if (effectivePerAgentCap != null && maxBudgetUsd > effectivePerAgentCap) {
    maxBudgetUsd = effectivePerAgentCap;
  }

  const effort = isRuntimeEffort(override?.effort) ? override.effort : undefined;
  const provider = isModelProvider(dbOverride?.modelProvider)
    ? dbOverride.modelProvider
    : (override?.provider ?? base?.provider ?? 'claude');
  return {
    budgets: { maxTurns, maxBudgetUsd, timeoutMs },
    modelOverride: defaultModelForTierAndProvider(escalation.modelTier, provider),
    ...(effort != null ? { effort } : {}),
  };
}
