import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '../db/schema.js';
import { LocalDbWorkItemRepository } from '../state-source/local-db-repository.js';
import { LocalDbStateSource } from '../state-source/local-db.js';
import { restartIssue } from './restart-issue.js';

function makeLocalDbSource() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'db',
    'migrations',
  );
  migrate(db, { migrationsFolder });
  const repository = new LocalDbWorkItemRepository({
    db,
    now: () => new Date('2026-06-05T00:00:00.000Z'),
  });
  return {
    sqlite,
    repository,
    source: new LocalDbStateSource('proj', 'owner/repo', repository),
  };
}

describe('restartIssue', () => {
  const handles: Database.Database[] = [];

  afterEach(() => {
    for (const handle of handles.splice(0)) handle.close();
  });

  function trackedLocalDbSource(): ReturnType<typeof makeLocalDbSource> {
    const result = makeLocalDbSource();
    handles.push(result.sqlite);
    return result;
  }

  it('preserves local-db repo links on the fresh Work Item', async () => {
    const { source, repository } = trackedLocalDbSource();
    const oldItem = await source.createIssue({
      title: 'Restart me',
      body: 'Keep repository affinity',
    });
    repository.createRepoLink({
      projectId: 'proj',
      itemId: oldItem.id,
      repoRef: 'owner/repo',
      role: 'primary',
      confidence: 0.9,
      source: 'repo-match',
    });
    repository.createRepoLink({
      projectId: 'proj',
      itemId: oldItem.id,
      repoRef: 'owner/docs',
      role: 'related',
      confidence: 0.4,
      source: 'manual',
    });

    const result = await restartIssue({
      source,
      projectId: 'proj',
      itemId: oldItem.id,
      localDbRepository: repository,
    });

    expect(repository.listRepoLinks('proj', result.newItem.id)).toMatchObject([
      {
        repoRef: 'owner/repo',
        role: 'primary',
        confidence: 0.9,
        source: 'repo-match',
      },
      {
        repoRef: 'owner/docs',
        role: 'related',
        confidence: 0.4,
        source: 'manual',
      },
    ]);
    await expect(source.getItem(result.newItem.id)).resolves.toMatchObject({
      repoRef: 'owner/repo',
    });
  });
});
