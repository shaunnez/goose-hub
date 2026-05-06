import { eventStore } from '../event-stream/store.js';
import type { WorkItem } from '../state-source/interface.js';
import type { AgentConfig, ModelTier, Role } from '../types.js';

export interface SelectModelInput {
  workItem: WorkItem;
  role: Role;
  projectId: string;
  agentConfig: AgentConfig;
  runId: string;
}

export interface SelectModelResult {
  tier: ModelTier;
  reason: string;
}

const HOLDOUT_ROLES = new Set<Role>(['qa', 'reviewer']);

/**
 * Counts acceptance criteria in the work item body.
 * Looks for markdown checklist items: `- [ ]` or `- [x]`.
 */
function countAcceptanceCriteria(body: string): number {
  const acPattern = /^[-*]\s+\[[ xX]\]/gm;
  const matches = body.match(acPattern);
  return matches ? matches.length : 0;
}

/**
 * Selects the model tier for an agent run based on issue complexity.
 * Holdout roles (qa, reviewer) bypass policy and use their configured primary tier.
 * Non-holdout roles follow static policy: bug → haiku, feature (complex) → sonnet,
 * chore → haiku, high/critical priority → sonnet.
 * Project-level overrides can force a specific tier by role or role+type.
 */
export function selectModel(input: SelectModelInput): SelectModelResult {
  const { workItem, role, projectId, agentConfig, runId } = input;

  // Holdout roles always use their primary tier — never escalate based on complexity
  if (HOLDOUT_ROLES.has(role)) {
    const primaryTier = agentConfig.rolesModels[role].primary;
    const result = { tier: primaryTier, reason: `${role} role uses configured tier` };
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.model-selected',
      payload: {
        role,
        selectedTier: result.tier,
        reason: result.reason,
      },
      runId,
    });
    return result;
  }

  // Check for role+type override (most specific)
  const overrides = (agentConfig.modelRouter?.overrides ?? {}) as Record<string, ModelTier>;
  const overrideKey = `${role}+${workItem.type}`;
  if (overrideKey in overrides) {
    const result = { tier: overrides[overrideKey], reason: `override: ${overrideKey}` };
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.model-selected',
      payload: {
        role,
        selectedTier: result.tier,
        reason: result.reason,
      },
      runId,
    });
    return result;
  }

  // Check for role-only override
  if (role in overrides) {
    const result = { tier: overrides[role], reason: `override: ${role}` };
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.model-selected',
      payload: {
        role,
        selectedTier: result.tier,
        reason: result.reason,
      },
      runId,
    });
    return result;
  }

  // Apply static policy
  const result = applyStaticPolicy(workItem);

  eventStore.appendEvent({
    projectId,
    workItemId: workItem.id,
    kind: 'agent.model-selected',
    payload: {
      role,
      selectedTier: result.tier,
      reason: result.reason,
    },
    runId,
  });

  return result;
}

/**
 * Static policy table:
 * - type:bug → haiku
 * - type:chore → haiku
 * - type:feature with AC < 5 AND body < 1500 → sonnet
 * - type:feature with AC ≥ 5 OR body ≥ 1500 → sonnet (reason: large-feature)
 * - priority:high or critical → sonnet
 * - default → sonnet (feature is the default assumption)
 */
function applyStaticPolicy(workItem: WorkItem): SelectModelResult {
  // Bug → haiku (simple fixes)
  if (workItem.type === 'bug') {
    return { tier: 'haiku', reason: 'bug type' };
  }

  // Chore → haiku (routine maintenance)
  if (workItem.type === 'chore') {
    return { tier: 'haiku', reason: 'chore type' };
  }

  // High or critical priority → sonnet (urgent items need care)
  if (workItem.priority === 'high' || workItem.priority === 'critical') {
    return { tier: 'sonnet', reason: `priority: ${workItem.priority}` };
  }

  // Feature: size-based selection
  if (workItem.type === 'feature') {
    const acCount = countAcceptanceCriteria(workItem.body);
    const bodyLength = workItem.body.length;

    const isLarge = acCount >= 5 || bodyLength >= 1500;
    if (isLarge) {
      return { tier: 'sonnet', reason: 'large-feature' };
    }

    return { tier: 'sonnet', reason: 'feature type' };
  }

  // Research or unknown type → sonnet (safe default)
  return { tier: 'sonnet', reason: 'default' };
}
