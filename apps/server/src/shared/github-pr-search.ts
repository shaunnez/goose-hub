/**
 * GitHub PR search backend for the chat `find_pr` tool (M20.16). Hits the
 * REST search endpoint scoped to a single repo, with a small in-memory TTL
 * cache so back-to-back chat turns don't re-hit GitHub.
 *
 * No external SDK — uses the global `fetch` with a Bearer header, same
 * shape as `core/state-source/github-labels.ts`.
 */
import { logger } from '@goose-hub/core/logger.js';

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_PER_PAGE = 10;

export interface PrSearchMatch {
  prNumber: number;
  url: string;
  title: string;
  state: 'open' | 'closed';
  merged: boolean;
  authorLogin: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PrSearchOptions {
  /** Pluggable fetch — test seam. Defaults to global `fetch`. */
  fetch?: typeof fetch;
  /** TTL for the in-memory cache. Defaults to 60s. */
  cacheTtlMs?: number;
  /** Override for the GitHub token. Defaults to `process.env.GITHUB_TOKEN`. */
  token?: string | null;
  /** Override for `Date.now()` — test seam. */
  now?: () => number;
}

interface CacheEntry {
  matches: PrSearchMatch[];
  expiresAt: number;
}

/**
 * In-memory cache keyed by `${repoRef}::${query}`. The class lets tests swap
 * the cache out cleanly and verify hit/miss behaviour.
 */
export class GithubPrSearch {
  private cache = new Map<string, CacheEntry>();
  private readonly fetchImpl: typeof fetch;
  private readonly ttlMs: number;
  private readonly tokenLookup: () => string | null;
  private readonly now: () => number;

  constructor(options: PrSearchOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.ttlMs = options.cacheTtlMs ?? DEFAULT_TTL_MS;
    const tokenOverride = options.token;
    this.tokenLookup = () =>
      tokenOverride !== undefined ? tokenOverride : (process.env.GITHUB_TOKEN ?? null);
    this.now = options.now ?? (() => Date.now());
  }

  /** Test-only: clear the cache between runs. */
  reset(): void {
    this.cache.clear();
  }

  async search(repoRef: string, query: string): Promise<PrSearchMatch[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    const cacheKey = `${repoRef}::${trimmed.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);
    const now = this.now();
    if (cached != null && cached.expiresAt > now) {
      return cached.matches;
    }

    const matches = await this.fetchFromGithub(repoRef, trimmed);
    this.cache.set(cacheKey, { matches, expiresAt: now + this.ttlMs });
    return matches;
  }

  private async fetchFromGithub(repoRef: string, query: string): Promise<PrSearchMatch[]> {
    const token = this.tokenLookup();
    if (token == null || token.length === 0) {
      throw new Error('GITHUB_TOKEN env var is required for GitHub PR search');
    }
    // A bare PR number is the most common case in chat ("find PR 123"). Take
    // the fast path: hit the canonical /pulls/:n route directly. Spares the
    // search-rate-limit budget when the user already knows the number.
    if (/^\d+$/.test(query)) {
      const single = await this.fetchByNumber(repoRef, Number(query), token);
      return single ? [single] : [];
    }

    const q = `is:pr repo:${repoRef} ${query}`;
    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=${DEFAULT_PER_PAGE}`;
    const response = await this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) {
      throw new Error(
        `GitHub PR search failed: ${response.status} ${response.statusText} for ${url}`,
      );
    }
    const body = (await response.json()) as {
      items?: Array<{
        number: number;
        html_url: string;
        title: string;
        state: string;
        pull_request?: { merged_at?: string | null } | null;
        user?: { login?: string } | null;
        created_at: string;
        updated_at: string;
      }>;
    };
    return (body.items ?? []).map((item) => ({
      prNumber: item.number,
      url: item.html_url,
      title: item.title,
      state: item.state === 'closed' ? 'closed' : 'open',
      merged: Boolean(item.pull_request?.merged_at),
      authorLogin: item.user?.login ?? null,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }));
  }

  private async fetchByNumber(
    repoRef: string,
    prNumber: number,
    token: string,
  ): Promise<PrSearchMatch | null> {
    const url = `https://api.github.com/repos/${repoRef}/pulls/${prNumber}`;
    const response = await this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(
        `GitHub PR fetch failed: ${response.status} ${response.statusText} for ${url}`,
      );
    }
    const item = (await response.json()) as {
      number: number;
      html_url: string;
      title: string;
      state: string;
      merged_at?: string | null;
      user?: { login?: string } | null;
      created_at: string;
      updated_at: string;
    };
    return {
      prNumber: item.number,
      url: item.html_url,
      title: item.title,
      state: item.state === 'closed' ? 'closed' : 'open',
      merged: Boolean(item.merged_at),
      authorLogin: item.user?.login ?? null,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    };
  }
}

let singleton: GithubPrSearch | null = null;

/** Shared singleton; replaceable in tests via `setGithubPrSearch`. */
export function getGithubPrSearch(): GithubPrSearch {
  if (singleton == null) singleton = new GithubPrSearch();
  return singleton;
}

/** Test-only: substitute a fixture-driven search instance. */
export function setGithubPrSearchForTests(instance: GithubPrSearch | null): void {
  singleton = instance;
}

/**
 * Helper logging wrapper used by tools that can fall back when the GitHub
 * search fails — keeps the failure visible to the operator without aborting
 * the chat turn.
 */
export async function searchPrsOrLog(
  repoRef: string,
  query: string,
): Promise<PrSearchMatch[] | null> {
  try {
    return await getGithubPrSearch().search(repoRef, query);
  } catch (err) {
    logger.warn('github-pr-search failed; caller should fall back', {
      repoRef,
      query,
      err: String(err),
    });
    return null;
  }
}
