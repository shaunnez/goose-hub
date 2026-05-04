import type { MilestoneDto } from '@/lib/types';

/**
 * Picks the active milestone number from a loaded milestone list, or null when
 * none is active. Used by the promote modal to default the milestone select.
 */
export function resolveActiveMilestone(milestones: MilestoneDto[]): number | null {
  const active = milestones.find((m) => m.isActive);
  return active?.number ?? null;
}
