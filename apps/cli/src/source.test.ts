import type { ProjectConfig } from '@goose-hub/core/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sources = vi.hoisted(() => ({
  github: vi.fn((...args: unknown[]) => ({ kind: 'github-source', args })),
  localDb: vi.fn((...args: unknown[]) => ({ kind: 'local-db-source', args })),
}));

vi.mock('@goose-hub/core/state-source/github-labels.js', () => ({
  GitHubLabelsSource: sources.github,
}));

vi.mock('@goose-hub/core/state-source/local-db.js', () => ({
  LocalDbStateSource: sources.localDb,
}));

import { createCliStateSource } from './source.js';

function project(overrides: Partial<ProjectConfig>): ProjectConfig {
  return {
    id: 'proj',
    name: 'Project',
    slug: 'proj',
    source: { kind: 'local-db', stateMachine: 'db' },
    targetRepo: {
      cloneUrl: 'git@example.com:owner/repo.git',
      defaultBranch: 'main',
      localPath: '/tmp/repo',
    },
    repositories: [
      {
        id: 'repo',
        repoRef: 'owner/repo',
        cloneUrl: 'git@example.com:owner/repo.git',
        defaultBranch: 'main',
        localPath: '/tmp/repo',
        role: 'code',
      },
    ],
    stack: {
      runtime: 'node',
      packageManager: 'pnpm',
      testCommand: 'pnpm test',
      detectedAt: '2026-06-05T00:00:00Z',
    },
    mode: 'supervised',
    storage: { kind: 'local', path: '/tmp/proj' },
    repos: ['owner/repo'],
    agentConfig: {
      runtime: 'auto',
      rolesModels: {},
      fallbackPolicy: {},
      advisorMode: {
        enabled: false,
        triggerOn: { priorities: [] },
        maxAdvisorBudgetUsd: 0,
        disableInAutonomous: true,
      },
      retrospectivePolicy: { defaultTier: 'light', deepTriggers: [] },
    },
    budgets: {
      dailyTokens: 0,
      maxParallelAgents: 1,
      maxRetries: 0,
      perBashCommandMaxSeconds: 30,
      perWorkflowMaxUsd: 0,
      perAgentMaxUsd: 0,
      perAdvisorMaxUsd: 0,
    },
    governance: { immutablePaths: [] },
    isolation: { mode: 'native' },
    archiveAfterDays: 30,
    visibility: 'always_visible',
    colorStripe: '#000000',
    ...overrides,
  };
}

describe('createCliStateSource', () => {
  afterEach(() => {
    process.env.GITHUB_TOKEN = '';
    sources.github.mockClear();
    sources.localDb.mockClear();
  });

  it('creates local-db sources without requiring GITHUB_TOKEN', () => {
    process.env.GITHUB_TOKEN = '';

    const source = createCliStateSource(project({}));

    expect(source).toEqual({ kind: 'local-db-source', args: expect.any(Array) });
    expect(sources.localDb).toHaveBeenCalledWith('proj', 'owner/repo', undefined, undefined);
    expect(sources.github).not.toHaveBeenCalled();
  });

  it('falls back to a local repo ref when local-db projects have no repository', () => {
    createCliStateSource(project({ repositories: [], repos: [] }));

    expect(sources.localDb).toHaveBeenCalledWith('proj', 'local:proj', undefined, undefined);
  });

  it('requires GITHUB_TOKEN only for GitHub-backed projects', () => {
    expect(() =>
      createCliStateSource(
        project({
          source: { kind: 'github', repo: 'owner/repo', stateMachine: 'labels' },
        }),
      ),
    ).toThrow('GITHUB_TOKEN is required for GitHub-backed projects.');
  });

  it('creates GitHub sources when the token is available', () => {
    process.env.GITHUB_TOKEN = 'token';

    createCliStateSource(
      project({
        source: { kind: 'github', repo: 'owner/repo', stateMachine: 'labels' },
      }),
    );

    expect(sources.github).toHaveBeenCalledWith('proj', 'owner/repo', 'token', 'owner');
  });
});
