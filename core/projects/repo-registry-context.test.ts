import { describe, expect, it } from 'vitest';
import type { ProjectConfig } from '../types.js';
import { buildRepoRegistryContext, parseRepoDescriptions } from './repo-registry-context.js';

function project(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    id: 'widgets',
    name: 'Widgets',
    slug: 'widgets',
    source: { kind: 'local-db', stateMachine: 'db' },
    targetRepo: {
      cloneUrl: 'https://github.com/acme/widgets.git',
      defaultBranch: 'main',
      localPath: '../widgets',
    },
    repositories: [
      {
        id: 'widgets',
        repoRef: 'acme/widgets',
        cloneUrl: 'https://github.com/acme/widgets.git',
        defaultBranch: 'trunk',
        localPath: '../widgets',
        role: 'code',
      },
      {
        id: 'docs',
        repoRef: 'acme/docs',
        cloneUrl: 'https://github.com/acme/docs.git',
        defaultBranch: 'main',
        localPath: '../docs',
        role: 'docs',
      },
    ],
    stack: {
      runtime: 'node',
      packageManager: 'pnpm',
      testCommand: 'pnpm test',
      detectedAt: '2026-01-01T00:00:00.000Z',
    },
    mode: 'supervised',
    storage: { kind: 'local', path: '.factory/widgets.db' },
    repos: ['acme/widgets', 'acme/docs'],
    agentConfig: { runtime: 'auto' },
    budgets: { perWorkflowMaxUsd: 1, dailyTokens: 1000, perAdvisorMaxUsd: 0.5 },
    governance: { owner: 'team', escalation: 'ask' },
    isolation: { mode: 'worktree' },
    archiveAfterDays: 30,
    visibility: 'always_visible',
    ...overrides,
  } as ProjectConfig;
}

describe('parseRepoDescriptions', () => {
  it('extracts descriptions keyed by repo ref', () => {
    const descriptions = parseRepoDescriptions(
      '### [acme/widgets](https://github.com/acme/widgets)\n**Description:** Widget app.\n',
    );

    expect(descriptions.get('acme/widgets')).toBe('Widget app.');
  });
});

describe('buildRepoRegistryContext', () => {
  it('uses project.config.ts repositories as the allowlist authority', () => {
    const context = buildRepoRegistryContext(project());

    expect(context).toContain('### [acme/widgets](https://github.com/acme/widgets)');
    expect(context).toContain('**Default branch:** `trunk`');
    expect(context).toContain('**Description:** acme/docs managed by Factory.');
  });

  it('uses repos.md only to enrich descriptions', () => {
    const context = buildRepoRegistryContext(
      project(),
      '### [acme/widgets](https://github.com/acme/widgets)\n**Description:** Widget app.\n',
    );

    expect(context).toContain('**Description:** Widget app.');
    expect(context).toContain('**Description:** acme/docs managed by Factory.');
  });
});
