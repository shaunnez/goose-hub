import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { describe, expect, it } from 'vitest';
import * as schema from '../../core/db/schema.js';
import { filterRestartAuxiliaryLabels, restartIssue } from '../../core/projects/restart-issue.js';
import { InMemoryLabelsSource } from '../../core/state-source/in-memory-labels.js';
import { LocalDbWorkItemRepository } from '../../core/state-source/local-db-repository.js';
import { LocalDbStateSource } from '../../core/state-source/local-db.js';

describe('issue restart', () => {
  it('filters lifecycle-owned labels but preserves auxiliary labels', () => {
    expect(
      filterRestartAuxiliaryLabels([
        'factory:in-progress',
        'factory:from-prd',
        'priority:high',
        'schedule:current',
        'type:bug',
        'mode:autonomous',
        'exec:parallel',
        'area:web',
        'custom:dogfood',
        'area:web',
      ]),
    ).toEqual(['factory:from-prd', 'area:web', 'custom:dogfood']);
  });

  it('creates a fresh issue, archives the original, and links both issues', async () => {
    const source = new InMemoryLabelsSource('goose-hub-self', 'shaunnez/goose-hub');
    const oldItem = await source.seedIssue({
      title: 'Dogfood the reset flow',
      body: 'Acceptance criteria\n- Reset starts from scratch',
      type: 'bug',
      priority: 'critical',
      state: 'factory:needs-human',
      schedule: 'blocked-by',
      milestoneId: '1',
    });
    await source.addLabels(oldItem.id, [
      'area:web',
      'factory:from-prd',
      'factory:needs-human',
      'schedule:blocked-by',
    ]);

    const result = await restartIssue({
      source,
      projectId: 'goose-hub-self',
      itemId: oldItem.id,
      targetState: 'factory:dev-ready',
      schedule: 'current',
    });

    const archivedOld = await source.getItem(oldItem.id);
    const fresh = await source.getItem(result.newItem.id);
    const oldComments = await source.listComments(oldItem.id);
    const newComments = await source.listComments(result.newItem.id);

    expect(fresh.externalId).not.toBe(oldItem.externalId);
    expect(fresh.title).toBe(oldItem.title);
    expect(fresh.body).toBe(oldItem.body);
    expect(fresh.type).toBe('bug');
    expect(fresh.priority).toBe('critical');
    expect(fresh.state).toBe('factory:dev-ready');
    expect(fresh.schedule).toBe('current');
    expect(fresh.milestoneId).toBe('1');
    expect(archivedOld.state).toBe('factory:archived');
    expect(source.getExtraLabels(fresh.id)).toEqual(new Set(['area:web', 'factory:from-prd']));
    expect(oldComments.at(-1)?.body).toContain(
      `Fresh issue: shaunnez/goose-hub#${fresh.externalId}`,
    );
    expect(newComments.at(-1)?.body).toContain(
      `Original issue: shaunnez/goose-hub#${oldItem.externalId}`,
    );
  });

  it('preserves the original schedule when no override is provided', async () => {
    const source = new InMemoryLabelsSource('goose-hub-self', 'shaunnez/goose-hub');
    const oldItem = await source.seedIssue({
      title: 'Restart later item',
      state: 'factory:accepted',
      schedule: 'later',
    });

    const result = await restartIssue({
      source,
      projectId: 'goose-hub-self',
      itemId: oldItem.id,
    });

    const fresh = await source.getItem(result.newItem.id);
    expect(fresh.state).toBe('factory:triaging');
    expect(fresh.schedule).toBe('later');
  });

  it('copies local-db primary and related repo links with metadata', async () => {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite, { schema });
    const migrationsFolder = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'core',
      'db',
      'migrations',
    );
    migrate(db, { migrationsFolder });
    const repository = new LocalDbWorkItemRepository({
      db,
      now: () => new Date('2026-06-05T00:00:00.000Z'),
    });
    const source = new LocalDbStateSource('proj', 'owner/app', repository);
    const oldItem = await source.createIssue({ title: 'Restart with repos', body: '' });
    repository.createRepoLink({
      projectId: 'proj',
      itemId: oldItem.id,
      repoRef: 'owner/app',
      role: 'primary',
      confidence: 0.95,
      source: 'affinity',
    });
    repository.createRepoLink({
      projectId: 'proj',
      itemId: oldItem.id,
      repoRef: 'owner/docs',
      role: 'related',
      confidence: 0.5,
      source: 'manual',
    });

    const result = await restartIssue({
      source,
      projectId: 'proj',
      itemId: oldItem.id,
    });

    expect(repository.listRepoLinks('proj', result.newItem.id)).toMatchObject([
      {
        repoRef: 'owner/app',
        role: 'primary',
        confidence: 0.95,
        source: 'affinity',
      },
      {
        repoRef: 'owner/docs',
        role: 'related',
        confidence: 0.5,
        source: 'manual',
      },
    ]);
    sqlite.close();
  });
});
