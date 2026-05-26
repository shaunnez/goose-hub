import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import type { Result } from './middleware.js';
import { getSourceForSlug } from './source.js';

export interface ResolvedWorkItemForRoute {
  source: StateSource;
  item: WorkItem;
  routeId: string;
  canonicalWorkItemId: string;
  externalId: string;
  repoRef: string;
  isLocalDb: boolean;
}

export async function resolveWorkItemForRoute(
  projectSlug: string,
  routeId: string,
): Promise<Result<ResolvedWorkItemForRoute>> {
  const source = await getSourceForSlug(projectSlug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };

  const item = await source.getItem(routeId);
  return {
    ok: true,
    data: {
      source,
      item,
      routeId,
      canonicalWorkItemId: item.id,
      externalId: item.externalId,
      repoRef: item.repoRef,
      isLocalDb: !item.id.startsWith('github:'),
    },
  };
}
