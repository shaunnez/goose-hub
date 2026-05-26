import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '../db/schema.js';
import { LocalDbWorkItemRepository } from './local-db-repository.js';
import { LocalDbStateSource } from './local-db.js';

function makeSource() {
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
      `wi_${(sqlite.prepare('select count(*) as count from work_items').get() as { count: number }).count}`,
  });
  return {
    sqlite,
    repository,
    source: new LocalDbStateSource('proj', 'owner/repo', repository),
  };
}

describe('LocalDbStateSource', () => {
  const handles: Database.Database[] = [];

  afterEach(() => {
    for (const handle of handles.splice(0)) handle.close();
  });

  function trackedSource(): ReturnType<typeof makeSource> {
    const result = makeSource();
    handles.push(result.sqlite);
    return result;
  }

  it('creates, gets, lists, comments, labels, and transitions without GitHub', async () => {
    const { source } = trackedSource();
    const created = await source.createIssue({
      title: 'Local source',
      body: 'Depends on: owner/repo#7\nBlocks: #9',
      type: 'bug',
      priority: 'high',
      extraLabels: ['custom:seed'],
    });

    expect(created).toMatchObject({
      id: 'wi_0',
      externalId: '1',
      repoRef: 'owner/repo',
      type: 'bug',
      priority: 'high',
      state: 'factory:triaging',
      dependsOn: ['owner/repo#7'],
      blocks: ['9'],
    });
    expect((await source.getItem('1')).id).toBe(created.id);
    expect((await source.listOpenWork()).map((item) => item.id)).toEqual([created.id]);
    expect(await source.listLabels(created.id)).toEqual([
      'factory:triaging',
      'type:bug',
      'priority:high',
      'schedule:current',
      'mode:supervised',
      'exec:serial',
      'custom:seed',
    ]);

    await source.comment(created.externalId, 'local comment');
    expect(await source.listComments(created.id)).toHaveLength(1);

    await source.transitionState(created.id, 'factory:triaging', 'factory:accepted', 'accepted');
    expect((await source.getItem(created.id)).state).toBe('factory:accepted');
    expect((await source.listComments(created.id)).map((comment) => comment.body)).toContain(
      'accepted',
    );
  });

  it('rejects illegal transitions and records forced transition history', async () => {
    const { source, repository } = trackedSource();
    const created = await source.createIssue({ title: 'A', body: '' });

    await expect(
      source.transitionState(created.id, 'factory:triaging', 'factory:done'),
    ).rejects.toThrow('Illegal transition');

    await source.forceState(created.id, 'factory:done');
    expect((await source.getItem(created.id)).state).toBe('factory:done');
    expect(repository.listStateEvents('proj', created.id).map((event) => event.mode)).toEqual([
      'forced',
      'forced',
    ]);
  });

  it('supports milestone and metadata methods from the StateSource contract', async () => {
    const { source } = trackedSource();
    const milestone = await source.createMilestone('M1: Local DB');
    const created = await source.createIssue({ title: 'A', body: '' });

    await source.setMilestone(created.id, milestone.number);
    await source.setLabelInGroup(created.id, 'schedule', 'next');
    await source.setLabelInGroup(created.id, 'priority', 'critical');
    await source.addLabels(created.id, ['type:research', 'custom:manual']);
    await source.removeLabel(created.id, 'custom:manual');

    expect(await source.listWorkByMilestone(1)).toHaveLength(1);
    expect(await source.listClosedWorkByMilestone(1)).toHaveLength(0);
    expect(await source.getActiveMilestone()).toMatchObject({ number: 1 });
    expect(await source.listLabels(created.id)).toContain('type:research');
    expect(await source.listLabels(created.id)).not.toContain('custom:manual');
  });

  it('uses no-op compatibility methods until local pubsub and PR diff linking are implemented', async () => {
    const { source } = trackedSource();
    const created = await source.createIssue({ title: 'A', body: '' });
    const subscription = await source.watchForUpdates(() => {});

    await source.attach(created.id, { kind: 'note', content: 'x' });
    expect(await source.getPrDiff(created.id)).toBe('');
    expect(() => subscription.unsubscribe()).not.toThrow();
  });
});
