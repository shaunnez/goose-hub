import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { logger } from '../logger.js';
import type { ProjectConfig } from '../types.js';

export class DuplicateSlugError extends Error {
  constructor(public readonly slug: string) {
    super(`Duplicate project slug: "${slug}"`);
    this.name = 'DuplicateSlugError';
  }
}

const DEFAULT_PROJECTS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../target-projects',
);

const cache = new Map<string, ProjectConfig>();

/**
 * Throws DuplicateSlugError if any two configs share the same slug.
 * Exported for isolated testing.
 */
export function detectDuplicateSlugs(configs: ProjectConfig[]): void {
  const seen = new Set<string>();
  for (const cfg of configs) {
    if (seen.has(cfg.slug)) throw new DuplicateSlugError(cfg.slug);
    seen.add(cfg.slug);
  }
}

/**
 * Load all registered project configs from disk.
 * Missing or malformed configs are skipped with a warning.
 * Throws DuplicateSlugError if two projects share the same slug.
 */
export async function loadProjects(projectsRoot = DEFAULT_PROJECTS_ROOT): Promise<ProjectConfig[]> {
  let entries: string[];
  try {
    entries = readdirSync(projectsRoot);
  } catch {
    return [];
  }

  const configs: ProjectConfig[] = [];

  for (const entry of entries) {
    const dir = path.join(projectsRoot, entry);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }

    const cfg = await loadOne(entry, dir);
    if (cfg == null) continue;
    configs.push(cfg);
  }

  detectDuplicateSlugs(configs);
  return configs;
}

/**
 * Load a single project config by slug.
 * Returns null if the project directory or config file does not exist.
 */
export async function getProjectBySlug(
  slug: string,
  projectsRoot = DEFAULT_PROJECTS_ROOT,
): Promise<ProjectConfig | null> {
  return loadOne(slug, path.join(projectsRoot, slug));
}

async function loadOne(slug: string, dir: string): Promise<ProjectConfig | null> {
  const cached = cache.get(dir);
  if (cached != null) return cached;

  const configFile = path.join(dir, 'project.config.ts');
  try {
    statSync(configFile);
  } catch {
    return null;
  }

  try {
    const mod = (await import(pathToFileURL(configFile).href)) as { default?: unknown };
    if (mod.default == null || typeof mod.default !== 'object') {
      logger.warn('project config has no valid default export', { slug });
      return null;
    }
    const cfg = mod.default as ProjectConfig;
    cache.set(dir, cfg);
    return cfg;
  } catch (err) {
    logger.warn('failed to import project config', { slug, error: String(err) });
    return null;
  }
}
