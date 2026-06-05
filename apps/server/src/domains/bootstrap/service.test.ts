import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBootstrapProject, mockGetProject, mockImportIssues, mockInspectGithubRepo } =
  vi.hoisted(() => ({
    mockBootstrapProject: vi.fn(),
    mockGetProject: vi.fn(),
    mockImportIssues: vi.fn(),
    mockInspectGithubRepo: vi.fn(),
  }));

vi.mock('@goose-hub/core/workflows/bootstrap-project.js', async () => {
  const actual = await vi.importActual<
    typeof import('@goose-hub/core/workflows/bootstrap-project.js')
  >('@goose-hub/core/workflows/bootstrap-project.js');
  return {
    ...actual,
    bootstrapProject: mockBootstrapProject,
  };
});

vi.mock('@goose-hub/core/bootstrap/github-repo-inspector.js', () => ({
  inspectGithubRepo: mockInspectGithubRepo,
}));

vi.mock('@goose-hub/core/integrations/github/import-issues.js', () => ({
  importGitHubIssuesToLocalDb: mockImportIssues,
}));

vi.mock('#shared/projects.js', () => ({
  getProject: mockGetProject,
}));

import {
  activateLocalDbProject,
  createLocalProjectService,
  previewBootstrapService,
  previewLocalProjectCreationService,
  runBootstrapService,
} from './service.js';

const ORIGINAL_TOKEN = process.env.GITHUB_TOKEN;
const ORIGINAL_MOCK = process.env.MOCK_BOOTSTRAP;
const ORIGINAL_TARGET_PROJECTS_ROOT = process.env.BOOTSTRAP_TARGET_PROJECTS_ROOT;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GITHUB_TOKEN = 'test-token';
  Reflect.deleteProperty(process.env, 'MOCK_BOOTSTRAP');
  mockGetProject.mockResolvedValue(null);
  mockImportIssues.mockResolvedValue({ imported: 0, updated: 0, skipped: 0, repoRefs: [] });
});

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) Reflect.deleteProperty(process.env, 'GITHUB_TOKEN');
  else process.env.GITHUB_TOKEN = ORIGINAL_TOKEN;
  if (ORIGINAL_MOCK === undefined) Reflect.deleteProperty(process.env, 'MOCK_BOOTSTRAP');
  else process.env.MOCK_BOOTSTRAP = ORIGINAL_MOCK;
  if (ORIGINAL_TARGET_PROJECTS_ROOT === undefined) {
    Reflect.deleteProperty(process.env, 'BOOTSTRAP_TARGET_PROJECTS_ROOT');
  } else {
    process.env.BOOTSTRAP_TARGET_PROJECTS_ROOT = ORIGINAL_TARGET_PROJECTS_ROOT;
  }
  vi.unstubAllGlobals();
});

describe('activateLocalDbProject', () => {
  it('runs idempotent GitHub import for local-db projects', async () => {
    const cfg = {
      id: 'widgets',
      slug: 'widgets',
      source: {
        kind: 'local-db',
        stateMachine: 'db',
        integrations: {
          github: { repos: ['octo/widgets'], importIssues: true, mirrorLabels: true },
        },
      },
      repos: ['octo/widgets'],
    };
    mockGetProject.mockResolvedValue(cfg);
    mockImportIssues.mockResolvedValue({
      imported: 2,
      updated: 1,
      skipped: 0,
      repoRefs: ['octo/widgets'],
    });

    const result = await activateLocalDbProject('widgets');

    expect(result).toMatchObject({
      ok: true,
      data: {
        reposLinked: 1,
        issuesImported: 2,
        issuesUpdated: 1,
        mirrorLabels: true,
      },
    });
    expect(mockImportIssues).toHaveBeenCalledWith(
      expect.objectContaining({ projectConfig: cfg, token: 'test-token' }),
    );
  });

  it('rejects activation for non-local-db projects', async () => {
    mockGetProject.mockResolvedValue({ id: 'x', source: { kind: 'github', repo: 'o/r' } });

    const result = await activateLocalDbProject('x');

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(mockImportIssues).not.toHaveBeenCalled();
  });
});

describe('previewBootstrapService', () => {
  it('returns 400 when repoRef is empty', async () => {
    const result = await previewBootstrapService('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/repoRef/);
    }
  });

  it('returns 400 when repoRef is malformed', async () => {
    const result = await previewBootstrapService('not-a-valid-ref');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns 500 when GITHUB_TOKEN is missing', async () => {
    Reflect.deleteProperty(process.env, 'GITHUB_TOKEN');
    const result = await previewBootstrapService('octo/widgets');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toMatch(/GITHUB_TOKEN/);
    }
  });

  it('returns 400 when a custom slug sanitises to empty', async () => {
    const result = await previewBootstrapService({ repoRef: 'octo/widgets', slug: '!!!---!!!' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/slug|empty/i);
    }
    expect(mockInspectGithubRepo).not.toHaveBeenCalled();
  });

  it('returns 404 when GitHub responds 404 for the repo', async () => {
    mockInspectGithubRepo.mockRejectedValue(new Error('GitHub GET x -> 404: not found'));
    const result = await previewBootstrapService('octo/missing');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });

  it('returns full preview DTO on the happy path', async () => {
    mockInspectGithubRepo.mockResolvedValue({
      repoRef: 'octo/widgets',
      defaultBranch: 'develop',
      description: 'Widgets',
      cloneUrl: 'git@github.com:octo/widgets.git',
      stack: {
        type: 'node',
        packageManager: 'pnpm',
        scripts: { build: 'pnpm build', test: 'pnpm test' },
      },
      audit: {
        action: 'create',
        content: '# CLAUDE.md\n\n…\n',
        rationale: 'No CLAUDE.md found',
        path: 'CLAUDE.md',
      },
    });

    const result = await previewBootstrapService('octo/widgets');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.slug).toBe('widgets');
      expect(result.data.name).toBe('widgets');
      expect(result.data.defaultBranch).toBe('develop');
      expect(result.data.repos[0].repoRef).toBe('octo/widgets');
      expect(result.data.stack.type).toBe('node');
      expect(result.data.stack.summary).toContain('node');
      expect(result.data.audit.action).toBe('create');
      expect(result.data.labelsToInstall.length).toBeGreaterThan(0);
      expect(result.data.labelsToInstall[0]).toMatchObject({
        name: expect.any(String),
        color: expect.any(String),
        description: expect.any(String),
      });
    }
  });

  it('returns deterministic fixture data when MOCK_BOOTSTRAP=true', async () => {
    process.env.MOCK_BOOTSTRAP = 'true';
    Reflect.deleteProperty(process.env, 'GITHUB_TOKEN'); // mock mode must not require a token
    const result = await previewBootstrapService('octo/widgets');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.slug).toBe('widgets');
      expect(result.data.stack.type).toBe('node');
      expect(result.data.audit.action).toBe('create');
      expect(result.data.labelsToInstall.length).toBeGreaterThan(0);
    }
    expect(mockInspectGithubRepo).not.toHaveBeenCalled();
  });
});

describe('runBootstrapService', () => {
  it('returns 400 when repoRef is empty', async () => {
    const result = await runBootstrapService('');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns 500 when GITHUB_TOKEN is missing', async () => {
    Reflect.deleteProperty(process.env, 'GITHUB_TOKEN');
    const result = await runBootstrapService('octo/widgets');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(500);
  });

  it('returns the workflow result on success', async () => {
    mockBootstrapProject.mockResolvedValue({
      status: 'created',
      registrationPrUrl: 'https://github.com/shaunnez/goose-hub/pull/123',
      slug: 'widgets',
      stackSummary: 'node (pnpm)',
      auditAction: 'create',
      labelCounts: { created: 5, updated: 0, skipped: 23 },
    });
    const result = await runBootstrapService('octo/widgets');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe('created');
      expect(result.data.registrationPrUrl).toBe('https://github.com/shaunnez/goose-hub/pull/123');
      expect(result.data.slug).toBe('widgets');
      expect(mockBootstrapProject).toHaveBeenCalledWith(
        expect.objectContaining({
          repoRefs: ['octo/widgets'],
          token: 'test-token',
        }),
      );
    }
  });

  it('passes through `idempotent-skip` results', async () => {
    mockBootstrapProject.mockResolvedValue({
      status: 'idempotent-skip',
      registrationPrUrl: 'https://github.com/shaunnez/goose-hub/pull/9',
      slug: 'widgets',
      stackSummary: '(skipped)',
      auditAction: 'ok',
    });
    const result = await runBootstrapService('octo/widgets');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe('idempotent-skip');
      expect(result.data.registrationPrUrl).toBe('https://github.com/shaunnez/goose-hub/pull/9');
    }
  });

  it('forwards a slug override to the workflow', async () => {
    mockBootstrapProject.mockResolvedValue({
      status: 'created',
      registrationPrUrl: 'https://github.com/shaunnez/goose-hub/pull/124',
      slug: 'custom-slug',
      stackSummary: 'node (pnpm)',
      auditAction: 'ok',
    });
    const result = await runBootstrapService('octo/widgets', 'custom-slug');
    expect(result.ok).toBe(true);
    expect(mockBootstrapProject).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'custom-slug' }),
    );
  });

  it('returns 400 (not 500) for an invalid slug override', async () => {
    // sanitiseSlug throws on empty/punctuation-only inputs.
    const result = await runBootstrapService('octo/widgets', '!!!---!!!');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/slug|empty/i);
    }
    // The workflow must NOT have been invoked for invalid input.
    expect(mockBootstrapProject).not.toHaveBeenCalled();
  });

  it('returns 500 with error message when the workflow throws', async () => {
    mockBootstrapProject.mockRejectedValue(new Error('GitHub API exploded'));
    const result = await runBootstrapService('octo/widgets');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toMatch(/GitHub API exploded/);
    }
  });

  it('returns deterministic fixture data when MOCK_BOOTSTRAP=true', async () => {
    process.env.MOCK_BOOTSTRAP = 'true';
    Reflect.deleteProperty(process.env, 'GITHUB_TOKEN');
    const result = await runBootstrapService('octo/widgets');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe('created');
      expect(result.data.registrationPrUrl).toContain('pull/');
      expect(result.data.slug).toBe('widgets');
    }
    expect(mockBootstrapProject).not.toHaveBeenCalled();
  });
});

describe('local project creation', () => {
  it('previews local-only config without GitHub inspection or imports', async () => {
    const result = await previewLocalProjectCreationService({
      slug: 'local-ops',
      name: 'Local Ops',
      source: { kind: 'local-only' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.configPath).toBe('target-projects/local-ops/project.config.ts');
      expect(result.data.config).toContain("kind: 'local-db'");
      expect(result.data.config).not.toContain('integrations:');
      expect(result.data.repositories).toEqual([]);
    }
    expect(mockInspectGithubRepo).not.toHaveBeenCalled();
    expect(mockBootstrapProject).not.toHaveBeenCalled();
    expect(mockImportIssues).not.toHaveBeenCalled();
  });

  it('previews GitHub code repos with imports off', async () => {
    const result = await previewLocalProjectCreationService({
      source: { kind: 'github-code', repoRefs: ['octo/widgets'] },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.slug).toBe('widgets');
      expect(result.data.integrations).toEqual(['github']);
      expect(result.data.config).toContain('mirrorLabels: false');
      expect(result.data.config).toContain('importIssues: false');
    }
    expect(mockInspectGithubRepo).not.toHaveBeenCalled();
  });

  it('previews Jira assigned-to-me config with credential env names', async () => {
    const result = await previewLocalProjectCreationService({
      source: {
        kind: 'jira',
        baseUrl: 'https://example.atlassian.net',
        projectKeys: ['ENG'],
        importMode: 'assigned-to-me',
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.slug).toBe('eng');
      expect(result.data.requiredEnvVars).toContain('JIRA_EMAIL or ATLASSIAN_EMAIL');
      expect(result.data.config).toContain('importMode: "assigned-to-me"');
    }
  });

  it('previews Bitbucket PR integration as metadata/post-back only', async () => {
    const result = await previewLocalProjectCreationService({
      source: { kind: 'bitbucket', workspace: 'acme', repos: ['api'] },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.integrations).toEqual(['bitbucket']);
      expect(result.data.config).toContain('bitbucket: {');
      expect(result.data.config).not.toContain('kind: "bitbucket"');
    }
  });

  it('previews Bitbucket PR integration across multiple workspaces', async () => {
    const result = await previewLocalProjectCreationService({
      source: {
        kind: 'bitbucket',
        workspaces: [
          { workspace: 'acme', repos: ['api', 'web'] },
          { workspace: 'client', repos: ['portal'] },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.slug).toBe('api');
      expect(result.data.integrations).toEqual(['bitbucket']);
      expect(result.data.repositories.map((repo) => repo.repoRef)).toEqual([
        'acme/api',
        'acme/web',
        'client/portal',
      ]);
      expect(result.data.config).toContain(
        'workspaces: [{"workspace":"acme","repos":["api","web"]},{"workspace":"client","repos":["portal"]}]',
      );
      expect(result.data.config).not.toContain('workspace: "acme"');
    }
  });

  it('rejects more than three Bitbucket workspaces', async () => {
    const result = await previewLocalProjectCreationService({
      source: {
        kind: 'bitbucket',
        workspaces: [
          { workspace: 'one', repos: ['api'] },
          { workspace: 'two', repos: ['api'] },
          { workspace: 'three', repos: ['api'] },
          { workspace: 'four', repos: ['api'] },
        ],
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('bitbucket.workspaces supports up to 3 workspaces');
    }
  });

  it('writes project.config.ts locally without activating imports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goose-hub-target-projects-'));
    process.env.BOOTSTRAP_TARGET_PROJECTS_ROOT = root;

    const result = await createLocalProjectService({
      slug: 'widgets',
      source: { kind: 'github-code', repoRefs: ['octo/widgets'] },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const written = await readFile(result.data.writtenPath, 'utf-8');
      expect(written).toBe(result.data.config);
      expect(written).toContain('importIssues: false');
    }
    expect(mockImportIssues).not.toHaveBeenCalled();
    expect(mockBootstrapProject).not.toHaveBeenCalled();
  });

  it('returns deterministic local create data without writing when MOCK_BOOTSTRAP=true', async () => {
    process.env.MOCK_BOOTSTRAP = 'true';
    const result = await createLocalProjectService({
      slug: 'widgets',
      source: { kind: 'github-code', repoRefs: ['octo/widgets'] },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe('created');
      expect(result.data.writtenPath).toBe('/mock/target-projects/widgets/project.config.ts');
      expect(result.data.config).toContain("kind: 'local-db'");
    }
    expect(mockImportIssues).not.toHaveBeenCalled();
    expect(mockBootstrapProject).not.toHaveBeenCalled();
  });
});
