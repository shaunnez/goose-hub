import { GitHubLabelsSource } from '@goose-hub/core/state-source/github-labels.js';
import { InMemoryLabelsSource } from '@goose-hub/core/state-source/in-memory-labels.js';
import type { StateSource } from '@goose-hub/core/state-source/interface.js';
import { LocalDbStateSource } from '@goose-hub/core/state-source/local-db.js';
import type { ProjectConfig } from '@goose-hub/core/types.js';
import { getProject } from './projects.js';

const sourceCache = new Map<string, StateSource>();

/**
 * Defence-in-depth slug validator. Run BEFORE any `path.join` that includes
 * the slug — even if `getSourceForSlug` already filtered unknown slugs, we
 * never want to touch the filesystem with a slug containing `..`, `/`, NUL,
 * or other path-traversal characters (#201).
 */
const SLUG_PATTERN = /^[a-z0-9-]+$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

function compatibilityRepoRef(cfg: ProjectConfig): string {
  if (cfg.source.kind === 'github') return cfg.source.repo;
  return (
    cfg.repositories?.[0]?.repoRef ??
    cfg.repos[0] ??
    cfg.source.integrations?.github?.repos[0] ??
    `local:${cfg.id}`
  );
}

export async function getSourceForSlug(slug: string): Promise<StateSource | null> {
  const cached = sourceCache.get(slug);
  if (cached != null) return cached;

  const cfg = await getProject(slug);
  if (cfg == null) return null;
  const sourceKind = (cfg.source as { kind: string }).kind;

  if (process.env.MOCK_SOURCE === 'true') {
    const repoRef = compatibilityRepoRef(cfg);
    const source = new InMemoryLabelsSource(cfg.id, repoRef);
    sourceCache.set(slug, source);
    return source;
  }

  if (cfg.source.kind === 'local-db') {
    const source = new LocalDbStateSource(
      cfg.id,
      compatibilityRepoRef(cfg),
      undefined,
      cfg.source.integrations,
    );
    sourceCache.set(slug, source);
    return source;
  }

  if (cfg.source.kind !== 'github') {
    throw new Error(`Unsupported source kind for ${slug}: ${sourceKind}`);
  }

  const token = process.env.GITHUB_TOKEN;
  if (token == null || token.length === 0) {
    throw new Error('GITHUB_TOKEN env var is required to talk to GitHub.');
  }

  const ownerLogin = cfg.source.repo.split('/')[0];
  const source = new GitHubLabelsSource(cfg.id, cfg.source.repo, token, ownerLogin);
  sourceCache.set(slug, source);
  return source;
}

export function resetSourceCache(): void {
  sourceCache.clear();
}
