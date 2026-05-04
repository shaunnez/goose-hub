import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { logger } from '@goose-hub/core/logger.js';
import type { ProjectConfig } from '@goose-hub/core/types.js';
import { targetProjectsRoot } from '@goose-hub/target-projects';

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  color: string;
  source: ProjectConfig['source'];
}

const PROJECTS_DIR = targetProjectsRoot;

const cache = new Map<string, ProjectConfig>();

async function loadProject(slug: string): Promise<ProjectConfig | null> {
  const cached = cache.get(slug);
  if (cached != null) return cached;

  const file = path.join(PROJECTS_DIR, slug, 'project.config.ts');
  try {
    statSync(file);
  } catch {
    return null;
  }

  // Runtime-resolved path: each project's config lives in target-projects/<slug>/.
  const mod = (await import(pathToFileURL(file).href)) as { default: ProjectConfig };
  if (mod.default == null) {
    logger.warn('project config has no default export', { slug, file });
    return null;
  }
  cache.set(slug, mod.default);
  return mod.default;
}

// Per-project color stripe (issue #29). Not stored in ProjectConfig today.
// Defaults documented per-project; goose-hub-self is `#7c3aed` per #29 acceptance criteria.
const COLOR_BY_SLUG: Record<string, string> = {
  'goose-hub-self': '#7c3aed',
};

export async function listProjects(): Promise<ProjectSummary[]> {
  let entries: string[];
  try {
    entries = readdirSync(PROJECTS_DIR);
  } catch {
    return [];
  }

  const projects: ProjectSummary[] = [];
  for (const entry of entries) {
    const dir = path.join(PROJECTS_DIR, entry);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const cfg = await loadProject(entry);
    if (cfg == null) continue;
    projects.push({
      id: cfg.id,
      name: cfg.name,
      slug: cfg.slug,
      color: COLOR_BY_SLUG[cfg.slug] ?? '#888888',
      source: cfg.source,
    });
  }
  return projects;
}

export async function getProject(slug: string): Promise<ProjectConfig | null> {
  return loadProject(slug);
}
