import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkItem } from '../state-source/interface.js';
import type {
  LocalDbRepoLinkRow,
  LocalDbWorkItemRepository,
} from '../state-source/local-db-repository.js';
import type { ProjectConfig } from '../types.js';
import {
  resolveRepositoryForWorkItem,
  selectCheckoutRepoLink,
  selectRepoLink,
} from './repo-affinity.js';

const { mockReplayEvents } = vi.hoisted(() => ({
  mockReplayEvents: vi.fn(),
}));

vi.mock('../event-stream/store.js', () => ({
  eventStore: {
    replay: mockReplayEvents,
  },
}));

function repoLink(repoRef: string, role: string): LocalDbRepoLinkRow {
  return {
    id: 1,
    projectId: 'proj',
    workItemId: 'local:proj#1',
    repoRef,
    role,
    confidence: null,
    source: 'test',
    createdAt: '2026-05-26T00:00:00.000Z',
  };
}

const appRepoPath = mkdtempSync(join(tmpdir(), 'repo-affinity-app-'));
const docsRepoPath = mkdtempSync(join(tmpdir(), 'repo-affinity-docs-'));
const fallbackRepoPath = mkdtempSync(join(tmpdir(), 'repo-affinity-fallback-'));
const targetRepoPath = mkdtempSync(join(tmpdir(), 'repo-affinity-target-'));

function missingPath(label: string): string {
  return join(tmpdir(), `repo-affinity-missing-${label}-${Date.now()}`);
}

const project = {
  id: 'proj',
  repos: ['owner/app', 'owner/docs'],
  targetRepo: { localPath: targetRepoPath, defaultBranch: 'main', cloneUrl: '' },
  repositories: [
    {
      id: 'app',
      repoRef: 'owner/app',
      localPath: appRepoPath,
      defaultBranch: 'main',
      cloneUrl: '',
    },
    {
      id: 'docs',
      repoRef: 'owner/docs',
      localPath: docsRepoPath,
      defaultBranch: 'trunk',
      cloneUrl: '',
    },
  ],
} as ProjectConfig;

function appRepository(): NonNullable<ProjectConfig['repositories']>[number] {
  const repository = project.repositories?.[0];
  if (!repository) {
    throw new Error('expected project.repositories[0] test fixture');
  }
  return repository;
}

const workItem = {
  id: 'local:proj#1',
  externalId: '1',
  repoRef: 'owner/app',
} as WorkItem;

const githubWorkItem = {
  ...workItem,
  id: 'github:owner/app#1',
} as WorkItem;

describe('repo affinity', () => {
  beforeEach(() => {
    mockReplayEvents.mockReset().mockReturnValue([]);
  });

  it('selects a primary repo link over other linked repos', () => {
    expect(
      selectRepoLink([repoLink('owner/app', 'related'), repoLink('owner/docs', 'primary')]),
    ).toMatchObject({ repoRef: 'owner/docs' });
  });

  it('does not treat a lone related repo link as checkout-eligible', () => {
    expect(selectCheckoutRepoLink([repoLink('owner/app', 'related')])).toEqual({
      kind: 'repo-unassigned',
      reason: 'no-primary',
    });
  });

  it('returns typed unassigned for multiple related links with no primary', () => {
    expect(
      selectCheckoutRepoLink([repoLink('owner/app', 'related'), repoLink('owner/docs', 'related')]),
    ).toEqual({
      kind: 'repo-unassigned',
      reason: 'no-primary',
    });
  });

  it('keeps compatibility throws for no-primary repo links', () => {
    expect(() =>
      selectRepoLink([repoLink('owner/app', 'related'), repoLink('owner/docs', 'related')]),
    ).toThrow('no primary repo link');
  });

  it('resolves implementation localPath and defaultBranch from the selected repo link', () => {
    const repository = {
      listRepoLinks: () => [repoLink('owner/docs', 'primary')],
    } as unknown as LocalDbWorkItemRepository;

    expect(
      resolveRepositoryForWorkItem({
        project,
        workItem,
        fallbackLocalPath: fallbackRepoPath,
        repository,
      }),
    ).toMatchObject({
      repoRef: 'owner/docs',
      localPath: docsRepoPath,
      defaultBranch: 'trunk',
      selectedBy: 'repo-link-primary',
    });
  });

  it('rejects local-db repo links missing from repositories instead of falling back to targetRepo', () => {
    const repository = {
      listRepoLinks: () => [repoLink('workspace/bitbucket-repo', 'primary')],
    } as unknown as LocalDbWorkItemRepository;

    expect(() =>
      resolveRepositoryForWorkItem({
        project,
        workItem,
        fallbackLocalPath: '/repo',
        repository,
      }),
    ).toThrow("repo 'workspace/bitbucket-repo' is not registered");
  });

  it('uses the latest manual repo override when a local-db item has no primary link yet', () => {
    mockReplayEvents.mockReturnValue([
      {
        kind: 'agent.repo-override',
        payload: { repo: 'owner/docs' },
      },
    ]);
    const repository = {
      listRepoLinks: () => [repoLink('owner/app', 'related')],
    } as unknown as LocalDbWorkItemRepository;

    expect(
      resolveRepositoryForWorkItem({
        project,
        workItem: { ...workItem, repoRef: null } as WorkItem,
        fallbackLocalPath: fallbackRepoPath,
        repository,
      }),
    ).toMatchObject({
      repoRef: 'owner/docs',
      localPath: docsRepoPath,
      defaultBranch: 'trunk',
      selectedBy: 'repo-override',
    });
  });

  it('uses a valid configured repository path before project targetRepo and fallback', () => {
    expect(
      resolveRepositoryForWorkItem({
        project,
        workItem: githubWorkItem,
        fallbackLocalPath: fallbackRepoPath,
      }),
    ).toMatchObject({
      repoRef: 'owner/app',
      localPath: appRepoPath,
      defaultBranch: 'main',
      selectedBy: 'work-item',
    });
  });

  it('falls back to input fallbackLocalPath when configured path is a missing home path', () => {
    const missingHomeProject = {
      ...project,
      targetRepo: { ...project.targetRepo, localPath: `~/missing-${Date.now()}` },
      repositories: [
        {
          ...appRepository(),
          localPath: `~/missing-${Date.now()}`,
        },
      ],
    } as ProjectConfig;

    expect(
      resolveRepositoryForWorkItem({
        project: missingHomeProject,
        workItem: githubWorkItem,
        fallbackLocalPath: fallbackRepoPath,
      }),
    ).toMatchObject({
      localPath: fallbackRepoPath,
    });
  });

  it('uses targetRepo defaultBranch when configured repo path is stale', () => {
    const staleConfiguredProject = {
      ...project,
      targetRepo: { localPath: targetRepoPath, defaultBranch: 'develop', cloneUrl: '' },
      repositories: [
        {
          ...appRepository(),
          localPath: missingPath('configured'),
          defaultBranch: 'feature-branch',
        },
      ],
    } as ProjectConfig;

    expect(
      resolveRepositoryForWorkItem({
        project: staleConfiguredProject,
        workItem: githubWorkItem,
        fallbackLocalPath: fallbackRepoPath,
      }),
    ).toMatchObject({
      localPath: targetRepoPath,
      defaultBranch: 'develop',
    });
  });

  it('falls back when configured and targetRepo absolute paths are missing', () => {
    const missingAbsoluteProject = {
      ...project,
      targetRepo: { ...project.targetRepo, localPath: missingPath('target') },
      repositories: [
        {
          ...appRepository(),
          localPath: missingPath('configured'),
        },
      ],
    } as ProjectConfig;

    expect(
      resolveRepositoryForWorkItem({
        project: missingAbsoluteProject,
        workItem: githubWorkItem,
        fallbackLocalPath: fallbackRepoPath,
      }),
    ).toMatchObject({
      localPath: fallbackRepoPath,
    });
  });
});
