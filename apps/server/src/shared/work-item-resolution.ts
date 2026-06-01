import { firstProjectRepository } from '@goose-hub/core/projects/repositories.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import type { ProjectConfig } from '@goose-hub/core/types.js';
import type { Result } from './middleware.js';
import { getProject } from './projects.js';
import { getSourceForSlug } from './source.js';

export interface ResolvedCanonicalWorkItemForRoute {
  routeId: string;
  canonicalWorkItemId: string;
  externalId: string;
  repoRef: string;
  projectId: string;
  isLocalDb: boolean;
}

export interface ResolvedWorkItemForRoute {
  source: StateSource;
  item: WorkItem;
  routeId: string;
  canonicalWorkItemId: string;
  externalId: string;
  repoRef: string;
  isLocalDb: boolean;
}

function githubCanonicalResolution(
  project: ProjectConfig,
  routeId: string,
): ResolvedCanonicalWorkItemForRoute {
  const externalId = routeId.match(/#([^#]+)$/)?.[1] ?? routeId;
  const repoRef =
    project.source.kind === 'github'
      ? project.source.repo
      : (firstProjectRepository(project)?.repoRef ?? `local:${project.id}`);
  return {
    routeId,
    canonicalWorkItemId: `github:${repoRef}#${externalId}`,
    externalId,
    repoRef,
    projectId: project.id,
    isLocalDb: false,
  };
}

export async function resolveCanonicalWorkItemForRoute(
  projectSlug: string,
  routeId: string,
): Promise<Result<ResolvedCanonicalWorkItemForRoute>> {
  const project = await getProject(projectSlug);
  if (project == null) return { ok: false, error: 'project not found', status: 404 };

  if (project.source.kind === 'github') {
    return { ok: true, data: githubCanonicalResolution(project, routeId) };
  }

  const source = await getSourceForSlug(projectSlug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };

  const item = await source.getItem(routeId);
  return {
    ok: true,
    data: {
      routeId,
      canonicalWorkItemId: item.id,
      externalId: item.externalId,
      repoRef: item.repoRef,
      projectId: source.projectId,
      isLocalDb: true,
    },
  };
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
