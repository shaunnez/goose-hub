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

// State labels that should KEEP a sprite at its previous desk and only swap
// its indicator (the "blocked but still alive" cases). Distinct from terminal
// states (`done` / `archived` / `rejected`) which remove the sprite entirely.
const STAY_PUT_STATES = new Set<string>(['factory:needs-human', 'factory:gate-pending']);

export interface AgentPlacement {
  /** Stable identity key used by the scene to track sprites across re-renders. */
  spriteId: string;
  workItemId: string;
  externalId: string;
  projectSlug: string;
  /**
   * Desk role for this placement. `null` means "stay at the sprite's previous
   * desk and only update the indicator" — used for blocked states like
   * `needs-human` and `gate-pending`. The scene drops such placements when no
   * existing sprite is found (rare: first-ever sighting in a blocked state).
   */
  role: OfficeRole | null;
  indicator: IndicatorKind;
  title?: string;
}

/**
 * Returns one placement per work item that should be visible in the office.
 * Includes:
 *   - items with a real desk-mapped state (`role` set), and
 *   - items in stay-put blocked states (`role: null`, indicator `bang` or
 *     `question`) so the scene can preserve their sprite at the previous desk.
 *
 * Drops items in terminal states (`done`, `archived`, `rejected`).
 */
export function placementsFromItems(items: readonly AgentPlacementInput[]): AgentPlacement[] {
  const out: AgentPlacement[] = [];
  for (const item of items) {
    const role = deskForState(item.state);
    if (role == null && !STAY_PUT_STATES.has(item.state)) continue;
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
  for (const p of placements) {
    if (p.role != null) set.add(p.role);
  }
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
