import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSourceForSlug } = vi.hoisted(() => ({
  mockGetSourceForSlug: vi.fn(),
}));

const { mockGetProject } = vi.hoisted(() => ({
  mockGetProject: vi.fn(),
}));

vi.mock('./source.js', () => ({
  getSourceForSlug: mockGetSourceForSlug,
}));

vi.mock('./projects.js', () => ({
  getProject: mockGetProject,
}));

import {
  resolveCanonicalWorkItemForRoute,
  resolveWorkItemForRoute,
} from './work-item-resolution.js';

function makeSource(item: WorkItem): StateSource {
  return {
    projectId: 'proj',
    repoRef: item.repoRef ?? 'local:proj',
    listOpenWork: vi.fn(),
    listClosedWorkByMilestone: vi.fn(),
    listWorkByMilestone: vi.fn(),
    getItem: vi.fn(async () => item),
    listMilestones: vi.fn(),
    getActiveMilestone: vi.fn(),
    transitionState: vi.fn(),
    forceState: vi.fn(),
    comment: vi.fn(),
    listComments: vi.fn(),
    setMilestone: vi.fn(),
    setLabelInGroup: vi.fn(),
    addLabels: vi.fn(),
    removeLabel: vi.fn(),
    attach: vi.fn(),
    createIssue: vi.fn(),
    createMilestone: vi.fn(),
    updateMilestone: vi.fn(),
    deleteMilestone: vi.fn(),
    getPrDiff: vi.fn(),
    watchForUpdates: vi.fn(),
  };
}

const baseItem = {
  externalId: '42',
  repoRef: 'owner/repo',
  title: 'Issue',
  body: 'Body',
  type: 'feature' as const,
  priority: 'medium' as const,
  mode: 'supervised' as const,
  state: 'factory:triaging' as const,
  authorIsOwner: true,
  schedule: 'current' as const,
  exec: 'serial' as const,
  dependsOn: [],
  blocks: [],
  createdAt: new Date('2026-05-26T00:00:00Z'),
};

describe('resolveWorkItemForRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves GitHub source canonical ids from StateSource.getItem', async () => {
    const item = { ...baseItem, id: 'github:owner/repo#42' };
    const source = makeSource(item);
    mockGetSourceForSlug.mockResolvedValue(source);

    const result = await resolveWorkItemForRoute('proj', '42');

    expect(result).toMatchObject({
      ok: true,
      data: {
        routeId: '42',
        canonicalWorkItemId: 'github:owner/repo#42',
        externalId: '42',
        repoRef: 'owner/repo',
        isLocalDb: false,
      },
    });
    expect(source.getItem).toHaveBeenCalledWith('42');
  });

  it('returns local-db Work Item ids without synthesizing GitHub ids', async () => {
    const item = { ...baseItem, id: 'wi_local_1', externalId: '1' };
    const source = makeSource(item);
    mockGetProject.mockResolvedValue({
      id: 'local-proj',
      source: { kind: 'local-db', stateMachine: 'db' },
    });
    mockGetSourceForSlug.mockResolvedValue(source);

    const result = await resolveWorkItemForRoute('local-proj', '1');

    expect(result).toMatchObject({
      ok: true,
      data: {
        routeId: '1',
        canonicalWorkItemId: 'wi_local_1',
        externalId: '1',
        repoRef: 'owner/repo',
        isLocalDb: true,
      },
    });
  });

  it('resolves GitHub canonical ids without fetching the live issue', async () => {
    mockGetProject.mockResolvedValue({
      id: 'proj',
      source: { kind: 'github', repo: 'owner/repo', stateMachine: 'labels' },
    });

    const result = await resolveCanonicalWorkItemForRoute('proj', '42');

    expect(result).toMatchObject({
      ok: true,
      data: {
        routeId: '42',
        canonicalWorkItemId: 'github:owner/repo#42',
        externalId: '42',
        repoRef: 'owner/repo',
        projectId: 'proj',
        isLocalDb: false,
      },
    });
    expect(mockGetSourceForSlug).not.toHaveBeenCalled();
  });

  it('uses the local source for canonical local-db ids', async () => {
    const item = { ...baseItem, id: 'local:local-proj#1', externalId: '1' };
    const source = makeSource(item);
    mockGetProject.mockResolvedValue({
      id: 'local-proj',
      source: { kind: 'local-db', stateMachine: 'db' },
    });
    mockGetSourceForSlug.mockResolvedValue(source);

    const result = await resolveCanonicalWorkItemForRoute('local-proj', '1');

    expect(result).toMatchObject({
      ok: true,
      data: {
        canonicalWorkItemId: 'local:local-proj#1',
        projectId: 'proj',
        isLocalDb: true,
      },
    });
    expect(source.getItem).toHaveBeenCalledWith('1');
  });

  it('returns a 404 when the project has no source', async () => {
    mockGetSourceForSlug.mockResolvedValue(null);

    await expect(resolveWorkItemForRoute('missing', '1')).resolves.toEqual({
      ok: false,
      error: 'project not found',
      status: 404,
    });
  });

  it('returns a 404 when canonical resolution has no project config', async () => {
    mockGetProject.mockResolvedValue(null);

    await expect(resolveCanonicalWorkItemForRoute('missing', '1')).resolves.toEqual({
      ok: false,
      error: 'project not found',
      status: 404,
    });
  });
});
