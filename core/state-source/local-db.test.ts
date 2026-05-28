import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import { LocalDbWorkItemRepository } from './local-db-repository.js';
import { LocalDbStateSource } from './local-db.js';
import type { LocalDbPrDiffAdapters } from './local-db.js';

function makeSource(prDiffAdapters?: LocalDbPrDiffAdapters) {
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
  });
  return {
    sqlite,
    repository,
    source: new LocalDbStateSource('proj', 'owner/repo', repository, undefined, prDiffAdapters),
  };
}

describe('LocalDbStateSource', () => {
  const handles: Database.Database[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const handle of handles.splice(0)) handle.close();
  });

  function trackedSource(prDiffAdapters?: LocalDbPrDiffAdapters): ReturnType<typeof makeSource> {
    const result = makeSource(prDiffAdapters);
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
      id: 'local:proj#1',
      externalId: '1',
      repoRef: 'owner/repo',
      type: 'bug',
      priority: 'high',
      state: 'factory:triaging',
      dependsOn: ['7'],
      blocks: ['9'],
      externalRefs: [],
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

  it('returns the persisted row after managed extra labels mutate metadata', async () => {
    const { source } = trackedSource();

    const created = await source.createIssue({
      title: 'Local source',
      body: '',
      extraLabels: ['factory:accepted', 'schedule:next', 'priority:critical', 'type:research'],
    });

    expect(created).toMatchObject({
      id: 'local:proj#1',
      externalId: '1',
      state: 'factory:accepted',
      schedule: 'next',
      priority: 'critical',
      type: 'research',
    });
  });

  it('includes provider-neutral external refs on listed and fetched Work Items', async () => {
    const { source, repository } = trackedSource();
    const created = await source.createIssue({
      title: 'Imported Jira work',
      body: '',
    });

    repository.upsertExternalRef({
      projectId: 'proj',
      itemId: created.id,
      provider: 'jira',
      kind: 'issue',
      externalId: 'TAS-123',
      url: 'https://company.atlassian.net/browse/TAS-123',
      metadata: { status: 'To Do' },
    });
    repository.upsertExternalRef({
      projectId: 'proj',
      itemId: created.id,
      provider: 'bitbucket',
      kind: 'pull_request',
      repoRef: 'workspace/repo',
      externalId: '45',
      url: 'https://bitbucket.org/workspace/repo/pull-requests/45',
      metadata: { state: 'OPEN' },
    });

    await expect(source.getItem(created.id)).resolves.toMatchObject({
      id: 'local:proj#1',
      externalRefs: [
        {
          provider: 'jira',
          kind: 'issue',
          repoRef: null,
          externalId: 'TAS-123',
          metadata: { status: 'To Do' },
        },
        {
          provider: 'bitbucket',
          kind: 'pull_request',
          repoRef: 'workspace/repo',
          externalId: '45',
          metadata: { state: 'OPEN' },
        },
      ],
    });
    await expect(source.listOpenWork()).resolves.toMatchObject([
      {
        id: 'local:proj#1',
        externalRefs: [
          expect.objectContaining({ provider: 'jira', externalId: 'TAS-123' }),
          expect.objectContaining({ provider: 'bitbucket', externalId: '45' }),
        ],
      },
    ]);
  });

  it('omits open Work Items whose Jira issue ref is hidden', async () => {
    const { source, repository } = trackedSource();
    const visible = await source.createIssue({ title: 'Visible item', body: '' });
    const hidden = await source.createIssue({ title: 'Hidden Jira item', body: '' });

    repository.upsertExternalRef({
      projectId: 'proj',
      itemId: hidden.id,
      provider: 'jira',
      kind: 'issue',
      externalId: 'TAS-456',
      metadata: { hidden: true, stale: true },
    });

    await expect(source.listOpenWork()).resolves.toMatchObject([{ id: visible.id }]);
    await expect(source.getItem(hidden.externalId)).resolves.toMatchObject({ id: hidden.id });
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

  it('routes GitHub PR diff refs through the GitHub diff adapter', async () => {
    const githubDiff = vi.fn(async () => 'diff --git a/src/github.ts b/src/github.ts');
    const bitbucketDiff = vi.fn(async () => 'unexpected');
    const { source, repository } = trackedSource({
      github: { getPullRequestDiff: githubDiff },
      bitbucket: { getPullRequestDiff: bitbucketDiff },
    });
    const created = await source.createIssue({ title: 'GitHub-linked work', body: '' });
    repository.upsertExternalRef({
      projectId: 'proj',
      itemId: created.id,
      provider: 'github',
      kind: 'pull_request',
      repoRef: 'owner/repo',
      externalId: '9',
      url: 'https://github.com/owner/repo/pull/9',
    });

    await expect(source.getPrDiff(created.id)).resolves.toBe(
      'diff --git a/src/github.ts b/src/github.ts',
    );
    expect(githubDiff).toHaveBeenCalledWith({ repoRef: 'owner/repo', pullRequestId: '9' });
    expect(bitbucketDiff).not.toHaveBeenCalled();
  });

  it('routes Bitbucket PR diff refs through the Bitbucket adapter without driving local state', async () => {
    const githubDiff = vi.fn(async () => 'unexpected');
    const bitbucketDiff = vi.fn(async () => 'diff --git a/src/bitbucket.ts b/src/bitbucket.ts');
    const { source, repository } = trackedSource({
      github: { getPullRequestDiff: githubDiff },
      bitbucket: { getPullRequestDiff: bitbucketDiff },
    });
    const created = await source.createIssue({ title: 'Bitbucket-linked work', body: '' });
    repository.upsertExternalRef({
      projectId: 'proj',
      itemId: created.id,
      provider: 'bitbucket',
      kind: 'pull_request',
      repoRef: 'workspace/repo',
      externalId: '45',
      url: 'https://bitbucket.org/workspace/repo/pull-requests/45',
      metadata: { state: 'MERGED' },
    });

    await expect(source.getPrDiff(created.id)).resolves.toBe(
      'diff --git a/src/bitbucket.ts b/src/bitbucket.ts',
    );
    expect(bitbucketDiff).toHaveBeenCalledWith({ repoRef: 'workspace/repo', pullRequestId: '45' });
    expect(githubDiff).not.toHaveBeenCalled();
    await expect(source.getItem(created.id)).resolves.toMatchObject({
      state: 'factory:triaging',
      externalRefs: [
        expect.objectContaining({
          provider: 'bitbucket',
          kind: 'pull_request',
          metadata: { state: 'MERGED' },
        }),
      ],
    });
    expect(repository.listStateEvents('proj', created.id)).toHaveLength(1);
  });

  it('keeps attach, watch, and missing PR diff methods as compatibility no-ops', async () => {
    const { source } = trackedSource();
    const created = await source.createIssue({ title: 'A', body: '' });
    const subscription = await source.watchForUpdates(() => {});

    await source.attach(created.id, { kind: 'note', content: 'x' });
    expect(await source.getPrDiff(created.id)).toBe('');
    expect(() => subscription.unsubscribe()).not.toThrow();
  });
});
