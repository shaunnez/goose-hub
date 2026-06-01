import { describe, expect, it } from 'vitest';
import { renderProjectConfig } from './bootstrap-renderers.js';

describe('renderProjectConfig', () => {
  it('renders newly bootstrapped projects as local-db with repositories as the canonical registry', () => {
    const rendered = renderProjectConfig({
      slug: 'widgets',
      name: 'Widgets',
      repoRef: 'workspace/widgets-api',
      repos: [
        {
          repoRef: 'workspace/widgets-api',
          defaultBranch: 'main',
          description: 'API',
          cloneUrl: 'git@bitbucket.org:workspace/widgets-api.git',
        },
        {
          repoRef: 'workspace/widgets-web',
          defaultBranch: 'trunk',
          description: 'Web',
          cloneUrl: 'git@bitbucket.org:workspace/widgets-web.git',
        },
      ],
      defaultBranch: 'main',
      cloneRoot: '/repos',
      detectedAt: '2026-05-28T00:00:00.000Z',
      stack: {
        type: 'node',
        packageManager: 'pnpm',
        scripts: {
          test: 'pnpm test',
          typecheck: 'pnpm typecheck',
        },
      },
    });

    expect(rendered).toContain("kind: 'local-db'");
    expect(rendered).toContain("stateMachine: 'db'");
    expect(rendered).not.toContain("kind: 'github'");
    expect(rendered).not.toContain("repo: 'workspace/widgets-api'");
    expect(rendered).toContain('repositories: [');
    expect(rendered).toContain('repoRef: "workspace/widgets-api"');
    expect(rendered).toContain('repoRef: "workspace/widgets-web"');
    expect(rendered).toContain('repos: ["workspace/widgets-api","workspace/widgets-web"]');
    expect(rendered).toContain('targetRepo: {');
  });
});
