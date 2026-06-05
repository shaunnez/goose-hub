import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { eventStore } from '../event-stream/store.js';
import { firstProjectRepository, listProjectRepositories } from '../projects/repositories.js';
import type { WorkItem } from '../state-source/interface.js';
import { LocalDbWorkItemRepository } from '../state-source/local-db-repository.js';
import type { LocalDbRepoLinkRow } from '../state-source/local-db-repository.js';
import type { ProjectConfig } from '../types.js';

export type RepoLinkSelectionResult =
  | { kind: 'selected'; link: LocalDbRepoLinkRow; selectedBy: 'repo-link-primary' }
  | { kind: 'repo-unassigned'; reason: 'no-primary' | 'no-links' }
  | { kind: 'repo-ambiguous'; links: LocalDbRepoLinkRow[] };

export interface SelectedWorkItemRepository {
  repoRef: string;
  localPath: string;
  defaultBranch: string;
  role: string;
  selectedBy: 'repo-link-primary' | 'repo-override' | 'work-item' | 'project';
}

export function selectCheckoutRepoLink(links: LocalDbRepoLinkRow[]): RepoLinkSelectionResult {
  if (links.length === 0) return { kind: 'repo-unassigned', reason: 'no-links' };
  const primaryLinks = links.filter((link) => link.role === 'primary');
  if (primaryLinks.length === 1) {
    return { kind: 'selected', link: primaryLinks[0], selectedBy: 'repo-link-primary' };
  }
  if (primaryLinks.length > 1) {
    return { kind: 'repo-ambiguous', links: primaryLinks };
  }
  return { kind: 'repo-unassigned', reason: 'no-primary' };
}

export function selectRepoLink(links: LocalDbRepoLinkRow[]): LocalDbRepoLinkRow | null {
  const selection = selectCheckoutRepoLink(links);
  if (selection.kind === 'selected') return selection.link;
  if (selection.kind === 'repo-ambiguous') {
    throw new Error('local-db Work Item has multiple primary repo links');
  }
  if (selection.reason === 'no-primary' && links.length > 0) {
    throw new Error('local-db Work Item has no primary repo link');
  }
  return null;
}

export function listLocalDbRepoLinks(
  projectId: string,
  workItemId: string,
  repository = new LocalDbWorkItemRepository(),
): LocalDbRepoLinkRow[] {
  if (!workItemId.startsWith('local:')) return [];
  try {
    return repository.listRepoLinks(projectId, workItemId);
  } catch {
    return [];
  }
}

function normalizeExistingLocalPath(localPath: string | null | undefined): string | null {
  if (localPath == null || localPath.length === 0) return null;
  const expanded =
    localPath === '~'
      ? homedir()
      : localPath.startsWith('~/')
        ? `${homedir()}${localPath.slice(1)}`
        : localPath;
  if (!existsSync(expanded)) return null;
  try {
    return statSync(expanded).isDirectory() ? expanded : null;
  } catch {
    return null;
  }
}

function latestRepoOverride(projectId: string, workItemId: string): string | null {
  try {
    const event = eventStore
      .replay({
        projectId,
        workItemId,
        kind: 'agent.repo-override',
        order: 'desc',
        limit: 1,
      })
      .at(0);
    const payload = event?.payload as { repo?: unknown } | undefined;
    return typeof payload?.repo === 'string' && payload.repo.trim().length > 0
      ? payload.repo.trim()
      : null;
  } catch {
    return null;
  }
}

export function resolveRepositoryForWorkItem(input: {
  project: ProjectConfig | null | undefined;
  workItem: WorkItem;
  fallbackLocalPath: string;
  repository?: LocalDbWorkItemRepository;
}): SelectedWorkItemRepository {
  const project = input.project;
  const repoSelection =
    project == null
      ? ({ kind: 'repo-unassigned', reason: 'no-links' } as const)
      : selectCheckoutRepoLink(
          listLocalDbRepoLinks(project.id, input.workItem.id, input.repository),
        );
  const repoLink = repoSelection.kind === 'selected' ? repoSelection.link : null;
  const overrideRepoRef =
    input.workItem.id.startsWith('local:') && project != null
      ? latestRepoOverride(project.id, input.workItem.id)
      : null;

  if (
    input.workItem.id.startsWith('local:') &&
    project != null &&
    repoSelection.kind === 'repo-ambiguous'
  ) {
    throw new Error('local-db Work Item has multiple primary repo links');
  }
  if (
    input.workItem.id.startsWith('local:') &&
    project != null &&
    repoSelection.kind === 'repo-unassigned' &&
    overrideRepoRef == null
  ) {
    throw new Error('local-db Work Item has no repo link for implementation');
  }

  const repoRef =
    repoLink?.repoRef ??
    overrideRepoRef ??
    input.workItem.repoRef ??
    (project == null ? null : firstProjectRepository(project)?.repoRef) ??
    '';
  if (repoRef.length === 0) {
    throw new Error('Work Item has no repository affinity');
  }

  const configuredRepo =
    project == null
      ? undefined
      : listProjectRepositories(project).find((repo) => repo.repoRef === repoRef);
  if (input.workItem.id.startsWith('local:') && project != null && configuredRepo == null) {
    throw new Error(`local-db Work Item repo '${repoRef}' is not registered in repositories`);
  }
  const configuredLocalPath = normalizeExistingLocalPath(configuredRepo?.localPath);
  const targetLocalPath = normalizeExistingLocalPath(project?.targetRepo?.localPath);
  return {
    repoRef,
    localPath: configuredLocalPath ?? targetLocalPath ?? input.fallbackLocalPath,
    defaultBranch:
      (configuredLocalPath != null ? configuredRepo?.defaultBranch : null) ??
      project?.targetRepo?.defaultBranch ??
      'main',
    role: repoLink?.role ?? configuredRepo?.role ?? 'unknown',
    selectedBy:
      repoLink?.role === 'primary'
        ? 'repo-link-primary'
        : overrideRepoRef != null
          ? 'repo-override'
          : input.workItem.repoRef != null
            ? 'work-item'
            : 'project',
  };
}
