/**
 * Cross-domain bridge for setting a project's active milestone. Per
 * `apps/server/STANDARDS.md` rule "Domains never import from other domains",
 * any domain that needs to flip the active milestone must go through this
 * shared helper rather than reaching into the milestones domain directly.
 *
 * Today this is used by the chat domain (`set_active_milestone` tool).
 */
import { setActiveMilestone as setActiveMilestoneInDomain } from '../domains/milestones/service.js';

export interface SetActiveMilestoneResult {
  ok: boolean;
  milestoneNumber: number | null;
  error?: string;
}

export async function setActiveMilestoneViaBridge(
  slug: string,
  milestoneNumber: number | null,
): Promise<SetActiveMilestoneResult> {
  const result = await setActiveMilestoneInDomain(slug, milestoneNumber);
  if (!result.ok) {
    return { ok: false, milestoneNumber: null, error: result.error };
  }
  return { ok: true, milestoneNumber: result.data.milestoneNumber };
}
