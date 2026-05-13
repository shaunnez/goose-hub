import type Database from 'better-sqlite3';
import { db } from '../db/db.js';
import { logger } from '../logger.js';
import type { WorkItem } from '../state-source/interface.js';
import type { BitbucketConnector, BitbucketRepoRef } from './bitbucket.js';

/**
 * Repo-matching adapter for Jira issues (#326). Given a Jira `WorkItem`
 * and a set of Bitbucket workspaces to consider, rank candidate repos by
 * project key, keyword overlap with the issue summary/description, and
 * past selections recorded in SQLite (so user choices "stick" across
 * subsequent triage runs).
 *
 * The matcher self-bootstraps its persistence table on first call — no
 * drizzle migration is required because the table is isolated from the
 * rest of the schema and only consumed here.
 */

export interface MatchCandidate {
  ref: BitbucketRepoRef;
  /** Score between 0 and 1; >= 0.7 is auto-selectable. */
  score: number;
  /** Human-friendly explanation of how the score was computed. */
  reason: string;
}

export interface MatchResult {
  /** Top-3 candidates by score, highest first. */
  candidates: MatchCandidate[];
  /** True when the top candidate scored >= 0.7. */
  autoSelected: boolean;
  /** The top candidate, if any. */
  topCandidate: MatchCandidate | null;
}

export interface BitbucketMatcherOptions {
  /** Override the default better-sqlite3 connection (test injection). */
  database?: Database.Database;
  /**
   * Comma-separated list of Bitbucket workspace slugs to consider. Defaults
   * to `BITBUCKET_WORKSPACES`. Empty values short-circuit to "no candidates".
   */
  workspaces?: string[];
}

const TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS bitbucket_repo_matches (
    project_id TEXT NOT NULL,
    issue_key TEXT NOT NULL,
    workspace TEXT NOT NULL,
    repo_slug TEXT NOT NULL,
    score REAL NOT NULL,
    selected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (project_id, issue_key)
  );
  CREATE INDEX IF NOT EXISTS bitbucket_repo_matches_workspace_idx
    ON bitbucket_repo_matches (workspace, repo_slug);
`;

const tableInitialised = new WeakSet<Database.Database>();

function ensureTable(database: Database.Database): void {
  if (tableInitialised.has(database)) return;
  database.exec(TABLE_DDL);
  tableInitialised.add(database);
}

function getDb(options: BitbucketMatcherOptions): Database.Database {
  // Drizzle wraps better-sqlite3; the raw instance lives behind .$client
  // in current drizzle-orm versions. We type-pun rather than depend on a
  // private API path because the matcher only needs prepare/exec.
  const fromDrizzle = (db as unknown as { $client?: Database.Database }).$client;
  return options.database ?? fromDrizzle ?? (db as unknown as Database.Database);
}

function resolveWorkspaces(options: BitbucketMatcherOptions): string[] {
  if (options.workspaces != null) return options.workspaces.filter((w) => w.length > 0);
  const env = process.env.BITBUCKET_WORKSPACES ?? '';
  return env
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Score a single candidate repo against the issue. Three signals are
 * combined with documented weights:
 *
 * - project-key overlap (repo slug contains the Jira project key) → 0.4
 * - keyword overlap between issue summary/description and repo name +
 *   description → 0.15 per overlapping token, capped at 0.5
 * - previously selected (in SQLite) → 0.9 boost — large enough to make a
 *   sticky pick dominate fresh matches even when the fresh match has both
 *   project-key and keyword signals
 *
 * Sum is capped at 1.0. A confident key + keyword match clears the 0.7
 * auto-select bar without requiring prior history.
 */
export function scoreCandidate(
  issue: WorkItem,
  repo: BitbucketRepoRef,
  repoDescription = '',
  priorMatch = false,
): { score: number; reason: string } {
  const reasons: string[] = [];
  let score = 0;

  // 1) Jira project key vs repo slug.
  const projectKey = issue.repoRef.split('/').pop() ?? issue.repoRef;
  const slugLower = repo.repoSlug.toLowerCase();
  if (projectKey.length > 0 && slugLower.includes(projectKey.toLowerCase())) {
    score += 0.4;
    reasons.push(`slug contains project key "${projectKey}"`);
  }

  // 2) Keyword overlap. Tokenise summary + body, intersect with repo
  // slug + description tokens.
  const issueTokens = tokenise(`${issue.title} ${issue.body}`);
  const repoTokens = tokenise(`${repo.repoSlug} ${repoDescription}`);
  const overlap = countOverlap(issueTokens, repoTokens);
  if (overlap > 0) {
    const keywordScore = Math.min(0.5, overlap * 0.15);
    score += keywordScore;
    reasons.push(`${overlap} keyword overlap`);
  }

  // 3) Prior-match boost — dominates over a single tick's signals so a
  // user's selection sticks across reruns.
  if (priorMatch) {
    score += 0.9;
    reasons.push('prior selection on this issue');
  }

  score = Math.min(1, score);
  const reason = reasons.length > 0 ? reasons.join('; ') : 'no signals matched';
  return { score, reason };
}

function tokenise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3),
  );
}

function countOverlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n += 1;
  return n;
}

/**
 * Look up a previously selected repo for an issue. Returns null if none
 * recorded. Backed by the bootstrap table above.
 */
export function recallPriorMatch(
  projectId: string,
  issueKey: string,
  options: BitbucketMatcherOptions = {},
): BitbucketRepoRef | null {
  const database = getDb(options);
  ensureTable(database);
  const row = database
    .prepare(
      'SELECT workspace, repo_slug FROM bitbucket_repo_matches WHERE project_id = ? AND issue_key = ?',
    )
    .get(projectId, issueKey) as { workspace: string; repo_slug: string } | undefined;
  if (row == null) return null;
  return { workspace: row.workspace, repoSlug: row.repo_slug };
}

/** Persist a (projectId, issueKey) → repo selection for future tick reruns. */
export function recordMatchSelection(
  projectId: string,
  issueKey: string,
  ref: BitbucketRepoRef,
  score: number,
  options: BitbucketMatcherOptions = {},
): void {
  const database = getDb(options);
  ensureTable(database);
  database
    .prepare(
      `INSERT INTO bitbucket_repo_matches (project_id, issue_key, workspace, repo_slug, score)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id, issue_key) DO UPDATE SET
         workspace = excluded.workspace,
         repo_slug = excluded.repo_slug,
         score = excluded.score,
         selected_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
    )
    .run(projectId, issueKey, ref.workspace, ref.repoSlug, score);
}

/**
 * Match a Jira issue to candidate Bitbucket repos.
 *
 * - When `candidates` is supplied, only those are scored.
 * - Otherwise the matcher enumerates every repo in every configured
 *   workspace via the connector. This is an expensive call — callers
 *   should cache the candidate set when looping.
 */
export async function matchRepo(
  issue: WorkItem,
  connector: BitbucketConnector,
  options: BitbucketMatcherOptions & {
    candidates?: BitbucketRepoRef[];
    /** Optional pre-fetched descriptions keyed by `${workspace}/${repoSlug}`. */
    descriptions?: Record<string, string>;
  } = {},
): Promise<MatchResult> {
  const workspaces = resolveWorkspaces(options);
  if (workspaces.length === 0 && options.candidates == null) {
    logger.warn('matchRepo invoked with no BITBUCKET_WORKSPACES and no candidates');
    return { candidates: [], autoSelected: false, topCandidate: null };
  }

  // Enumerate candidates.
  let candidates: BitbucketRepoRef[];
  if (options.candidates != null) {
    candidates = options.candidates;
  } else {
    candidates = [];
    for (const workspace of workspaces) {
      const repos = await connector.listWorkspaceRepos(workspace);
      candidates.push(...repos);
    }
  }

  // Prior-match check (sticky behaviour).
  const prior = recallPriorMatch(issue.repoRef, issue.externalId, options);
  const isPrior = (ref: BitbucketRepoRef): boolean =>
    prior != null && prior.workspace === ref.workspace && prior.repoSlug === ref.repoSlug;

  const descriptions = options.descriptions ?? {};

  // Score each candidate. We fetch descriptions on demand only if not
  // supplied; integration tests may pre-populate them.
  const scored: MatchCandidate[] = [];
  for (const ref of candidates) {
    const key = `${ref.workspace}/${ref.repoSlug}`;
    let description = descriptions[key];
    if (description == null) {
      try {
        const meta = await connector.getRepoMetadata(ref);
        description = meta?.description ?? '';
      } catch {
        description = '';
      }
    }
    const { score, reason } = scoreCandidate(issue, ref, description, isPrior(ref));
    scored.push({ ref, score, reason });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3);
  const winner = top[0] ?? null;
  const autoSelected = winner != null && winner.score >= 0.7;

  return { candidates: top, autoSelected, topCandidate: winner };
}
