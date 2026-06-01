import type { ProjectConfig, ProjectRepositoryConfig, TargetRepoConfig } from '../types.js';

export function listProjectRepositories(project: ProjectConfig): ProjectRepositoryConfig[] {
  if (project.repositories != null && project.repositories.length > 0) {
    return project.repositories;
  }

  return legacyRepositories(project);
}

export function firstProjectRepository(project: ProjectConfig): ProjectRepositoryConfig | null {
  return listProjectRepositories(project)[0] ?? null;
}

export function listProjectRepoRefs(project: ProjectConfig): string[] {
  const refs = listProjectRepositories(project).map((repo) => repo.repoRef);
  if (refs.length > 0) return refs;
  if (project.source.kind === 'github') return [project.source.repo];
  return [];
}

function legacyRepositories(project: ProjectConfig): ProjectRepositoryConfig[] {
  const legacyRefs =
    project.repos?.length > 0
      ? project.repos
      : project.source.kind === 'github'
        ? [project.source.repo]
        : [];

  return legacyRefs.map((repoRef, index) => ({
    id: repoId(repoRef),
    repoRef,
    ...repoDefaults(project.targetRepo, index),
    role: 'unknown',
  }));
}

function repoDefaults(targetRepo: TargetRepoConfig | undefined, index: number): TargetRepoConfig {
  if (index === 0 && targetRepo != null) return targetRepo;
  return {
    cloneUrl: '',
    defaultBranch: targetRepo?.defaultBranch ?? 'main',
    localPath: '',
  };
}

function repoId(repoRef: string): string {
  return repoRef
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}
