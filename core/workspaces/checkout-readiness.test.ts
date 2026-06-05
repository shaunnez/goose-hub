import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRepositoryConfig } from '../types.js';
import {
  ensureRepositoryCheckout,
  ensureSelectedRepositoryCheckout,
  normalizeRepoRemote,
  repositoryClonePath,
} from './checkout-readiness.js';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  statSync: vi.fn(),
}));
vi.mock('node:os', () => ({ homedir: vi.fn().mockReturnValue('/mock-home') }));

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';

const repoConfig: ProjectRepositoryConfig = {
  id: 'repo',
  repoRef: 'workspace/repo',
  cloneUrl: 'git@bitbucket.org:workspace/repo.git',
  defaultBranch: 'main',
  localPath: '',
};

describe('checkout readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as never);
    vi.mocked(execFileSync).mockImplementation((cmd, args) => {
      if (cmd === 'git' && Array.isArray(args) && args.join(' ') === 'remote get-url origin') {
        return 'https://bitbucket.org/workspace/repo.git\n';
      }
      if (
        cmd === 'git' &&
        Array.isArray(args) &&
        args.join(' ') === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD'
      ) {
        return 'origin/main\n';
      }
      if (cmd === 'git' && Array.isArray(args) && args[0] === 'rev-parse') {
        return 'true\n';
      }
      return '';
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes SSH and HTTPS remotes to the same host/path', () => {
    expect(normalizeRepoRemote('git@bitbucket.org:Workspace/Repo.git')).toBe(
      'bitbucket.org/workspace/repo',
    );
    expect(normalizeRepoRemote('https://bitbucket.org/workspace/repo.git')).toBe(
      'bitbucket.org/workspace/repo',
    );
  });

  it('clones missing repositories under the canonical project repo root', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(ensureRepositoryCheckout('proj', repoConfig)).toMatchObject({
      repoRef: 'workspace/repo',
      clonePath: repositoryClonePath('proj', 'workspace/repo'),
      baseBranch: 'main',
      baseRef: 'origin/main',
    });
    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      'git',
      ['clone', repoConfig.cloneUrl, '/mock-home/.factory/repos/proj/workspace/repo'],
      expect.any(Object),
    );
    expect(vi.mocked(mkdirSync)).toHaveBeenCalledWith('/mock-home/.factory/repos/proj/workspace', {
      recursive: true,
    });
  });

  it('fails existing non-git paths before workflow start', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(execFileSync).mockImplementation((cmd, args) => {
      if (cmd === 'git' && Array.isArray(args) && args[0] === 'rev-parse') {
        throw new Error('not git');
      }
      return '';
    });

    expect(() => ensureRepositoryCheckout('proj', repoConfig)).toThrow(
      'repository checkout path is not a git repository',
    );
  });

  it('fails when the existing clone remote does not match the registered repo', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(execFileSync).mockImplementation((cmd, args) => {
      if (cmd === 'git' && Array.isArray(args) && args.join(' ') === 'remote get-url origin') {
        return 'https://bitbucket.org/workspace/other.git\n';
      }
      return 'true\n';
    });

    expect(() => ensureRepositoryCheckout('proj', repoConfig)).toThrow(
      'repository checkout remote mismatch',
    );
  });

  it('prepares a selected linked repository with the ensured clone path and base ref', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(
      ensureSelectedRepositoryCheckout(
        {
          id: 'proj',
          source: { kind: 'local-db', stateMachine: 'db' },
          repositories: [repoConfig],
        } as never,
        {
          repoRef: 'workspace/repo',
          localPath: '/fallback',
          defaultBranch: 'develop',
          role: 'code',
          selectedBy: 'repo-link-primary',
        },
      ),
    ).toMatchObject({
      repoRef: 'workspace/repo',
      localPath: '/mock-home/.factory/repos/proj/workspace/repo',
      defaultBranch: 'main',
      workflowBase: { branch: 'main', ref: 'origin/main' },
    });
  });
});
