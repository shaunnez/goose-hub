import { GitHubLabelsSource } from '@goose-hub/core/state-source/github-labels.js';
import type { StateSource } from '@goose-hub/core/state-source/interface.js';
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

export async function getSourceForSlug(slug: string): Promise<StateSource | null> {
  const cached = sourceCache.get(slug);
  if (cached != null) return cached;

  const cfg = await getProject(slug);
  if (cfg == null) return null;
  if (cfg.source.kind !== 'github') {
    throw new Error(`Unsupported source kind for ${slug}: ${cfg.source.kind}`);
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
