// Derives one "agent placement" per active issue: which floor (project), which
// desk (role), and which indicator to draw above the sprite. Pure derivation
// from the canonical work-item list.

import { IDLE_INDICATOR, type IndicatorKind, indicatorForState } from './state-indicators';
import { OFFICE_ROLES, type OfficeRole, deskForState } from './state-to-role';

export interface AgentPlacementInput {
  workItemId: string;
  externalId: string;
  projectSlug: string;
  state: string;
  /** Optional persona id used to keep the same sprite stable across ticks. */
  personaId?: string | null;
  title?: string;
}

export interface AgentPlacement {
  /** Stable identity key used by the scene to track sprites across re-renders. */
  spriteId: string;
  workItemId: string;
  externalId: string;
  projectSlug: string;
  role: OfficeRole;
  indicator: IndicatorKind;
  title?: string;
}

/**
 * Returns one placement per work item with a real desk. Items in terminal /
 * human-gate states (no desk mapping) are dropped.
 */
export function placementsFromItems(items: readonly AgentPlacementInput[]): AgentPlacement[] {
  const out: AgentPlacement[] = [];
  for (const item of items) {
    const role = deskForState(item.state);
    if (role == null) continue;
    out.push({
      spriteId: `${item.projectSlug}:${item.externalId}`,
      workItemId: item.workItemId,
      externalId: item.externalId,
      projectSlug: item.projectSlug,
      role,
      indicator: indicatorForState(item.state),
      title: item.title,
    });
  }
  return out;
}

/**
 * Returns the set of roles that currently have at least one active issue —
 * useful for picking the IDLE_INDICATOR for empty desks.
 */
export function busyRoles(placements: readonly AgentPlacement[]): Set<OfficeRole> {
  const set = new Set<OfficeRole>();
  for (const p of placements) set.add(p.role);
  return set;
}

/**
 * Returns the indicator to draw above an empty desk (no active issue at that
 * role). Always `IDLE_INDICATOR`; centralized here so the scene doesn't need
 * to know the constant.
 */
export function idleIndicator(): IndicatorKind {
  return IDLE_INDICATOR;
}

/**
 * Re-exported for the scene's convenience: canonical desk order.
 */
export { OFFICE_ROLES };
