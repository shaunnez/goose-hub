/**
 * M14.09 / #330 — Work investigation end-to-end test (fixture-driven).
 *
 * Goose Hub does not have a sandbox Jira / Bitbucket workspace in CI, so
 * this test exercises the full chain against recorded cassettes. Each
 * step uses the real adapter under test with `fetch` stubbed out and
 * the responses replayed from in-line fixtures. A future live-run
 * against a real workspace is a human task — recording it requires
 * credentials this CI does not carry. See the PR description for the
 * coverage gap and the manual verification checklist.
 *
 * The pipeline below mirrors the issue's acceptance criteria:
 *   1. Jira state source ingests a fresh ticket and produces a WorkItem
 *      with the correct factory:* state via the status map.
 *   2. The Bitbucket repo matcher picks the right repo with confidence
 *      >= 0.7 (auto-selected).
 *   3. A clone URL is parsed and a worktree path is computed.
 *   4. An investigation finding is posted back to Jira as a comment.
 *   5. The WORK_MACHINE gate hides the project on a non-Work machine.
 *
 * Coverage in this test is intentionally orchestrational — each adapter
 * has its own unit / slice test for the per-adapter happy/edge paths.
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { matchRepo } from '../connectors/bitbucket-matcher.js';
import { BitbucketConnector } from '../connectors/bitbucket.js';
import { isWorkMachine, projectRequiresWorkMachine } from '../projects/loader.js';
import { type JiraIssueRaw, JiraStateSource } from '../state-source/jira.js';
import type { ProjectConfig } from '../types.js';
import { parseCloneUrl } from '../workspaces/worktree.js';

function jiraResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function freshTicketFixture(): JiraIssueRaw {
  return {
    id: '10042',
    key: 'PAY-42',
    fields: {
      summary: 'Duplicate /charges create two payments',
      description:
        'Sending the same idempotency-key twice to /charges within 30s creates two charges. Expected behaviour: the second request returns the original charge.',
      issuetype: { name: 'Bug' },
      priority: { name: 'High' },
      status: { name: 'To Do' },
      reporter: { accountId: 'acc-1', emailAddress: 'reporter@example.com' },
      created: '2026-05-10T00:00:00.000Z',
    },
  };
}

describe('Work investigation E2E (fixture-driven)', () => {
  const SAVED_ENV: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    'WORK_MACHINE',
    'JIRA_HOST',
    'JIRA_USER',
    'JIRA_API_TOKEN',
    'BITBUCKET_USER',
    'BITBUCKET_APP_PASSWORD',
    'BITBUCKET_WORKSPACES',
  ] as const;

  beforeEach(() => {
    for (const k of ENV_KEYS) SAVED_ENV[k] = process.env[k];
    process.env.WORK_MACHINE = 'true';
    process.env.JIRA_HOST = 'https://example.atlassian.net';
    process.env.JIRA_USER = 'agent@example.com';
    process.env.JIRA_API_TOKEN = 'jira-token';
    process.env.BITBUCKET_USER = 'agent';
    process.env.BITBUCKET_APP_PASSWORD = 'bb-pw';
    process.env.BITBUCKET_WORKSPACES = 'pay-team';
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (SAVED_ENV[k] === undefined) delete process.env[k];
      else process.env[k] = SAVED_ENV[k];
    }
  });

  it('drives a Jira ticket through repo-match, investigation, and Jira comment-back', async () => {
    // --- Step 1: Jira ticket is fetched and mapped to a WorkItem ---
    const jiraCalls: Array<{ method: string; url: string; body?: string }> = [];
    const jiraFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      jiraCalls.push({
        method: init?.method ?? 'GET',
        url,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      if (
        url.includes('/rest/api/3/issue/PAY-42/transitions') &&
        (init?.method ?? 'GET') === 'GET'
      ) {
        return jiraResponse({
          transitions: [{ id: '11', name: 'Start Progress', to: { name: 'In Progress' } }],
        });
      }
      if (url.includes('/rest/api/3/issue/PAY-42/transitions') && init?.method === 'POST') {
        return jiraResponse({});
      }
      if (url.includes('/rest/api/3/issue/PAY-42/comment') && init?.method === 'POST') {
        return jiraResponse({});
      }
      if (url.includes('/rest/api/3/issue/PAY-42')) {
        return jiraResponse(freshTicketFixture());
      }
      if (url.includes('/rest/api/3/search')) {
        return jiraResponse({
          issues: [freshTicketFixture()],
          total: 1,
          startAt: 0,
          maxResults: 50,
        });
      }
      return jiraResponse({}, 404);
    });
    const jira = new JiraStateSource('pay', 'PAY', { fetchImpl: jiraFetch });
    const ticket = await jira.getItem('PAY-42');
    expect(ticket.state).toBe('factory:accepted');
    expect(ticket.priority).toBe('high');
    expect(ticket.type).toBe('bug');

    // --- Step 2: Bitbucket repo matcher selects pay-charges ---
    const bitbucketFetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/repositories/pay-team?')) {
        return jiraResponse({
          values: [
            { slug: 'pay-charges', name: 'pay-charges' },
            { slug: 'pay-billing', name: 'pay-billing' },
            { slug: 'mobile-app', name: 'mobile-app' },
          ],
        });
      }
      if (url.includes('/repositories/pay-team/pay-charges')) {
        return jiraResponse({
          name: 'pay-charges',
          description: 'Charges service with idempotency keys',
          mainbranch: { name: 'main' },
        });
      }
      if (url.includes('/repositories/pay-team/pay-billing')) {
        return jiraResponse({
          name: 'pay-billing',
          description: 'Billing service',
          mainbranch: { name: 'main' },
        });
      }
      if (url.includes('/repositories/pay-team/mobile-app')) {
        return jiraResponse({
          name: 'mobile-app',
          description: 'Native mobile client',
          mainbranch: { name: 'main' },
        });
      }
      return jiraResponse({}, 404);
    });
    const bitbucket = new BitbucketConnector({
      authOverride: { user: 'agent', appPassword: 'bb-pw' },
      fetchImpl: bitbucketFetch,
    });
    const database = new Database(':memory:');
    try {
      const matchResult = await matchRepo(ticket, bitbucket, {
        database,
        workspaces: ['pay-team'],
      });
      expect(matchResult.autoSelected).toBe(true);
      expect(matchResult.topCandidate?.ref.repoSlug).toBe('pay-charges');

      // --- Step 3: Worktree URL is parsed for the selected repo ---
      const cloneUrl = 'git@bitbucket.org:pay-team/pay-charges.git';
      const parsed = parseCloneUrl(cloneUrl);
      expect(parsed?.isBitbucket).toBe(true);
      expect(parsed?.workspace).toBe('pay-team');
      expect(parsed?.repoSlug).toBe('pay-charges');

      // --- Step 4: Findings are posted back to Jira ---
      await jira.comment(
        'jira:PAY#PAY-42',
        'Investigation complete — root cause is missing idempotency-key lookup in src/api/charges.ts:create.',
      );
      const commentCall = jiraCalls.find((c) => c.method === 'POST' && c.url.includes('/comment'));
      expect(commentCall).toBeDefined();
      expect(commentCall?.body ?? '').toContain('Investigation complete');

      // --- Step 5: factory:in-progress transition is dispatched ---
      await jira.transitionStatus('jira:PAY#PAY-42', 'factory:in-progress');
      const transitionPost = jiraCalls.find(
        (c) => c.method === 'POST' && c.url.endsWith('/transitions'),
      );
      expect(transitionPost).toBeDefined();
      expect(transitionPost?.body ?? '').toContain('"id":"11"');
    } finally {
      database.close();
    }
  });

  it('WORK_MACHINE gate hides Work projects on a non-Work machine', () => {
    // biome-ignore lint/performance/noDelete: env restore for test isolation
    delete process.env.WORK_MACHINE;
    const jiraProject = { source: { kind: 'jira' } } as unknown as ProjectConfig;
    const githubProject = { source: { kind: 'github' } } as unknown as ProjectConfig;
    expect(isWorkMachine()).toBe(false);
    expect(projectRequiresWorkMachine(jiraProject)).toBe(true);
    expect(projectRequiresWorkMachine(githubProject)).toBe(false);
  });
});
