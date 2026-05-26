import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../db/schema.js';
import { LocalDbWorkItemRepository } from '../../state-source/local-db-repository.js';
import { LocalDbStateSource } from '../../state-source/local-db.js';

function makeSource() {
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
  const repository = new LocalDbWorkItemRepository({ db });
  const source = new LocalDbStateSource('proj', 'owner/repo', repository, {
    github: { repos: ['owner/repo'], mirrorLabels: true },
  });
  return { sqlite, repository, source };
}

describe('github label mirroring', () => {
  const handles: Database.Database[] = [];

  afterEach(() => {
    for (const handle of handles.splice(0)) handle.close();
    vi.unstubAllEnvs();
  });

  it('mirrors managed DB labels to a linked GitHub issue after transition', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghp_test');
    const { sqlite, repository, source } = makeSource();
    handles.push(sqlite);
    const item = await source.createIssue({ title: 'A', body: '' });
    repository.upsertExternalRef({
      projectId: 'proj',
      itemId: item.id,
      provider: 'github',
      kind: 'issue',
      repoRef: 'owner/repo',
      externalId: '42',
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ name: 'factory:triaging' }])))
      .mockResolvedValueOnce(new Response('{}'));
    vi.stubGlobal('fetch', fetchImpl);

    await source.transitionState(item.id, 'factory:triaging', 'factory:accepted');

    expect(fetchImpl).toHaveBeenLastCalledWith(
      'https://api.github.com/repos/owner/repo/issues/42/labels',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('factory:accepted'),
      }),
    );
  });
});
