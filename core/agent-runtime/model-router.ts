import { and, eq, gt } from 'drizzle-orm';
import { db } from '../db/db.js';
import { decisionPatterns } from '../db/schema.js';
import type { WorkItem } from '../state-source/interface.js';
import type { ModelTier, Role } from '../types.js';
import { HOLDOUT_ROLES } from './roles.js';

export interface SelectModelInput {
  workItem: WorkItem;
  role: Role;
  projectId: string;
  /** Project-level model router config from agentConfig.modelRouter */
  modelRouterConfig?: { overrides?: Record<string, ModelTier> };
  /**
   * DB-sourced complexity overrides for this role (from project_model_settings).
   * Keys are "type:<T>", "priority:<P>", or "default". These win over
   * modelRouterConfig.overrides when present.
   * Use resolveComplexityOverridesForProject() to build this map.
   */
  dbComplexityOverrides?: Record<string, ModelTier>;
}

export interface SelectModelResult {
  tier: ModelTier;
  reason: string;
}

function countAc(body: string): number {
  return (body.match(/^\s*- \[[ xX]\] /gm) ?? []).length;
}

function staticPolicy(workItem: WorkItem): SelectModelResult {
  const { type, priority, body } = workItem;

  if (priority === 'high' || priority === 'critical') {
    return { tier: 'sonnet', reason: 'priority-high-or-critical' };
  }
  if (type === 'bug') return { tier: 'haiku', reason: 'type-bug' };
  if (type === 'chore') return { tier: 'haiku', reason: 'type-chore' };
  if (type === 'feature') {
    const acCount = countAc(body);
    if (acCount >= 5 || body.length >= 1500) {
      return { tier: 'sonnet', reason: 'large-feature' };
    }
    return { tier: 'sonnet', reason: 'feature' };
  }
  return { tier: 'sonnet', reason: 'default' };
}

function resolveOverride(
  overrides: Record<string, ModelTier>,
  role: string,
  workItem: WorkItem,
): ModelTier | null {
  // Most-specific key wins: role+type, then role+priority, then role alone
  return (
    overrides[`${role}+type:${workItem.type}`] ??
    overrides[`${role}+priority:${workItem.priority}`] ??
    overrides[role] ??
    null
  );
}

function queryPatternTier(projectId: string, role: string): ModelTier | null {
  const rows = db
    .select()
    .from(decisionPatterns)
    .where(
      and(
        eq(decisionPatterns.projectId, projectId),
        eq(decisionPatterns.kind, 'MODEL_SELECTION_OUTCOME'),
        eq(decisionPatterns.role, role),
        gt(decisionPatterns.consistencyScore, 0.7),
      ),
    )
    .all();

  if (rows.length === 0) return null;

  const tier = rows[0].actionSummary;
  if (tier === 'haiku' || tier === 'sonnet' || tier === 'opus') return tier as ModelTier;
  return null;
}

/**
 * Resolves a complexity override tier from a bare-key map (keys are "type:<T>",
 * "priority:<P>", or "default" — no role prefix).
 */
function resolveBareOverride(
  overrides: Record<string, ModelTier>,
  workItem: WorkItem,
): ModelTier | null {
  return (
    overrides[`type:${workItem.type}`] ??
    overrides[`priority:${workItem.priority}`] ??
    overrides.default ??
    null
  );
}

/**
 * Predictively selects the initial model tier for an agent run based on
 * issue-complexity signals (type, priority, AC count, body length) plus
 * mined MODEL_SELECTION_OUTCOME patterns when available.
 *
 * Returns null for holdout roles (qa, reviewer) — caller must not override
 * their skill-configured tier.
 *
 * Resolution order (highest precedence first):
 *   1. DB complexity overrides for this role (dbComplexityOverrides) — UI-editable
 *   2. Project-level override (agentConfig.modelRouter.overrides)
 *   3. Pattern-informed (decision_patterns with consistencyScore > 0.7)
 *   4. Static policy table
 */
export function selectModel(input: SelectModelInput): SelectModelResult | null {
  const { workItem, role, projectId, modelRouterConfig, dbComplexityOverrides } = input;

  if (HOLDOUT_ROLES.has(role)) return null;

  // DB complexity overrides — highest precedence, UI-editable
  if (dbComplexityOverrides != null && Object.keys(dbComplexityOverrides).length > 0) {
    const dbTier = resolveBareOverride(dbComplexityOverrides, workItem);
    if (dbTier != null) {
      return { tier: dbTier, reason: 'db-complexity-override' };
    }
  }

  // Project-level override
  if (modelRouterConfig?.overrides != null) {
    const overrideTier = resolveOverride(modelRouterConfig.overrides, role, workItem);
    if (overrideTier != null) {
      return { tier: overrideTier, reason: 'project-override' };
    }
  }

  // Pattern-informed selection — degrades gracefully to static policy when absent
  const patternTier = queryPatternTier(projectId, role);
  if (patternTier != null) {
    return { tier: patternTier, reason: 'pattern-informed' };
  }

  return staticPolicy(workItem);
}
