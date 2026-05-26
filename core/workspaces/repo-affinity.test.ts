import { describe, expect, it } from 'vitest';
import type { WorkItem } from '../state-source/interface.js';
import type {
  LocalDbRepoLinkRow,
  LocalDbWorkItemRepository,
} from '../state-source/local-db-repository.js';
import type { ProjectConfig } from '../types.js';
import { resolveRepositoryForWorkItem, selectRepoLink } from './repo-affinity.js';

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

const project = {
  id: 'proj',
  repos: ['owner/app', 'owner/docs'],
  targetRepo: { localPath: '/fallback', defaultBranch: 'main', cloneUrl: '' },
  repositories: [
    {
      id: 'app',
      repoRef: 'owner/app',
      localPath: '/repos/app',
      defaultBranch: 'main',
      cloneUrl: '',
    },
    {
      id: 'docs',
      repoRef: 'owner/docs',
      localPath: '/repos/docs',
      defaultBranch: 'trunk',
      cloneUrl: '',
    },
  ],
} as ProjectConfig;

const workItem = {
  id: 'local:proj#1',
  externalId: '1',
  repoRef: 'owner/app',
} as WorkItem;

describe('repo affinity', () => {
  it('selects a primary repo link over other linked repos', () => {
    expect(
      selectRepoLink([repoLink('owner/app', 'context'), repoLink('owner/docs', 'primary')]),
    ).toMatchObject({ repoRef: 'owner/docs' });
  });

  it('rejects ambiguous local-db repo links with no primary', () => {
    expect(() =>
      selectRepoLink([repoLink('owner/app', 'context'), repoLink('owner/docs', 'context')]),
    ).toThrow('multiple repo links and no primary');
  });

  it('resolves implementation localPath and defaultBranch from the selected repo link', () => {
    const repository = {
      listRepoLinks: () => [repoLink('owner/docs', 'primary')],
    } as unknown as LocalDbWorkItemRepository;

    expect(
      resolveRepositoryForWorkItem({
        project,
        workItem,
        fallbackLocalPath: '/repo',
        repository,
      }),
    ).toMatchObject({
      repoRef: 'owner/docs',
      localPath: '/repos/docs',
      defaultBranch: 'trunk',
      selectedBy: 'repo-link-primary',
    });
  });
});
