import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getArtifact, storeArtifact } from '../../agent-artifacts/repository.js';
import { db as defaultDb } from '../../db/db.js';
import * as schema from '../../db/schema.js';
import { agentArtifacts } from '../../db/schema.js';
import {
  LocalDbWorkItemRepository,
  parseExternalRefMetadata,
} from '../../state-source/local-db-repository.js';
import type { ProjectConfig } from '../../types.js';
import type { JiraProviderAdapter } from '../atlassian/adapters.js';
import type { JiraIssueDetailDto } from '../atlassian/dtos.js';
import { providerFailure } from '../atlassian/errors.js';
import { importJiraIssueToLocalDb } from './import-issue.js';

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
        projectKeys: ['TAS'],
        importMode: 'manual',
      },
    },
  },
  repos: ['owner/repo'],
} as ProjectConfig;

function jiraDetail(overrides: Partial<JiraIssueDetailDto> = {}): JiraIssueDetailDto {
  return {
    provider: 'jira',
    resourceKind: 'issue',
    tier: 'detail',
    id: '10001',
    key: 'TAS-123',
    title: 'Manual Jira import',
    status: 'In Progress',
    url: 'https://company.atlassian.net/browse/TAS-123',
    project: 'TAS',
    issueType: 'Bug',
    priority: 'High',
    assignee: { displayName: 'Ada Lovelace', accountId: 'ada-1' },
    created: '2026-05-26T00:00:00.000Z',
    updated: '2026-05-27T00:00:00.000Z',
    bodyPreview: 'Investigate the importer failure.',
    labels: ['factory'],
    components: ['hub'],
    linkedKeys: ['TAS-456'],
    ...overrides,
  };
}

function adapterWith(detail: JiraIssueDetailDto): JiraProviderAdapter {
  return {
    getIssue: vi.fn(async () => ({ ok: true as const, data: detail })),
    searchIssues: vi.fn(),
    getCurrentUser: vi.fn(),
  };
}

describe('importJiraIssueToLocalDb', () => {
  const handles: Database.Database[] = [];

  beforeAll(() => {
    defaultDb.run(sql`CREATE TABLE IF NOT EXISTS agent_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_key TEXT NOT NULL,
      project_id TEXT NOT NULL,
      work_item_id TEXT,
      run_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      expires_at TEXT
    )`);
    defaultDb.run(
      sql`CREATE UNIQUE INDEX IF NOT EXISTS agent_artifacts_artifact_key_uniq
          ON agent_artifacts (artifact_key)`,
    );
  });

  beforeEach(() => {
    defaultDb.delete(agentArtifacts).where(sql`project_id = ${projectConfig.id}`).run();
  });

  afterEach(() => {
    for (const handle of handles.splice(0)) handle.close();
  });

  afterAll(() => {
    defaultDb.delete(agentArtifacts).where(sql`project_id = ${projectConfig.id}`).run();
  });

  it('imports a Jira key idempotently into local Work Items with a Jira external ref', async () => {
    const { sqlite, repository } = makeRepository();
    handles.push(sqlite);
    const adapter = adapterWith(jiraDetail());

    const first = await importJiraIssueToLocalDb({
      projectConfig,
      input: 'TAS-123',
      adapter,
      repository,
      now: () => new Date('2026-05-27T01:00:00.000Z'),
    });
    const second = await importJiraIssueToLocalDb({
      projectConfig,
      input: 'https://company.atlassian.net/browse/TAS-123',
      adapter: adapterWith(jiraDetail({ title: 'Manual Jira import updated', status: 'Done' })),
      repository,
      now: () => new Date('2026-05-27T02:00:00.000Z'),
    });

    expect(first).toMatchObject({
      ok: true,
      data: { imported: true, jiraKey: 'TAS-123', externalId: '1' },
    });
    expect(second).toMatchObject({
      ok: true,
      data: { imported: false, jiraKey: 'TAS-123', externalId: '1' },
    });
    expect(adapter.getIssue).toHaveBeenCalledWith({ key: 'TAS-123', tier: 'detail' });
    expect(adapter.searchIssues).not.toHaveBeenCalled();

    const item = repository.getWorkItemByExternalRef({
      projectId: 'proj',
      provider: 'jira',
      kind: 'issue',
      repoRef: null,
      externalId: 'TAS-123',
    });
    expect(item).toMatchObject({
      id: 'local:proj#1',
      externalId: '1',
      title: 'Manual Jira import updated',
      body: 'Investigate the importer failure.',
      type: 'bug',
      priority: 'high',
      state: 'factory:triaging',
    });

    const ref = repository.getExternalRef({
      projectId: 'proj',
      provider: 'jira',
      kind: 'issue',
      repoRef: null,
      externalId: 'TAS-123',
    });
    expect(ref).toMatchObject({
      url: 'https://company.atlassian.net/browse/TAS-123',
      repoRef: null,
    });
    expect(ref).not.toBeNull();
    if (ref == null) throw new Error('expected Jira external ref');
    expect(parseExternalRefMetadata(ref)).toMatchObject({
      status: 'Done',
      assignee: { displayName: 'Ada Lovelace', accountId: 'ada-1' },
      issueType: 'Bug',
      priority: 'High',
      lastSyncedAt: '2026-05-27T02:00:00.000Z',
    });
    expect(repository.listWorkItems('proj')).toHaveLength(1);
    expect(repository.listRepoLinks('proj', 'local:proj#1')).toMatchObject([
      {
        repoRef: 'owner/repo',
        role: 'primary',
        source: 'jira-import',
      },
    ]);
  });

  it('preserves the requested milestone when creating a Jira Work Item', async () => {
    const { sqlite, repository } = makeRepository();
    handles.push(sqlite);

    await importJiraIssueToLocalDb({
      projectConfig,
      input: 'TAS-123',
      adapter: adapterWith(jiraDetail()),
      repository,
      milestone: {
        id: '7',
        title: 'M7: Atlassian imports',
      },
    });

    expect(repository.requireWorkItem('proj', 'local:proj#1')).toMatchObject({
      milestoneId: '7',
      milestoneTitle: 'M7: Atlassian imports',
    });
  });

  it('moves an existing imported Jira Work Item into the requested milestone on refresh', async () => {
    const { sqlite, repository } = makeRepository();
    handles.push(sqlite);

    await importJiraIssueToLocalDb({
      projectConfig,
      input: 'TAS-123',
      adapter: adapterWith(jiraDetail()),
      repository,
    });
    await importJiraIssueToLocalDb({
      projectConfig,
      input: 'TAS-123',
      adapter: adapterWith(jiraDetail({ title: 'Refresh into milestone' })),
      repository,
      milestone: {
        id: '7',
        title: 'M7: Atlassian imports',
      },
    });

    expect(repository.requireWorkItem('proj', 'local:proj#1')).toMatchObject({
      title: 'Refresh into milestone',
      milestoneId: '7',
      milestoneTitle: 'M7: Atlassian imports',
    });
  });

  it('does not create a partial Work Item when the provider fails', async () => {
    const { sqlite, repository } = makeRepository();
    handles.push(sqlite);
    const adapter: JiraProviderAdapter = {
      getIssue: vi.fn(async () => providerFailure('not_found', 'Jira issue not found')),
      searchIssues: vi.fn(),
      getCurrentUser: vi.fn(),
    };

    const result = await importJiraIssueToLocalDb({
      projectConfig,
      input: 'TAS-404',
      adapter,
      repository,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'not_found', message: 'Jira issue not found' },
    });
    expect(repository.listWorkItems('proj')).toEqual([]);
    expect(
      repository.getExternalRef({
        projectId: 'proj',
        provider: 'jira',
        kind: 'issue',
        repoRef: null,
        externalId: 'TAS-404',
      }),
    ).toBeNull();
  });

  it('carries provider artifact refs in external-ref metadata instead of raw provider objects', async () => {
    const { sqlite, repository } = makeRepository();
    handles.push(sqlite);

    await importJiraIssueToLocalDb({
      projectConfig,
      input: 'TAS-123',
      adapter: adapterWith(
        jiraDetail({
          bodyArtifactRef: {
            stored: true,
            artifactKey: 'atlassian:jira:detail:TAS-123:body',
            kind: 'atlassian:jira:detail:TAS-123',
            summary: 'Full Jira description',
            bytes: 2048,
          },
          rawArtifactRef: {
            stored: true,
            artifactKey: 'atlassian:jira:raw:TAS-123:raw',
            kind: 'atlassian:jira:raw:TAS-123',
            summary: 'Raw Jira issue response',
            bytes: 4096,
          },
        }),
      ),
      repository,
    });

    const ref = repository.getExternalRef({
      projectId: 'proj',
      provider: 'jira',
      kind: 'issue',
      repoRef: null,
      externalId: 'TAS-123',
    });
    expect(ref).not.toBeNull();
    if (ref == null) throw new Error('expected Jira external ref');
    const metadata = parseExternalRefMetadata(ref);
    expect(metadata).toMatchObject({
      bodyArtifactRef: { artifactKey: 'atlassian:jira:detail:TAS-123:body' },
      rawArtifactRef: { artifactKey: 'atlassian:jira:raw:TAS-123:raw' },
    });
    expect(JSON.stringify(metadata)).not.toContain('"fields"');
  });

  it('reattaches stored Jira artifact refs to the imported local Work Item', async () => {
    const { sqlite, repository } = makeRepository();
    handles.push(sqlite);
    const bodyArtifact = storeArtifact({
      projectId: 'proj',
      workItemId: null,
      runId: 'jira-import:proj',
      kind: 'atlassian:jira:detail:TAS-123',
      summary: 'Full Jira description',
      payload: { description: 'long body' },
      artifactKey: 'atlassian:jira:detail:TAS-123:body',
    });
    const rawArtifact = storeArtifact({
      projectId: 'proj',
      workItemId: null,
      runId: 'jira-import:proj',
      kind: 'atlassian:jira:detail:TAS-123',
      summary: 'Raw Jira issue response',
      payload: { fields: { summary: 'Manual Jira import' } },
      artifactKey: 'atlassian:jira:detail:TAS-123:raw',
    });

    await importJiraIssueToLocalDb({
      projectConfig,
      input: 'TAS-123',
      adapter: adapterWith(
        jiraDetail({
          bodyArtifactRef: bodyArtifact,
          rawArtifactRef: rawArtifact,
        }),
      ),
      repository,
    });

    expect(getArtifact(bodyArtifact.artifactKey)?.workItemId).toBe('local:proj#1');
    expect(getArtifact(rawArtifact.artifactKey)?.workItemId).toBe('local:proj#1');
  });
});
