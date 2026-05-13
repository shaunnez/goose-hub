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
 * Work-mode machine scoping (M14.06 / #325).
 *
 * Work projects (Jira-backed) are restricted to machines where the user
 * has explicitly opted in via `WORK_MACHINE=true`. On any other machine
 * these projects are hidden from `loadProjects` output so the UI, CLI,
 * and scheduler all converge on the same answer: Work projects don't
 * exist here.
 *
 * The gate fires once per process — `recordWorkMachineGate` ensures we
 * emit the startup log message exactly once instead of on every reload.
 */
export function isWorkMachine(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WORK_MACHINE === 'true';
}

/** Projects whose source requires WORK_MACHINE to be set. Tolerant of
 * partial test fixtures that omit `source` entirely. */
export function projectRequiresWorkMachine(cfg: ProjectConfig): boolean {
  return cfg.source?.kind === 'jira';
}

let workMachineLogFired = false;

function logWorkMachineGate(filteredCount: number): void {
  if (workMachineLogFired) return;
  workMachineLogFired = true;
  if (filteredCount > 0) {
    logger.info('WORK_MACHINE not set — Work projects hidden', { filteredCount });
  }
}

/** Reset the one-shot log latch. Test-only. */
export function resetWorkMachineGateForTests(): void {
  workMachineLogFired = false;
}

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
 *
 * Work projects (Jira-backed) are filtered out unless `WORK_MACHINE=true`
 * (M14.06 / #325). The filter is applied AFTER duplicate detection so
 * that adding a Jira-backed project to a machine without the env var
 * still surfaces a duplicate-slug bug at startup rather than silently
 * masking it.
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

  if (!isWorkMachine()) {
    const filtered = configs.filter((c) => projectRequiresWorkMachine(c));
    if (filtered.length > 0) {
      logWorkMachineGate(filtered.length);
      return configs.filter((c) => !projectRequiresWorkMachine(c));
    }
  }
  return configs;
}

/**
 * Load a single project config by slug.
 * Returns null if the project directory or config file does not exist,
 * OR if the project requires WORK_MACHINE and the env var is unset.
 * Bypassing the gate at this level would re-introduce Work projects via
 * any code path that looks them up by slug.
 */
export async function getProjectBySlug(
  slug: string,
  projectsRoot = DEFAULT_PROJECTS_ROOT,
): Promise<ProjectConfig | null> {
  const cfg = await loadOne(slug, path.join(projectsRoot, slug));
  if (cfg == null) return null;
  if (projectRequiresWorkMachine(cfg) && !isWorkMachine()) return null;
  return cfg;
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
