/**
 * Cross-domain bridge for setting a project's active milestone. Per
 * `apps/server/STANDARDS.md` rule "Domains never import from other domains",
 * any domain that needs to flip the active milestone must go through this
 * shared helper rather than reaching into the milestones domain directly.
 *
 * Today this is used by the chat domain (`set_active_milestone` tool).
 */
import { db } from '@goose-hub/core/db/db.js';
import { projectState } from '@goose-hub/core/db/schema.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { eq } from 'drizzle-orm';
import { setActiveMilestone as setActiveMilestoneInDomain } from '../domains/milestones/service.js';
import { getSourceForSlug } from './source.js';

export interface SetActiveMilestoneResult {
  ok: boolean;
  milestoneNumber: number | null;
  cleared?: boolean;
  error?: string;
}

export async function setActiveMilestoneViaBridge(
  slug: string,
  milestoneNumber: number | null,
): Promise<SetActiveMilestoneResult> {
  if (milestoneNumber === null) {
    // Drop the row entirely so `resolveActiveMilestone` falls back to the
    // project config / GitHub default instead of pinning the project to an
    // explicit null override. The milestones-domain `setActiveMilestone`
    // path upserts the row, which would otherwise leave the project locked
    // to "no milestone" until the next non-null write.
    const source = await getSourceForSlug(slug);
    if (source == null) {
      return { ok: false, milestoneNumber: null, error: 'project not found' };
    }
    db.delete(projectState).where(eq(projectState.projectId, slug)).run();
    eventStore.appendEvent({
      projectId: slug,
      kind: 'milestone.activated',
      payload: { milestoneNumber: null, cleared: true },
    });
    return { ok: true, milestoneNumber: null, cleared: true };
  }

  const result = await setActiveMilestoneInDomain(slug, milestoneNumber);
  if (!result.ok) {
    return { ok: false, milestoneNumber: null, error: result.error };
  }
  return { ok: true, milestoneNumber: result.data.milestoneNumber };
}
