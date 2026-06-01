import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '../../db/schema.js';
import { LocalDbWorkItemRepository } from '../../state-source/local-db-repository.js';
import type { ProjectConfig } from '../../types.js';
import { importGitHubIssuesToLocalDb } from './import-issues.js';

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
      now: () => new Date('2026-05-26T00:00:00.000Z'),
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
    integrations: { github: { repos: ['owner/repo'], importIssues: true } },
  },
  repos: ['owner/repo'],
} as ProjectConfig;

describe('importGitHubIssuesToLocalDb', () => {
  const handles: Database.Database[] = [];

  afterEach(() => {
    for (const handle of handles.splice(0)) handle.close();
  });

  it('imports GitHub issues idempotently as local Work Items with external refs', async () => {
    const { sqlite, repository } = makeRepository();
    handles.push(sqlite);

    const issues = [
      {
        number: 42,
        title: 'Imported issue',
        body: 'Body',
        labels: [{ name: 'factory:accepted' }, { name: 'priority:high' }],
        milestone: null,
        user: { login: 'octo' },
        created_at: '2026-05-26T00:00:00Z',
      },
    ];

    const first = await importGitHubIssuesToLocalDb({
      projectConfig,
      repository,
      issuesByRepo: { 'owner/repo': issues },
    });
    const second = await importGitHubIssuesToLocalDb({
      projectConfig,
      repository,
      issuesByRepo: {
        'owner/repo': [{ ...issues[0], title: 'Imported issue updated' }],
      },
    });

    expect(first).toMatchObject({ imported: 1, updated: 0 });
    expect(second).toMatchObject({ imported: 0, updated: 1 });
    const item = repository.getWorkItemByExternalRef({
      projectId: 'proj',
      provider: 'github',
      kind: 'issue',
      repoRef: 'owner/repo',
      externalId: '42',
    });
    expect(item).toMatchObject({
      id: 'local:proj#1',
      externalId: '1',
      title: 'Imported issue updated',
      state: 'factory:accepted',
      priority: 'high',
    });
    expect(repository.listRepoLinks('proj', 'local:proj#1')[0]).toMatchObject({
      repoRef: 'owner/repo',
      source: 'github-import',
    });
  });

  it('does not implicitly import from legacy repos when github integration repos are empty', async () => {
    const { sqlite, repository } = makeRepository();
    handles.push(sqlite);

    const result = await importGitHubIssuesToLocalDb({
      projectConfig: {
        ...projectConfig,
        source: {
          kind: 'local-db',
          stateMachine: 'db',
          integrations: { github: { repos: [], importIssues: true } },
        },
        repos: ['owner/legacy-repo'],
      } as ProjectConfig,
      repository,
      issuesByRepo: {
        'owner/legacy-repo': [
          {
            number: 42,
            title: 'Should not import',
            body: 'Body',
            labels: [],
            milestone: null,
            user: { login: 'octo' },
            created_at: '2026-05-26T00:00:00Z',
          },
        ],
      },
    });

    expect(result).toEqual({ imported: 0, updated: 0, skipped: 0, repoRefs: [] });
    expect(repository.listWorkItems('proj')).toEqual([]);
  });
});
