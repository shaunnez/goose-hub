import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '../../db/schema.js';
import { LocalDbWorkItemRepository } from '../../state-source/local-db-repository.js';
import { upsertBitbucketPullRequestRef } from './external-refs.js';

function makeRepository() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'db',
    'migrations',
  );
  migrate(db, { migrationsFolder });
  const repository = new LocalDbWorkItemRepository({
    db,
    now: () => new Date('2026-05-26T00:00:00.000Z'),
  });
  return { sqlite, repository };
}

describe('Bitbucket external refs', () => {
  const handles: Database.Database[] = [];

  afterEach(() => {
    for (const handle of handles.splice(0)) handle.close();
  });

  function trackedRepository(): ReturnType<typeof makeRepository> {
    const result = makeRepository();
    handles.push(result.sqlite);
    return result;
  }

  it('upserts pull request refs idempotently with Bitbucket provider identity', () => {
    const { repository } = trackedRepository();
    const item = repository.createWorkItem({ projectId: 'proj', title: 'Bitbucket PR' });

    const first = upsertBitbucketPullRequestRef({
      projectId: 'proj',
      workItemId: item.id,
      workspace: 'workspace',
      repo: 'repo',
      pullRequestId: 45,
      metadata: { state: 'OPEN' },
      repository,
    });
    const second = upsertBitbucketPullRequestRef({
      projectId: 'proj',
      workItemId: item.id,
      workspace: 'workspace',
      repo: 'repo',
      pullRequestId: '45',
      metadata: { state: 'MERGED' },
      repository,
    });

    expect(second.id).toBe(first.id);
    expect(repository.listExternalRefs('proj', item.id)).toEqual([
      expect.objectContaining({
        provider: 'bitbucket',
        kind: 'pull_request',
        repoRef: 'workspace/repo',
        externalId: '45',
        url: 'https://bitbucket.org/workspace/repo/pull-requests/45',
        metadataJson: JSON.stringify({ state: 'MERGED' }),
      }),
    ]);
  });
});
