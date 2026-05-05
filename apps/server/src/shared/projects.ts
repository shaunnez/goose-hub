import { getProjectBySlug, loadProjects } from '@goose-hub/core/projects/loader.js';
import type { ProjectConfig } from '@goose-hub/core/types.js';
import { targetProjectsRoot } from '@goose-hub/target-projects';

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  color: string;
  source: ProjectConfig['source'];
  defaultBranch: string;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const configs = await loadProjects(targetProjectsRoot);
  return configs.map((cfg) => ({
    id: cfg.id,
    name: cfg.name,
    slug: cfg.slug,
    color: cfg.colorStripe,
    source: cfg.source,
    defaultBranch: cfg.targetRepo?.defaultBranch ?? 'main',
  }));
}

export async function getProject(slug: string): Promise<ProjectConfig | null> {
  return getProjectBySlug(slug, targetProjectsRoot);
}
