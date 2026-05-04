import { db } from '@goose-hub/core/db/db.js';
import { events } from '@goose-hub/core/db/schema.js';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { getProject } from '#shared/projects.js';

/**
 * Look up the canonical GitHub `owner/repo` for a project slug. Falls back to
 * the slug itself for non-GitHub sources (legacy fixtures).
 */
export async function getRepoRef(slug: string): Promise<string> {
  const cfg = await getProject(slug);
  return cfg?.source.kind === 'github' ? cfg.source.repo : slug;
}

/**
 * For each work item in `projectId`, return the most recent persona id observed
 * in the event stream. Used to enrich list items with last-touched persona.
 */
export function getLastPersonaIdsByWorkItem(projectId: string): Map<string, string> {
  const rows = db
    .select({ workItemId: events.workItemId, personaId: events.personaId })
    .from(events)
    .where(and(eq(events.projectId, projectId), isNotNull(events.personaId)))
    .orderBy(desc(events.id))
    .all();

  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.workItemId != null && row.personaId != null && !map.has(row.workItemId)) {
      map.set(row.workItemId, row.personaId);
    }
  }
  return map;
}
