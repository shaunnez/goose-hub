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
    expect(rendered).toContain('mirrorLabels: true');
    expect(rendered).toContain('importIssues: true');
  });

  it('renders local-only projects with no integrations', () => {
    const rendered = renderProjectConfig({
      slug: 'local-ops',
      name: 'Local Ops',
      source: { kind: 'local-db', stateMachine: 'db' },
      repositories: [],
      targetRepo: { cloneUrl: '', defaultBranch: 'main', localPath: '~/code/local-ops' },
      detectedAt: '2026-05-28T00:00:00.000Z',
      stack: { type: 'unknown' },
      activeMilestone: undefined,
    });

    expect(rendered).toContain("kind: 'local-db'");
    expect(rendered).not.toContain('integrations:');
    expect(rendered).toContain('repositories: []');
    expect(rendered).toContain('repos: []');
  });

  it('renders GitHub code repositories with imports off', () => {
    const rendered = renderProjectConfig({
      slug: 'widgets',
      source: {
        kind: 'local-db',
        stateMachine: 'db',
        integrations: {
          github: { repos: ['octo/widgets'], mirrorLabels: false, importIssues: false },
        },
      },
      repositories: [
        {
          id: 'octo-widgets',
          repoRef: 'octo/widgets',
          cloneUrl: 'git@github.com:octo/widgets.git',
          defaultBranch: 'main',
          localPath: '~/code/octo/widgets',
          role: 'code',
        },
      ],
      targetRepo: {
        cloneUrl: 'git@github.com:octo/widgets.git',
        defaultBranch: 'main',
        localPath: '~/code/octo/widgets',
      },
      detectedAt: '2026-05-28T00:00:00.000Z',
      stack: { type: 'unknown' },
      activeMilestone: undefined,
    });

    expect(rendered).toContain('github: {');
    expect(rendered).toContain('repos: ["octo/widgets"]');
    expect(rendered).toContain('mirrorLabels: false');
    expect(rendered).toContain('importIssues: false');
  });

  it('renders Jira manual import config', () => {
    const rendered = renderProjectConfig({
      slug: 'jira-manual',
      source: {
        kind: 'local-db',
        stateMachine: 'db',
        integrations: {
          jira: {
            enabled: true,
            baseUrl: 'https://example.atlassian.net',
            projectKeys: ['ENG'],
            importMode: 'manual',
          },
        },
      },
      repositories: [],
      targetRepo: { cloneUrl: '', defaultBranch: 'main', localPath: '~/code/jira-manual' },
      detectedAt: '2026-05-28T00:00:00.000Z',
      stack: { type: 'unknown' },
      activeMilestone: undefined,
    });

    expect(rendered).toContain('jira: {');
    expect(rendered).toContain('baseUrl: "https://example.atlassian.net"');
    expect(rendered).toContain('projectKeys: ["ENG"]');
    expect(rendered).toContain('importMode: "manual"');
  });

  it('renders Jira assigned-to-me config', () => {
    const rendered = renderProjectConfig({
      slug: 'jira-mine',
      source: {
        kind: 'local-db',
        stateMachine: 'db',
        integrations: {
          jira: {
            enabled: true,
            baseUrl: 'https://example.atlassian.net',
            projectKeys: ['ENG'],
            importMode: 'assigned-to-me',
          },
        },
      },
      repositories: [],
      targetRepo: { cloneUrl: '', defaultBranch: 'main', localPath: '~/code/jira-mine' },
      detectedAt: '2026-05-28T00:00:00.000Z',
      stack: { type: 'unknown' },
      activeMilestone: undefined,
    });

    expect(rendered).toContain('importMode: "assigned-to-me"');
  });

  it('renders Bitbucket PR integration config', () => {
    const rendered = renderProjectConfig({
      slug: 'bb-prs',
      source: {
        kind: 'local-db',
        stateMachine: 'db',
        integrations: {
          bitbucket: {
            enabled: true,
            workspace: 'acme',
            repos: ['api'],
            postBack: { pullRequests: true, comments: true },
          },
        },
      },
      repositories: [
        {
          id: 'acme-api',
          repoRef: 'acme/api',
          cloneUrl: 'git@bitbucket.org:acme/api.git',
          defaultBranch: 'main',
          localPath: '~/code/acme/api',
          role: 'code',
        },
      ],
      targetRepo: {
        cloneUrl: 'git@bitbucket.org:acme/api.git',
        defaultBranch: 'main',
        localPath: '~/code/acme/api',
      },
      detectedAt: '2026-05-28T00:00:00.000Z',
      stack: { type: 'unknown' },
      activeMilestone: undefined,
    });

    expect(rendered).toContain('bitbucket: {');
    expect(rendered).toContain('workspace: "acme"');
    expect(rendered).toContain('repos: ["api"]');
    expect(rendered).toContain('postBack: { pullRequests: true, comments: true }');
  });
});
