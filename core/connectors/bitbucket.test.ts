import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkItem } from '../state-source/interface.js';
import {
  matchRepo,
  recallPriorMatch,
  recordMatchSelection,
  scoreCandidate,
} from './bitbucket-matcher.js';
import { BitbucketConnector, type BitbucketRepoRef, parseBitbucketCloneUrl } from './bitbucket.js';

// ---------------------------------------------------------------------------
// parseBitbucketCloneUrl
// ---------------------------------------------------------------------------

describe('parseBitbucketCloneUrl', () => {
  it('parses SSH clone URLs', () => {
    expect(parseBitbucketCloneUrl('git@bitbucket.org:my-team/payments-api.git')).toEqual({
      workspace: 'my-team',
      repoSlug: 'payments-api',
    });
  });

  it('parses HTTPS clone URLs', () => {
    expect(parseBitbucketCloneUrl('https://bitbucket.org/my-team/payments-api.git')).toEqual({
      workspace: 'my-team',
      repoSlug: 'payments-api',
    });
  });

  it('parses HTTPS URLs with embedded user', () => {
    expect(parseBitbucketCloneUrl('https://bot@bitbucket.org/my-team/payments-api.git')).toEqual({
      workspace: 'my-team',
      repoSlug: 'payments-api',
    });
  });

  it('accepts URLs without the .git suffix', () => {
    expect(parseBitbucketCloneUrl('git@bitbucket.org:my-team/payments-api')).toEqual({
      workspace: 'my-team',
      repoSlug: 'payments-api',
    });
  });

  it('returns null for non-Bitbucket URLs', () => {
    expect(parseBitbucketCloneUrl('git@github.com:foo/bar.git')).toBeNull();
    expect(parseBitbucketCloneUrl('https://example.com/foo/bar')).toBeNull();
    expect(parseBitbucketCloneUrl('not a url')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BitbucketConnector
// ---------------------------------------------------------------------------

function mkResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mkTextResponse(text: string, init: { status?: number } = {}): Response {
  return new Response(text, {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

describe('BitbucketConnector — env validation', () => {
  it('throws when BITBUCKET_USER is missing', () => {
    const saved = process.env.BITBUCKET_USER;
    // biome-ignore lint/performance/noDelete: env restore for test isolation
    delete process.env.BITBUCKET_USER;
    process.env.BITBUCKET_APP_PASSWORD = 'pw';
    try {
      expect(() => new BitbucketConnector()).toThrow(/BITBUCKET_USER/);
    } finally {
      if (saved !== undefined) process.env.BITBUCKET_USER = saved;
    }
  });

  it('throws when BITBUCKET_APP_PASSWORD is missing', () => {
    const saved = process.env.BITBUCKET_APP_PASSWORD;
    process.env.BITBUCKET_USER = 'u';
    // biome-ignore lint/performance/noDelete: env restore for test isolation
    delete process.env.BITBUCKET_APP_PASSWORD;
    try {
      expect(() => new BitbucketConnector()).toThrow(/BITBUCKET_APP_PASSWORD/);
    } finally {
      if (saved !== undefined) process.env.BITBUCKET_APP_PASSWORD = saved;
    }
  });
});

describe('BitbucketConnector — read operations', () => {
  const repo: BitbucketRepoRef = { workspace: 'team', repoSlug: 'payments-api' };

  it('getFile returns content for a 200 response', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain('/repositories/team/payments-api/src/HEAD/src/index.ts');
      return mkTextResponse('export const x = 1;');
    });
    const connector = new BitbucketConnector({
      authOverride: { user: 'u', appPassword: 'pw' },
      fetchImpl,
    });
    const file = await connector.getFile(repo, 'src/index.ts');
    expect(file?.content).toBe('export const x = 1;');
    expect(file?.path).toBe('src/index.ts');
  });

  it('getFile returns null on 404', async () => {
    const fetchImpl = vi.fn(async () => mkTextResponse('not found', { status: 404 }));
    const connector = new BitbucketConnector({
      authOverride: { user: 'u', appPassword: 'pw' },
      fetchImpl,
    });
    expect(await connector.getFile(repo, 'missing')).toBeNull();
  });

  it('searchCode maps hits with snippets and line numbers', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain('search_query');
      return mkResponse({
        values: [
          {
            file: { path: 'src/handler.ts' },
            content_match_count: 1,
            content_matches: [
              {
                lines: [
                  {
                    line: 12,
                    segments: [
                      { text: 'export function ' },
                      { text: 'validate', match: true },
                      { text: '(input)' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
    });
    const connector = new BitbucketConnector({
      authOverride: { user: 'u', appPassword: 'pw' },
      fetchImpl,
    });
    const hits = await connector.searchCode(repo, 'validate');
    expect(hits).toEqual([
      { path: 'src/handler.ts', snippet: 'export function validate(input)', line: 12 },
    ]);
  });

  it('searchCode returns [] when workspace does not support /search/code (404)', async () => {
    const fetchImpl = vi.fn(async () => mkResponse({}, { status: 404 }));
    const connector = new BitbucketConnector({
      authOverride: { user: 'u', appPassword: 'pw' },
      fetchImpl,
    });
    expect(await connector.searchCode(repo, 'anything')).toEqual([]);
  });

  it('listPullRequests maps PR fields', async () => {
    const fetchImpl = vi.fn(async () =>
      mkResponse({
        values: [
          {
            id: 7,
            title: 'Add idempotency keys',
            state: 'OPEN',
            author: { display_name: 'Robin Reviewer' },
            links: { html: { href: 'https://bitbucket.org/team/payments-api/pull-requests/7' } },
            created_on: '2026-04-01T00:00:00.000Z',
            updated_on: '2026-04-02T00:00:00.000Z',
          },
        ],
      }),
    );
    const connector = new BitbucketConnector({
      authOverride: { user: 'u', appPassword: 'pw' },
      fetchImpl,
    });
    const prs = await connector.listPullRequests(repo);
    expect(prs).toEqual([
      {
        id: 7,
        title: 'Add idempotency keys',
        state: 'OPEN',
        authorDisplayName: 'Robin Reviewer',
        htmlUrl: 'https://bitbucket.org/team/payments-api/pull-requests/7',
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-02T00:00:00.000Z',
      },
    ]);
  });

  it('getFile surfaces auth failures', async () => {
    const fetchImpl = vi.fn(async () => mkResponse({}, { status: 401 }));
    const connector = new BitbucketConnector({
      authOverride: { user: 'u', appPassword: 'pw' },
      fetchImpl,
    });
    await expect(connector.getFile(repo, 'whatever')).rejects.toThrow(/authentication failed/);
  });

  it('getRepoMetadata maps name + description + mainbranch', async () => {
    const fetchImpl = vi.fn(async () =>
      mkResponse({ name: 'payments-api', description: 'Bills', mainbranch: { name: 'develop' } }),
    );
    const connector = new BitbucketConnector({
      authOverride: { user: 'u', appPassword: 'pw' },
      fetchImpl,
    });
    expect(await connector.getRepoMetadata(repo)).toEqual({
      name: 'payments-api',
      description: 'Bills',
      mainbranch: 'develop',
    });
  });
});

// ---------------------------------------------------------------------------
// matcher — scoring and persistence
// ---------------------------------------------------------------------------

function mkIssue(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'jira:PAY#PAY-12',
    externalId: 'PAY-12',
    repoRef: 'PAY',
    title: 'Idempotency keys not honoured by /charges',
    body: 'When a duplicate request to /charges is sent within 30s the second call still creates a charge.',
    type: 'bug',
    priority: 'high',
    mode: 'supervised',
    state: 'factory:accepted',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date('2026-05-01T00:00:00Z'),
    ...overrides,
  };
}

describe('scoreCandidate', () => {
  it('rewards project-key overlap with the repo slug', () => {
    const issue = mkIssue();
    const { score, reason } = scoreCandidate(issue, { workspace: 'team', repoSlug: 'pay-core' });
    expect(score).toBeGreaterThanOrEqual(0.4);
    expect(reason).toContain('project key');
  });

  it('combines keyword overlap with project-key match to clear the auto-select bar', () => {
    const issue = mkIssue();
    const { score } = scoreCandidate(
      issue,
      { workspace: 'team', repoSlug: 'pay-charges' },
      'Idempotency-keyed payment processing service for charges',
    );
    expect(score).toBeGreaterThanOrEqual(0.7);
  });

  it('returns a low score for unrelated repos', () => {
    const issue = mkIssue();
    const { score } = scoreCandidate(
      issue,
      { workspace: 'team', repoSlug: 'mobile-app' },
      'Native mobile client',
    );
    expect(score).toBeLessThan(0.7);
  });

  it('caps the score at 1 even with a prior match', () => {
    const issue = mkIssue();
    const { score } = scoreCandidate(
      issue,
      { workspace: 'team', repoSlug: 'pay-charges' },
      'Idempotency-keyed payment processing service for charges',
      true,
    );
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('matcher persistence — in-memory SQLite', () => {
  let database: Database.Database;
  beforeEach(() => {
    database = new Database(':memory:');
  });
  afterEach(() => {
    database.close();
  });

  it('records and recalls a prior match', () => {
    expect(recallPriorMatch('PAY', 'PAY-12', { database })).toBeNull();
    recordMatchSelection('PAY', 'PAY-12', { workspace: 'team', repoSlug: 'pay-charges' }, 0.92, {
      database,
    });
    expect(recallPriorMatch('PAY', 'PAY-12', { database })).toEqual({
      workspace: 'team',
      repoSlug: 'pay-charges',
    });
  });

  it('upserts an existing match when called twice', () => {
    recordMatchSelection('PAY', 'PAY-12', { workspace: 'team', repoSlug: 'pay-charges' }, 0.6, {
      database,
    });
    recordMatchSelection('PAY', 'PAY-12', { workspace: 'team', repoSlug: 'pay-core' }, 0.9, {
      database,
    });
    expect(recallPriorMatch('PAY', 'PAY-12', { database })).toEqual({
      workspace: 'team',
      repoSlug: 'pay-core',
    });
  });
});

describe('matchRepo — end-to-end scoring', () => {
  let database: Database.Database;
  beforeEach(() => {
    database = new Database(':memory:');
  });
  afterEach(() => {
    database.close();
  });

  function mkConnector(repos: BitbucketRepoRef[], descriptions: Record<string, string> = {}) {
    return {
      listWorkspaceRepos: vi.fn(async () => repos),
      getRepoMetadata: vi.fn(async (ref: BitbucketRepoRef) => ({
        name: ref.repoSlug,
        description: descriptions[`${ref.workspace}/${ref.repoSlug}`] ?? '',
        mainbranch: 'main',
      })),
    } as unknown as BitbucketConnector;
  }

  it('auto-selects the top candidate when score >= 0.7', async () => {
    const candidates: BitbucketRepoRef[] = [
      { workspace: 'team', repoSlug: 'pay-charges' },
      { workspace: 'team', repoSlug: 'mobile-app' },
    ];
    const connector = mkConnector(candidates, {
      'team/pay-charges': 'Charges service with idempotency keys',
      'team/mobile-app': 'Mobile client',
    });
    const result = await matchRepo(mkIssue(), connector, {
      candidates,
      database,
      workspaces: ['team'],
    });
    expect(result.autoSelected).toBe(true);
    expect(result.topCandidate?.ref.repoSlug).toBe('pay-charges');
    expect(result.candidates).toHaveLength(2);
  });

  it('returns top-3 candidates ordered by score', async () => {
    const candidates: BitbucketRepoRef[] = [
      { workspace: 'team', repoSlug: 'pay-charges' },
      { workspace: 'team', repoSlug: 'pay-billing' },
      { workspace: 'team', repoSlug: 'pay-reports' },
      { workspace: 'team', repoSlug: 'unrelated' },
    ];
    const connector = mkConnector(candidates);
    const result = await matchRepo(mkIssue(), connector, {
      candidates,
      database,
      workspaces: ['team'],
    });
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0].score).toBeGreaterThanOrEqual(result.candidates[1].score);
    expect(result.candidates[1].score).toBeGreaterThanOrEqual(result.candidates[2].score);
  });

  it('falls back to no candidates when nothing scores and workspaces are empty', async () => {
    const connector = mkConnector([]);
    const result = await matchRepo(mkIssue(), connector, {
      database,
      workspaces: [],
    });
    expect(result.autoSelected).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.topCandidate).toBeNull();
  });

  it('prior selection boosts a repo that would otherwise score below the gate', async () => {
    const refs: BitbucketRepoRef[] = [
      { workspace: 'team', repoSlug: 'older-repo' },
      { workspace: 'team', repoSlug: 'pay-charges' },
    ];
    recordMatchSelection('PAY', 'PAY-12', refs[0], 0.55, { database });
    const connector = mkConnector(refs, {
      'team/older-repo': 'Legacy code',
      'team/pay-charges': 'Charges service with idempotency keys',
    });
    const result = await matchRepo(mkIssue(), connector, {
      candidates: refs,
      database,
      workspaces: ['team'],
    });
    expect(result.topCandidate?.ref.repoSlug).toBe('older-repo');
  });
});
