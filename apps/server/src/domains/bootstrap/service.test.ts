import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBootstrapProject, mockInspectGithubRepo } = vi.hoisted(() => ({
  mockBootstrapProject: vi.fn(),
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

import { previewBootstrapService, runBootstrapService } from './service.js';

const ORIGINAL_TOKEN = process.env.GITHUB_TOKEN;
const ORIGINAL_MOCK = process.env.MOCK_BOOTSTRAP;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GITHUB_TOKEN = 'test-token';
  Reflect.deleteProperty(process.env, 'MOCK_BOOTSTRAP');
});

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) Reflect.deleteProperty(process.env, 'GITHUB_TOKEN');
  else process.env.GITHUB_TOKEN = ORIGINAL_TOKEN;
  if (ORIGINAL_MOCK === undefined) Reflect.deleteProperty(process.env, 'MOCK_BOOTSTRAP');
  else process.env.MOCK_BOOTSTRAP = ORIGINAL_MOCK;
  vi.unstubAllGlobals();
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
