import { logger } from '@goose-hub/core/logger.js';
import type { Result } from '#shared/middleware.js';
import { listProjectConfigs } from '#shared/projects.js';

export interface ChangelogEntry {
  number: number;
  title: string;
  mergedAt: string;
  url: string;
  repo: string;
  author: string;
}

interface GitHubPullSummary {
  number: number;
  title: string;
  merged_at: string | null;
  html_url: string;
  user: { login: string } | null;
}

const DEFAULT_DAYS = 7;
const MIN_DAYS = 1;
const MAX_DAYS = 90;

export function parseDays(raw: string | undefined): number {
  if (raw == null || raw === '') return DEFAULT_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n)) return DEFAULT_DAYS;
  if (n < MIN_DAYS) return MIN_DAYS;
  if (n > MAX_DAYS) return MAX_DAYS;
  return n;
}

export async function getChangelog(
  days: number,
  opts?: { fetchImpl?: typeof fetch; now?: Date },
): Promise<Result<{ entries: ChangelogEntry[] }>> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const now = opts?.now ?? new Date();
  const token = process.env.GITHUB_TOKEN ?? '';
  if (token.length === 0) return { ok: false, error: 'github-token-missing', status: 500 };

  const configs = await listProjectConfigs();
  const repos = new Set<string>();
  for (const cfg of configs) {
    for (const repo of cfg.repos ?? []) repos.add(repo);
    if (cfg.source.kind === 'github') repos.add(cfg.source.repo);
  }

  if (repos.size === 0) return { ok: true, data: { entries: [] } };

  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  const results = await Promise.all(
    Array.from(repos).map(async (repo) => {
      try {
        const entries = await fetchMergedPullsForRepo(repo, token, cutoff, fetchImpl);
        return { ok: true as const, repo, entries };
      } catch (err) {
        logger.warn('changelog: repo fetch failed', {
          repo,
          error: err instanceof Error ? err.message : String(err),
        });
        return { ok: false as const, repo };
      }
    }),
  );

  const successes = results.filter((r) => r.ok);
  if (successes.length === 0) return { ok: false, error: 'all-repos-failed', status: 500 };

  const entries = successes.flatMap((r) => r.entries);
  entries.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
  return { ok: true, data: { entries } };
}

async function fetchMergedPullsForRepo(
  repo: string,
  token: string,
  cutoffMs: number,
  fetchImpl: typeof fetch,
): Promise<ChangelogEntry[]> {
  const url = `https://api.github.com/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50`;
  const res = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub ${res.status} for ${repo}`);
  }
  const pulls = (await res.json()) as GitHubPullSummary[];
  const entries: ChangelogEntry[] = [];
  for (const p of pulls) {
    if (p.merged_at == null) continue;
    const mergedMs = Date.parse(p.merged_at);
    if (Number.isNaN(mergedMs) || mergedMs < cutoffMs) continue;
    entries.push({
      number: p.number,
      title: p.title,
      mergedAt: p.merged_at,
      url: p.html_url,
      repo,
      author: p.user?.login ?? 'unknown',
    });
  }
  return entries;
}
