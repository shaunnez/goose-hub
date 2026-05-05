import { db } from '@goose-hub/core/db/db.js';
import { projectState } from '@goose-hub/core/db/schema.js';
import { eq } from 'drizzle-orm';
import { getProject } from './projects.js';
import { getSourceForSlug } from './source.js';

export type MilestoneSource = 'project_state' | 'config' | 'github-default';

export interface ResolvedMilestone {
  milestoneNumber: number | null;
  source: MilestoneSource;
}

// Process-lifetime cache for ProjectConfig.activeMilestone title → GitHub milestone number.
// Refreshed only on server restart, which satisfies the "takes effect on server restart" criterion.
const configMilestoneCache = new Map<string, number | null>();

/** Exposed for tests only. */
export function resetConfigMilestoneCache(): void {
  configMilestoneCache.clear();
}

/**
 * Resolves the active milestone number for a project using a priority chain:
 * 1. project_state.activeMilestoneNumber (UI-persisted — even if null, respected as explicit override)
 * 2. ProjectConfig.activeMilestone title resolved to a GitHub milestone number
 * 3. GitHub API fallback: lowest open milestone
 */
export async function resolveActiveMilestone(slug: string): Promise<ResolvedMilestone> {
  // 1. project_state row — if a row exists, its value is authoritative even when null
  const rows = db.select().from(projectState).where(eq(projectState.projectId, slug)).all();
  if (rows.length > 0) {
    return { milestoneNumber: rows[0].activeMilestoneNumber, source: 'project_state' };
  }

  // 2. ProjectConfig.activeMilestone title → GitHub milestone number
  const cfg = await getProject(slug);
  if (cfg?.activeMilestone != null) {
    const cacheKey = `${slug}:${cfg.activeMilestone}`;
    if (configMilestoneCache.has(cacheKey)) {
      return { milestoneNumber: configMilestoneCache.get(cacheKey) ?? null, source: 'config' };
    }
    const source = await getSourceForSlug(slug);
    if (source != null) {
      const milestones = await source.listMilestones();
      const match = milestones.find((m) => m.title === cfg.activeMilestone);
      const number = match?.number ?? null;
      configMilestoneCache.set(cacheKey, number);
      return { milestoneNumber: number, source: 'config' };
    }
  }

  // 3. GitHub default: lowest open milestone
  const source = await getSourceForSlug(slug);
  if (source != null) {
    const active = await source.getActiveMilestone();
    return { milestoneNumber: active?.number ?? null, source: 'github-default' };
  }

  return { milestoneNumber: null, source: 'github-default' };
}
