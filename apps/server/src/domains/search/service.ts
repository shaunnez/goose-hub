import { logger } from '@goose-hub/core/logger.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import type { Result } from '#shared/middleware.js';
import { listProjects } from '#shared/projects.js';
import { resolveActiveMilestone } from '#shared/resolve-milestone.js';
import { getSourceForSlug } from '#shared/source.js';
import { normalizeConfidence, parseQuery, scoreItem } from './score.js';

export interface SearchHit {
  projectSlug: string;
  externalId: string;
  title: string;
  state: string;
  type: string;
  priority: string;
  milestoneTitle: string | null;
  repoRef: string;
  confidence: number;
}

export interface SearchResult {
  items: SearchHit[];
  total: number;
  hasMore: boolean;
}

export type MilestoneFilter = 'active' | 'all';
export type WorkItemTypeFilter = 'feature' | 'bug' | 'chore' | 'research';

export interface SearchParams {
  q: string;
  limit?: number;
  projectSlug?: string;
  type?: WorkItemTypeFilter;
  milestone?: MilestoneFilter;
  includeClosed?: boolean;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const VALID_TYPES: ReadonlySet<string> = new Set(['feature', 'bug', 'chore', 'research']);
const VALID_MILESTONES: ReadonlySet<string> = new Set(['active', 'all']);

export function parseType(raw: string | undefined): WorkItemTypeFilter | undefined {
  if (raw == null || raw === '') return undefined;
  return VALID_TYPES.has(raw) ? (raw as WorkItemTypeFilter) : undefined;
}

export function parseMilestone(raw: string | undefined): MilestoneFilter {
  if (raw != null && VALID_MILESTONES.has(raw)) return raw as MilestoneFilter;
  return 'active';
}

export function parseIncludeClosed(raw: string | undefined): boolean {
  return raw === 'true' || raw === '1';
}

export function parseLimit(raw: string | undefined): number {
  if (raw == null || raw === '') return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n)) return DEFAULT_LIMIT;
  if (n < 1) return 1;
  if (n > MAX_LIMIT) return MAX_LIMIT;
  return n;
}

export async function search(
  params: SearchParams,
  opts?: { now?: Date },
): Promise<Result<SearchResult>> {
  const now = opts?.now ?? new Date();
  const query = parseQuery(params.q);
  const limit = params.limit ?? DEFAULT_LIMIT;
  const milestoneFilter: MilestoneFilter = params.milestone ?? 'active';

  if (query.tokens.length === 0 && query.externalId == null) {
    return { ok: true, data: { items: [], total: 0, hasMore: false } };
  }

  const allProjects = await listProjects();
  const projects =
    params.projectSlug != null
      ? allProjects.filter((p) => p.slug === params.projectSlug)
      : allProjects;

  const collected: Array<{ item: WorkItem; projectSlug: string }> = [];

  for (const project of projects) {
    const source = await getSourceForSlug(project.slug).catch((err: unknown) => {
      logger.warn('search: getSourceForSlug failed', {
        slug: project.slug,
        error: String(err),
      });
      return null;
    });
    if (source == null) continue;

    // Active-milestone narrowing: pass the resolved milestone number to
    // listOpenWork so the underlying state source can scope the query
    // (GitHub filters server-side; in-memory just narrows the slice).
    let milestoneNumber: number | undefined;
    if (milestoneFilter === 'active') {
      const resolved = await resolveActiveMilestone(project.slug).catch(() => null);
      milestoneNumber = resolved?.milestoneNumber ?? undefined;
    }

    try {
      const items = await source.listOpenWork(milestoneNumber);
      for (const item of items) {
        if (params.type != null && item.type !== params.type) continue;
        collected.push({ item, projectSlug: project.slug });
      }
    } catch (err) {
      logger.warn('search: listOpenWork failed', {
        slug: project.slug,
        error: String(err),
      });
    }

    // Include-closed: only enabled when we have a milestone number to scope
    // the query (active milestone path). For milestone:'all' we would need
    // to iterate every milestone per project — deferred. Surfaced as a
    // logged note so the UI can still toggle the chip without surprise.
    if (params.includeClosed === true && milestoneNumber != null) {
      try {
        const closed = await source.listClosedWorkByMilestone(milestoneNumber);
        for (const item of closed) {
          if (params.type != null && item.type !== params.type) continue;
          collected.push({ item, projectSlug: project.slug });
        }
      } catch (err) {
        logger.warn('search: listClosedWorkByMilestone failed', {
          slug: project.slug,
          error: String(err),
        });
      }
    }
  }

  const scored = collected
    .map(({ item, projectSlug }) => ({
      item,
      projectSlug,
      score: scoreItem(item, query, now),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored[0]?.score ?? 1;
  const sliced = scored.slice(0, limit);

  const hits: SearchHit[] = sliced.map((x) => ({
    projectSlug: x.projectSlug,
    externalId: x.item.externalId,
    title: x.item.title,
    state: x.item.state,
    type: x.item.type,
    priority: x.item.priority,
    milestoneTitle: x.item.milestoneTitle ?? null,
    repoRef: x.item.repoRef,
    confidence: normalizeConfidence(x.score, top),
  }));

  return {
    ok: true,
    data: {
      items: hits,
      total: scored.length,
      hasMore: scored.length > sliced.length,
    },
  };
}
