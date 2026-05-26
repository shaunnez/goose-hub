import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '../db/schema.js';
import { LocalDbWorkItemRepository } from './local-db-repository.js';

function makeRepository() {
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
    now: () => new Date('2026-05-26T00:00:00.000Z'),
    id: () =>
      `wi_test_${(sqlite.prepare('select count(*) as count from work_items').get() as { count: number }).count}`,
  });
  return { sqlite, repository };
}

describe('LocalDbWorkItemRepository', () => {
  const handles: Database.Database[] = [];

  afterEach(() => {
    for (const handle of handles.splice(0)) handle.close();
  });

  function trackedRepository(): ReturnType<typeof makeRepository> {
    const result = makeRepository();
    handles.push(result.sqlite);
    return result;
  }

  it('creates, gets, and lists Work Items by project and external id', () => {
    const { repository } = trackedRepository();
    const created = repository.createWorkItem({
      projectId: 'proj',
      title: 'Local DB source',
      body: 'Depends on: #7',
      type: 'feature',
      priority: 'high',
    });

    expect(created.id).toBe('wi_test_0');
    expect(created.externalId).toBe('1');
    expect(repository.getWorkItem('proj', created.id)?.title).toBe('Local DB source');
    expect(repository.getWorkItem('proj', '1')?.id).toBe(created.id);
    expect(repository.getWorkItem('proj', 'local:proj#1')?.id).toBe(created.id);
    expect(repository.listOpenWorkItems('proj')).toHaveLength(1);
    expect(repository.listOpenWorkItems('other')).toHaveLength(0);
  });

  it('updates state with history, comments, repo links, labels, and external refs', () => {
    const { repository } = trackedRepository();
    const created = repository.createWorkItem({ projectId: 'proj', title: 'A' });

    repository.updateState({
      projectId: 'proj',
      itemId: created.externalId,
      from: 'factory:triaging',
      to: 'factory:accepted',
      mode: 'legal',
      note: 'accepted',
    });
    repository.createComment('proj', created.id, 'hello');
    repository.createRepoLink({
      projectId: 'proj',
      itemId: created.id,
      repoRef: 'owner/repo',
      role: 'primary',
      source: 'bootstrap',
    });
    repository.createExternalRef({
      projectId: 'proj',
      itemId: created.id,
      provider: 'github',
      kind: 'issue',
      repoRef: 'owner/repo',
      externalId: '42',
      url: 'https://example.test/issues/42',
      metadata: { imported: true },
    });
    repository.addLabel('proj', created.id, 'custom:label');
    repository.setMetadata('proj', created.id, 'schedule', 'next');

    expect(repository.requireWorkItem('proj', created.id)).toMatchObject({
      state: 'factory:accepted',
      schedule: 'next',
    });
    expect(repository.listStateEvents('proj', created.id).map((event) => event.toState)).toEqual([
      'factory:triaging',
      'factory:accepted',
    ]);
    expect(repository.listComments('proj', created.id)[0]).toMatchObject({ body: 'hello' });
    expect(repository.listRepoLinks('proj', created.id)[0]).toMatchObject({
      repoRef: 'owner/repo',
    });
    expect(repository.listExternalRefs('proj', created.id)[0]).toMatchObject({
      provider: 'github',
      kind: 'issue',
      externalId: '42',
    });
    expect(repository.listLabels('proj', created.id)).toEqual(['custom:label']);
  });

  it('creates and assigns local milestones', () => {
    const { repository } = trackedRepository();
    const milestone = repository.createMilestone('proj', 'M1: Local DB');
    const item = repository.createWorkItem({ projectId: 'proj', title: 'A' });

    repository.setMilestone('proj', item.id, milestone.number);

    expect(repository.listMilestones('proj')[0]).toMatchObject({
      number: 1,
      title: 'M1: Local DB',
    });
    expect(repository.requireWorkItem('proj', item.id)).toMatchObject({
      milestoneId: '1',
      milestoneTitle: 'M1: Local DB',
    });
  });
});
