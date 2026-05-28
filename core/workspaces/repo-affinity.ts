import { firstProjectRepository, listProjectRepositories } from '../projects/repositories.js';
import type { WorkItem } from '../state-source/interface.js';
import { LocalDbWorkItemRepository } from '../state-source/local-db-repository.js';
import type { LocalDbRepoLinkRow } from '../state-source/local-db-repository.js';
import type { ProjectConfig } from '../types.js';

export interface SelectedWorkItemRepository {
  repoRef: string;
  localPath: string;
  defaultBranch: string;
  role: string;
  selectedBy: 'repo-link-primary' | 'repo-link-single' | 'work-item' | 'project';
}

export function selectRepoLink(links: LocalDbRepoLinkRow[]): LocalDbRepoLinkRow | null {
  if (links.length === 0) return null;
  const primaryLinks = links.filter((link) => link.role === 'primary');
  if (primaryLinks.length === 1) return primaryLinks[0];
  if (primaryLinks.length > 1) {
    throw new Error('local-db Work Item has multiple primary repo links');
  }
  if (links.length === 1) return links[0];
  throw new Error('local-db Work Item has multiple repo links and no primary repo link');
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

export function resolveRepositoryForWorkItem(input: {
  project: ProjectConfig | null | undefined;
  workItem: WorkItem;
  fallbackLocalPath: string;
  repository?: LocalDbWorkItemRepository;
}): SelectedWorkItemRepository {
  const project = input.project;
  const repoLink =
    project == null
      ? null
      : selectRepoLink(listLocalDbRepoLinks(project.id, input.workItem.id, input.repository));

  if (input.workItem.id.startsWith('local:') && project != null && repoLink == null) {
    throw new Error('local-db Work Item has no repo link for implementation');
  }

  const repoRef =
    repoLink?.repoRef ??
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
  if (repoLink != null && project != null && configuredRepo == null) {
    throw new Error(`local-db Work Item repo link '${repoRef}' is not registered in repositories`);
  }
  return {
    repoRef,
    localPath:
      configuredRepo?.localPath ?? project?.targetRepo?.localPath ?? input.fallbackLocalPath,
    defaultBranch: configuredRepo?.defaultBranch ?? project?.targetRepo?.defaultBranch ?? 'main',
    role: repoLink?.role ?? configuredRepo?.role ?? 'unknown',
    selectedBy:
      repoLink?.role === 'primary'
        ? 'repo-link-primary'
        : repoLink != null
          ? 'repo-link-single'
          : input.workItem.repoRef != null
            ? 'work-item'
            : 'project',
  };
}
