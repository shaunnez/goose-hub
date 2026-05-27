import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../db/schema.js';
import {
  LocalDbWorkItemRepository,
  parseExternalRefMetadata,
} from '../../state-source/local-db-repository.js';
import type { ProjectConfig } from '../../types.js';
import type { AtlassianSearchPage, JiraProviderAdapter } from '../atlassian/adapters.js';
import type { JiraIssueCardDto, JiraIssueDetailDto } from '../atlassian/dtos.js';
import { providerFailure } from '../atlassian/errors.js';
import { importAssignedJiraIssuesToLocalDb } from './import-assigned.js';

function makeRepository() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, {
    migrationsFolder: path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'db',
      'migrations',
    ),
  });
  return {
    sqlite,
    repository: new LocalDbWorkItemRepository({
      db,
      now: () => new Date('2026-05-27T00:00:00.000Z'),
    }),
  };
}

const projectConfig = {
  id: 'proj',
  slug: 'proj',
  name: 'Project',
  source: {
    kind: 'local-db',
    stateMachine: 'db',
    integrations: {
      jira: {
        enabled: true,
        baseUrl: 'https://company.atlassian.net',
        projectKeys: ['TAS', 'OPS'],
        importMode: 'assigned-to-me',
      },
    },
  },
  repos: ['owner/repo'],
} as ProjectConfig;

function jiraCard(key: string, overrides: Partial<JiraIssueCardDto> = {}): JiraIssueCardDto {
  return {
    provider: 'jira',
    resourceKind: 'issue',
    tier: 'card',
    id: key,
    key,
    title: `${key} card`,
    status: 'In Progress',
    url: `https://company.atlassian.net/browse/${key}`,
    project: key.split('-')[0],
    updated: '2026-05-27T00:00:00.000Z',
    ...overrides,
  };
}

function jiraDetail(key: string, overrides: Partial<JiraIssueDetailDto> = {}): JiraIssueDetailDto {
  return {
    provider: 'jira',
    resourceKind: 'issue',
    tier: 'detail',
    id: key,
    key,
    title: `${key} detail`,
    status: 'In Progress',
    url: `https://company.atlassian.net/browse/${key}`,
    project: key.split('-')[0],
    issueType: 'Task',
    priority: 'Medium',
    assignee: { displayName: 'Ada Lovelace', accountId: 'ada-1' },
    created: '2026-05-26T00:00:00.000Z',
    updated: '2026-05-27T00:00:00.000Z',
    bodyPreview: `${key} imported body`,
    labels: [],
    components: [],
    linkedKeys: [],
    ...overrides,
  };
}

function assignedAdapter(input: {
  page?: AtlassianSearchPage<JiraIssueCardDto>;
  details?: Record<string, JiraIssueDetailDto>;
  failDetails?: Record<string, string>;
}): JiraProviderAdapter {
  return {
    getCurrentUser: vi.fn(async () => ({
      ok: true as const,
      data: { accountId: 'ada-1', displayName: 'Ada Lovelace' },
    })),
    searchIssues: vi.fn(async () => ({
      ok: true as const,
      data:
        input.page ??
        ({
          provider: 'jira',
          tier: 'card',
          issues: [jiraCard('TAS-123')],
          totalCount: 1,
          hasMore: false,
        } satisfies AtlassianSearchPage<JiraIssueCardDto>),
    })),
    getIssue: vi.fn(async ({ key }) => {
      const failure = input.failDetails?.[key];
      if (failure != null) return providerFailure('not_found', failure);
      const detail = input.details?.[key] ?? jiraDetail(key);
      return { ok: true as const, data: detail };
    }),
  };
}

describe('importAssignedJiraIssuesToLocalDb', () => {
  const handles: Database.Database[] = [];

  afterEach(() => {
    for (const handle of handles.splice(0)) handle.close();
  });

  it('imports and updates only issues returned for the current Jira user and configured projects', async () => {
    const { sqlite, repository } = makeRepository();
    handles.push(sqlite);
    await importAssignedJiraIssuesToLocalDb({
      projectConfig,
      adapter: assignedAdapter({
        page: {
          provider: 'jira',
          tier: 'card',
          issues: [jiraCard('TAS-123')],
          totalCount: 1,
          hasMore: false,
        },
        details: { 'TAS-123': jiraDetail('TAS-123', { title: 'First title' }) },
      }),
      repository,
      now: () => new Date('2026-05-27T01:00:00.000Z'),
    });

    const adapter = assignedAdapter({
      page: {
        provider: 'jira',
        tier: 'card',
        issues: [jiraCard('TAS-123'), jiraCard('OPS-9')],
        totalCount: 2,
        hasMore: false,
      },
      details: {
        'TAS-123': jiraDetail('TAS-123', { title: 'Updated title' }),
        'OPS-9': jiraDetail('OPS-9', { title: 'New OPS issue' }),
      },
    });
    const result = await importAssignedJiraIssuesToLocalDb({
      projectConfig,
      adapter,
      repository,
      maxResults: 200,
      updatedSince: '2025-01-01T00:00:00.000Z',
      now: () => new Date('2026-05-27T02:00:00.000Z'),
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        counts: { imported: 1, updated: 1, skipped: 0, stale: 0, failed: 0 },
      },
    });
    expect(adapter.getCurrentUser).toHaveBeenCalledOnce();
    expect(adapter.searchIssues).toHaveBeenCalledWith({
      level: 'L2',
      projects: ['TAS', 'OPS'],
      updated: {
        from: '2026-02-26T02:00:00.000Z',
        to: '2026-05-27T02:00:00.000Z',
      },
      maxResults: 50,
      assignee: { accountId: 'ada-1' },
    });
    expect(repository.listWorkItems('proj').map((item) => item.title)).toEqual([
      'Updated title',
      'New OPS issue',
    ]);
  });

  it('marks previously assigned imported Jira refs stale and hidden without deleting local rows', async () => {
    const { sqlite, repository } = makeRepository();
    handles.push(sqlite);
    await importAssignedJiraIssuesToLocalDb({
      projectConfig,
      adapter: assignedAdapter({
        page: {
          provider: 'jira',
          tier: 'card',
          issues: [jiraCard('TAS-123'), jiraCard('TAS-456')],
          totalCount: 2,
          hasMore: false,
        },
      }),
      repository,
      now: () => new Date('2026-05-27T01:00:00.000Z'),
    });

    const result = await importAssignedJiraIssuesToLocalDb({
      projectConfig,
      adapter: assignedAdapter({
        page: {
          provider: 'jira',
          tier: 'card',
          issues: [jiraCard('TAS-123')],
          totalCount: 1,
          hasMore: false,
        },
      }),
      repository,
      now: () => new Date('2026-05-27T02:00:00.000Z'),
    });

    expect(result).toMatchObject({
      ok: true,
      data: { counts: { imported: 0, updated: 1, skipped: 0, stale: 1, failed: 0 } },
    });
    expect(repository.listWorkItems('proj')).toHaveLength(2);

    const staleRef = repository.getExternalRef({
      projectId: 'proj',
      provider: 'jira',
      kind: 'issue',
      repoRef: null,
      externalId: 'TAS-456',
    });
    expect(staleRef).not.toBeNull();
    if (staleRef == null) throw new Error('expected stale Jira ref');
    expect(parseExternalRefMetadata(staleRef)).toMatchObject({
      assignedToMe: { accountId: 'ada-1' },
      stale: true,
      hidden: true,
      staleReason: 'not_assigned_to_current_user',
      lastAssignedSyncAt: '2026-05-27T02:00:00.000Z',
    });
  });

  it('does not stale missing assigned refs when the Jira search page is partial', async () => {
    const { sqlite, repository } = makeRepository();
    handles.push(sqlite);
    await importAssignedJiraIssuesToLocalDb({
      projectConfig,
      adapter: assignedAdapter({
        page: {
          provider: 'jira',
          tier: 'card',
          issues: [jiraCard('TAS-123'), jiraCard('TAS-456')],
          totalCount: 2,
          hasMore: false,
        },
      }),
      repository,
      now: () => new Date('2026-05-27T01:00:00.000Z'),
    });

    const result = await importAssignedJiraIssuesToLocalDb({
      projectConfig,
      adapter: assignedAdapter({
        page: {
          provider: 'jira',
          tier: 'card',
          issues: [jiraCard('TAS-123')],
          totalCount: 51,
          hasMore: true,
        },
      }),
      repository,
      now: () => new Date('2026-05-27T02:00:00.000Z'),
    });

    expect(result).toMatchObject({
      ok: true,
      data: { counts: { imported: 0, updated: 1, skipped: 0, stale: 0, failed: 0 } },
    });
    const ref = repository.getExternalRef({
      projectId: 'proj',
      provider: 'jira',
      kind: 'issue',
      repoRef: null,
      externalId: 'TAS-456',
    });
    expect(ref).not.toBeNull();
    if (ref == null) throw new Error('expected Jira ref');
    expect(parseExternalRefMetadata(ref)).toMatchObject({ stale: false, hidden: false });
  });

  it('does not stale missing assigned refs outside the current updated-date query window', async () => {
    const { sqlite, repository } = makeRepository();
    handles.push(sqlite);
    await importAssignedJiraIssuesToLocalDb({
      projectConfig,
      adapter: assignedAdapter({
        page: {
          provider: 'jira',
          tier: 'card',
          issues: [jiraCard('TAS-123'), jiraCard('TAS-456')],
          totalCount: 2,
          hasMore: false,
        },
        details: {
          'TAS-456': jiraDetail('TAS-456', { updated: '2026-01-01T00:00:00.000Z' }),
        },
      }),
      repository,
      now: () => new Date('2026-05-27T01:00:00.000Z'),
    });

    const result = await importAssignedJiraIssuesToLocalDb({
      projectConfig,
      adapter: assignedAdapter({
        page: {
          provider: 'jira',
          tier: 'card',
          issues: [jiraCard('TAS-123')],
          totalCount: 1,
          hasMore: false,
        },
      }),
      repository,
      now: () => new Date('2026-05-27T02:00:00.000Z'),
    });

    expect(result).toMatchObject({
      ok: true,
      data: { counts: { imported: 0, updated: 1, skipped: 0, stale: 0, failed: 0 } },
    });
    const ref = repository.getExternalRef({
      projectId: 'proj',
      provider: 'jira',
      kind: 'issue',
      repoRef: null,
      externalId: 'TAS-456',
    });
    expect(ref).not.toBeNull();
    if (ref == null) throw new Error('expected Jira ref');
    expect(parseExternalRefMetadata(ref)).toMatchObject({ stale: false, hidden: false });
  });

  it('reports per-issue failures and does not stale returned-but-failed keys', async () => {
    const { sqlite, repository } = makeRepository();
    handles.push(sqlite);
    await importAssignedJiraIssuesToLocalDb({
      projectConfig,
      adapter: assignedAdapter({
        page: {
          provider: 'jira',
          tier: 'card',
          issues: [jiraCard('TAS-404')],
          totalCount: 1,
          hasMore: false,
        },
        failDetails: { 'TAS-404': 'Jira issue not found' },
      }),
      repository,
    });

    const result = await importAssignedJiraIssuesToLocalDb({
      projectConfig,
      adapter: assignedAdapter({
        page: {
          provider: 'jira',
          tier: 'card',
          issues: [jiraCard('TAS-404')],
          totalCount: 1,
          hasMore: false,
        },
        failDetails: { 'TAS-404': 'Jira issue not found' },
      }),
      repository,
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        counts: { imported: 0, updated: 0, skipped: 0, stale: 0, failed: 1 },
        failures: [{ jiraKey: 'TAS-404', error: 'Jira issue not found' }],
      },
    });
    expect(repository.listWorkItems('proj')).toEqual([]);
  });
});
