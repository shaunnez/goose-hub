import { describe, expect, it, vi } from 'vitest';
import type { AtlassianSearchPage, JiraProviderAdapter } from './adapters.js';
import type { JiraIssueCardDto, JiraIssueDetailDto } from './dtos.js';
import { executeJiraQuery, resolveJiraQuery } from './query.js';

const config = {
  baseUrl: 'https://company.atlassian.net',
  projectKeys: ['TAS', 'OPS'],
};

describe('Atlassian query resolution', () => {
  it('short-circuits exact Jira keys to L0 without constructing search input', async () => {
    const exactIssue = {
      provider: 'jira',
      resourceKind: 'issue',
      tier: 'detail',
      id: 'TAS-123',
      key: 'TAS-123',
      title: 'Exact issue',
      status: 'To Do',
      url: 'https://company.atlassian.net/browse/TAS-123',
      labels: [],
      components: [],
      linkedKeys: [],
    } satisfies JiraIssueDetailDto;
    const adapter: JiraProviderAdapter = {
      getIssue: vi.fn(async () => ({
        ok: true as const,
        data: exactIssue,
      })),
      searchIssues: vi.fn(),
      getCurrentUser: vi.fn(),
    };

    const result = await executeJiraQuery({
      config,
      adapter,
      input: { kind: 'manual', value: 'TAS-123', maxResults: 500 },
    });

    expect(result.ok).toBe(true);
    expect(adapter.getIssue).toHaveBeenCalledWith({ key: 'TAS-123', tier: 'detail' });
    expect(adapter.searchIssues).not.toHaveBeenCalled();
  });

  it('caps free-text search projects, dates, and max results before provider calls', async () => {
    const searchPage = {
      provider: 'jira',
      tier: 'headline',
      issues: [],
      totalCount: 0,
      hasMore: false,
    } satisfies AtlassianSearchPage<JiraIssueCardDto>;
    const adapter: JiraProviderAdapter = {
      getIssue: vi.fn(),
      searchIssues: vi.fn(async () => ({
        ok: true as const,
        data: searchPage,
      })),
      getCurrentUser: vi.fn(),
    };

    await executeJiraQuery({
      config,
      adapter,
      now: new Date('2026-05-27T12:00:00Z'),
      input: {
        kind: 'free-text',
        text: 'import boundary',
        projects: ['TAS', 'OUTSIDE'],
        updatedSince: '2025-01-01T00:00:00Z',
        updatedUntil: '2027-01-01T00:00:00Z',
        maxResults: 500,
      },
      caps: { maxResults: 50, maxLookbackDays: 90 },
    });

    expect(adapter.searchIssues).toHaveBeenCalledWith({
      level: 'L3',
      text: 'import boundary',
      projects: ['TAS'],
      updated: {
        from: '2026-02-26T12:00:00.000Z',
        to: '2026-05-27T12:00:00.000Z',
      },
      maxResults: 50,
      assignee: undefined,
    });
  });

  it('resolves explicit project searches as L1 with configured project bounds', () => {
    expect(
      resolveJiraQuery({
        config,
        now: new Date('2026-05-27T12:00:00Z'),
        input: {
          kind: 'project',
          text: 'safe scoped search',
          projects: ['OPS', 'OUTSIDE'],
          maxResults: 10,
        },
      }),
    ).toMatchObject({
      ok: true,
      query: {
        provider: 'jira',
        level: 'L1',
        search: {
          level: 'L1',
          projects: ['OPS'],
          text: 'safe scoped search',
          maxResults: 10,
        },
      },
    });
  });

  it('builds assigned-to-me queries from safe scoped inputs instead of raw JQL', () => {
    const resolved = resolveJiraQuery({
      config,
      now: new Date('2026-05-27T12:00:00Z'),
      input: {
        kind: 'assigned-to-me',
        accountId: 'abc-123',
        maxResults: 200,
      },
      caps: { maxResults: 25, maxLookbackDays: 30 },
    });

    expect(resolved).toEqual({
      ok: true,
      query: {
        provider: 'jira',
        level: 'L2',
        search: {
          level: 'L2',
          projects: ['TAS', 'OPS'],
          updated: {
            from: '2026-04-27T12:00:00.000Z',
            to: '2026-05-27T12:00:00.000Z',
          },
          maxResults: 25,
          assignee: { accountId: 'abc-123' },
        },
      },
    });
    expect(JSON.stringify(resolved)).not.toContain('jql');
  });

  it('rejects raw JQL and CQL-shaped normal inputs', () => {
    expect(
      resolveJiraQuery({
        config,
        input: {
          kind: 'free-text',
          text: 'project = TAS ORDER BY updated DESC',
        },
      }),
    ).toMatchObject({ ok: false, error: { kind: 'validation' } });

    expect(
      resolveJiraQuery({
        config,
        input: {
          kind: 'free-text',
          text: 'space = DOCS AND type = page',
        },
      }),
    ).toMatchObject({ ok: false, error: { kind: 'validation' } });
  });
});
