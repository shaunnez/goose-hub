import {
  type BootstrapInput,
  bootstrapProject,
  parseRepoRef,
  renderProjectConfig,
  renderReposMd,
  sanitiseSlug,
  summariseStack,
} from '@goose-hub/core/workflows/bootstrap-project.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeNodeStack(scripts: Record<string, string> = {}) {
  return {
    type: 'node' as const,
    packageManager: 'pnpm' as const,
    scripts: {
      build: scripts.build,
      test: scripts.test,
      lint: scripts.lint,
      typecheck: scripts.typecheck,
      e2e: scripts.e2e,
    },
  };
}

interface RecordedRequest {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

function makeMockFetch(handlers: {
  /** Returns existing PRs to surface for the head-branch idempotency check. */
  existingPrs?: { number: number; state: string; html_url: string; ref: string }[];
  /** Default branch sha returned by /repos/{owner}/{repo}/git/ref/heads/<default>. */
  defaultBranchSha?: string;
  /** Default branch name returned by goose-hub /repos/shaunnez/goose-hub. */
  defaultBranch?: string;
  /** Default branch name for the *target* repo (defaults to 'main'). */
  targetDefaultBranch?: string;
  /** Description for the *target* repo (defaults to empty string). */
  targetDescription?: string;
  /** PR number / html_url to return for a successfully opened PR. */
  openedPr?: { number: number; html_url: string };
  /** When true, POST /git/refs returns 422 "Reference already exists". */
  branchAlreadyExists?: boolean;
}) {
  const recorded: RecordedRequest[] = [];

  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = String(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    let parsedBody: unknown;
    try {
      parsedBody = init?.body ? JSON.parse(init.body as string) : undefined;
    } catch {
      parsedBody = init?.body;
    }
    recorded.push({
      url: urlStr,
      method,
      body: parsedBody,
      headers: { ...((init?.headers as Record<string, string>) ?? {}) },
    });

    // 1) Idempotency check — list PRs filtered by head ref.
    if (
      method === 'GET' &&
      urlStr.startsWith('https://api.github.com/repos/shaunnez/goose-hub/pulls')
    ) {
      const existing = handlers.existingPrs ?? [];
      const url2 = new URL(urlStr);
      const headFilter = url2.searchParams.get('head') ?? '';
      // headFilter looks like "shaunnez:bootstrap/<slug>"
      const wantedRef = headFilter.split(':').slice(1).join(':');
      const matches = existing
        .filter((p) => p.ref === wantedRef)
        .map((p) => ({
          number: p.number,
          state: p.state,
          html_url: p.html_url,
          head: { ref: p.ref },
        }));
      return jsonResponse(matches);
    }

    // 2) Repo metadata.
    if (method === 'GET' && urlStr === 'https://api.github.com/repos/shaunnez/goose-hub') {
      return jsonResponse({ default_branch: handlers.defaultBranch ?? 'main' });
    }

    // 3) Default branch ref → sha.
    if (method === 'GET' && /\/repos\/shaunnez\/goose-hub\/git\/ref\/heads\//.test(urlStr)) {
      return jsonResponse({ object: { sha: handlers.defaultBranchSha ?? 'deadbeef' } });
    }

    // 4) Create branch ref.
    if (
      method === 'POST' &&
      urlStr === 'https://api.github.com/repos/shaunnez/goose-hub/git/refs'
    ) {
      if (handlers.branchAlreadyExists) {
        return new Response(JSON.stringify({ message: 'Reference already exists' }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return jsonResponse({ ref: (parsedBody as { ref: string }).ref }, 201);
    }

    // 4b) Target repo metadata (used to discover its default branch + description).
    if (
      method === 'GET' &&
      /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(urlStr) &&
      urlStr !== 'https://api.github.com/repos/shaunnez/goose-hub'
    ) {
      return jsonResponse({
        default_branch: handlers.targetDefaultBranch ?? 'main',
        description: handlers.targetDescription ?? '',
      });
    }

    // 5) Put file via Contents API.
    if (
      method === 'PUT' &&
      urlStr.startsWith('https://api.github.com/repos/shaunnez/goose-hub/contents/')
    ) {
      return jsonResponse({ content: { sha: 'abc' } }, 201);
    }

    // 6) Open PR.
    if (method === 'POST' && urlStr === 'https://api.github.com/repos/shaunnez/goose-hub/pulls') {
      const opened = handlers.openedPr ?? {
        number: 9999,
        html_url: 'https://github.com/shaunnez/goose-hub/pull/9999',
      };
      return jsonResponse(opened, 201);
    }

    // 7) Apply labels.
    if (method === 'POST' && /\/repos\/shaunnez\/goose-hub\/issues\/\d+\/labels$/.test(urlStr)) {
      return jsonResponse([{ name: 'factory:bootstrap-pr' }], 200);
    }

    // 8) Label installer paths (target repo).
    if (method === 'GET' && /\/repos\/[^/]+\/[^/]+\/labels/.test(urlStr)) {
      return jsonResponse([]);
    }
    if (method === 'POST' && /\/repos\/[^/]+\/[^/]+\/labels$/.test(urlStr)) {
      return jsonResponse({}, 201);
    }
    if (method === 'PATCH' && /\/repos\/[^/]+\/[^/]+\/labels\//.test(urlStr)) {
      return jsonResponse({}, 200);
    }

    return new Response(`Unmocked: ${method} ${urlStr}`, { status: 404 });
  });

  return { fetchImpl, recorded };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeDeps(overrides: {
  fetchImpl?: ReturnType<typeof vi.fn>;
  detectStack?: () => unknown;
  auditClaudeMd?: () => unknown;
  installLabels?: () => unknown;
  inspectGithubRepo?: () => unknown;
}) {
  const writeFile = vi.fn().mockResolvedValue(undefined);
  const mkdir = vi.fn().mockResolvedValue(undefined);
  const log = vi.fn();
  return {
    fetch: overrides.fetchImpl as unknown as typeof fetch,
    detectStack: overrides.detectStack as never,
    auditClaudeMd: overrides.auditClaudeMd as never,
    installLabels: overrides.installLabels as never,
    inspectGithubRepo: overrides.inspectGithubRepo as never,
    writeFile: writeFile as unknown as typeof import('node:fs/promises').writeFile,
    mkdir: mkdir as unknown as typeof import('node:fs/promises').mkdir,
    log,
    _writeFile: writeFile,
    _mkdir: mkdir,
    _log: log,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('sanitiseSlug', () => {
  it('lowercases + replaces non-alphanumeric with hyphen', () => {
    expect(sanitiseSlug('My_Repo!Name')).toBe('my-repo-name');
  });

  it('collapses repeated hyphens and trims edges', () => {
    expect(sanitiseSlug('---Foo___Bar---')).toBe('foo-bar');
  });

  it('rejects empty input', () => {
    expect(() => sanitiseSlug('')).toThrow();
  });

  it('rejects input that resolves to empty', () => {
    expect(() => sanitiseSlug('---!!!---')).toThrow();
  });
});

describe('parseRepoRef', () => {
  it('parses owner/repo', () => {
    expect(parseRepoRef('shaunnez/goose-hub')).toEqual({ owner: 'shaunnez', repo: 'goose-hub' });
  });

  it('rejects malformed refs', () => {
    expect(() => parseRepoRef('')).toThrow();
    expect(() => parseRepoRef('justname')).toThrow();
    expect(() => parseRepoRef('a/b/c')).toThrow();
    expect(() => parseRepoRef('/repo')).toThrow();
  });
});

describe('summariseStack', () => {
  it('summarises node stack with package manager + scripts', () => {
    const summary = summariseStack(makeNodeStack({ test: 'pnpm test', lint: 'pnpm lint' }));
    expect(summary).toContain('node');
    expect(summary).toContain('pnpm');
    expect(summary).toContain('test');
    expect(summary).toContain('lint');
  });

  it('handles unknown stack', () => {
    expect(summariseStack({ type: 'unknown' })).toContain('unknown');
  });
});

describe('renderProjectConfig', () => {
  it('embeds slug, repoRef, and detectedAt', () => {
    const out = renderProjectConfig({
      slug: 'my-app',
      repoRef: 'octo/my-app',
      defaultBranch: 'main',
      cloneRoot: '/tmp/repos',
      stack: makeNodeStack({ test: 'pnpm test' }),
      detectedAt: '2026-05-07T00:00:00.000Z',
    });
    expect(out).toContain('id: "my-app"');
    expect(out).toContain('slug: "my-app"');
    expect(out).toContain('"octo/my-app"');
    expect(out).toContain('2026-05-07T00:00:00.000Z');
    expect(out).toContain('export default config');
  });

  it('produces valid TS structure for an unknown stack', () => {
    const out = renderProjectConfig({
      slug: 'mystery',
      repoRef: 'octo/mystery',
      defaultBranch: 'main',
      cloneRoot: '/tmp',
      stack: { type: 'unknown' },
      detectedAt: '2026-05-07T00:00:00.000Z',
    });
    expect(out).toContain("runtime: 'unknown'");
    expect(out).toContain('testCommand:');
  });
});

// ---------------------------------------------------------------------------
// renderReposMd
// ---------------------------------------------------------------------------

describe('renderReposMd', () => {
  it('includes slug, repoRef, and provided description', () => {
    const out = renderReposMd('my-app', 'octo/my-app', 'A widget factory.');
    expect(out).toContain('Repo Registry — my-app');
    expect(out).toContain('[octo/my-app](https://github.com/octo/my-app)');
    expect(out).toContain('A widget factory.');
  });

  it('falls back to default description when empty', () => {
    const out = renderReposMd('my-app', 'octo/my-app', '');
    expect(out).toContain('octo/my-app managed by Factory.');
  });
});

// ---------------------------------------------------------------------------
// bootstrapProject — happy path
// ---------------------------------------------------------------------------

const HAPPY_INPUT: BootstrapInput = {
  repoRef: 'octo/widgets',
  token: 'ghp_test',
  cloneRoot: '/tmp/clones',
};

function happyDetectStack() {
  return vi.fn().mockResolvedValue(makeNodeStack({ test: 'pnpm test', lint: 'pnpm lint' }));
}

function happyAudit(action: 'create' | 'update' | 'ok' = 'create') {
  const content =
    action === 'create'
      ? '# CLAUDE.md\n\n## What this repo is\n\n…\n'
      : action === 'update'
        ? '--- a/CLAUDE.md\n+++ b/CLAUDE.md\n@@ -1,0 +1,3 @@\n+## Stack\n+\n+- Language/framework: node\n'
        : '';
  return vi.fn().mockResolvedValue({ action, content, rationale: 'mock' });
}

function happyInstallLabels(counts = { created: 5, updated: 2, skipped: 40, errors: [] }) {
  return vi.fn().mockResolvedValue(counts);
}

function happyInspect(defaultBranch = 'main') {
  return vi.fn().mockResolvedValue({
    repoRef: 'octo/widgets',
    defaultBranch,
    description: '',
    cloneUrl: 'git@github.com:octo/widgets.git',
    stack: makeNodeStack({ test: 'pnpm test', lint: 'pnpm lint' }),
    audit: {
      action: 'create' as const,
      content: '# CLAUDE.md\n\n## What this repo is\n\n…\n',
      rationale: 'mock',
      path: 'CLAUDE.md',
    },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('bootstrapProject — happy path', () => {
  it('runs all four steps + opens PR + applies bootstrap label', async () => {
    const { fetchImpl, recorded } = makeMockFetch({
      openedPr: { number: 4242, html_url: 'https://github.com/shaunnez/goose-hub/pull/4242' },
    });

    const detectStack = happyDetectStack();
    const auditClaudeMd = happyAudit('create');
    const installLabels = happyInstallLabels();
    const deps = makeDeps({ fetchImpl, detectStack, auditClaudeMd, installLabels });

    const result = await bootstrapProject(HAPPY_INPUT, deps);

    expect(result.status).toBe('created');
    expect(result.registrationPrUrl).toBe('https://github.com/shaunnez/goose-hub/pull/4242');
    expect(result.slug).toBe('widgets');
    expect(result.auditAction).toBe('create');
    expect(result.labelCounts).toEqual({ created: 5, updated: 2, skipped: 40 });

    // Step ordering — verify each upstream slice was invoked exactly once.
    expect(detectStack).toHaveBeenCalledOnce();
    expect(auditClaudeMd).toHaveBeenCalledOnce();
    expect(installLabels).toHaveBeenCalledOnce();

    // The PR was created with the expected title and against goose-hub.
    const prCreate = recorded.find(
      (r) =>
        r.method === 'POST' && r.url === 'https://api.github.com/repos/shaunnez/goose-hub/pulls',
    );
    expect(prCreate).toBeDefined();
    const prBody = prCreate?.body as { title: string; head: string; base: string; body: string };
    expect(prBody.title).toBe('Bootstrap: octo/widgets');
    expect(prBody.head).toBe('bootstrap/widgets');
    expect(prBody.base).toBe('main');
    expect(prBody.body).toContain('Stack summary');
    expect(prBody.body).toContain('node');
    expect(prBody.body).toContain('CLAUDE.md audit');
    expect(prBody.body).toContain('Label install report');
    expect(prBody.body).toContain('Webhook setup');
    // Counts surfaced.
    expect(prBody.body).toContain('created: 5');
    expect(prBody.body).toContain('updated: 2');
    expect(prBody.body).toContain('skipped: 40');

    // factory:bootstrap-pr label applied via /issues/<n>/labels.
    const labelApply = recorded.find(
      (r) =>
        r.method === 'POST' && /\/repos\/shaunnez\/goose-hub\/issues\/\d+\/labels$/.test(r.url),
    );
    expect(labelApply).toBeDefined();
    expect((labelApply?.body as { labels: string[] }).labels).toContain('factory:bootstrap-pr');

    // The scaffolded project.config.ts was pushed to the bootstrap branch.
    const configPut = recorded.find(
      (r) =>
        r.method === 'PUT' && r.url.includes('/contents/target-projects/widgets/project.config.ts'),
    );
    expect(configPut).toBeDefined();
    const putBody = configPut?.body as { branch: string; content: string; message: string };
    expect(putBody.branch).toBe('bootstrap/widgets');
    const decoded = Buffer.from(putBody.content, 'base64').toString('utf-8');
    expect(decoded).toContain('slug: "widgets"');
    expect(decoded).toContain("kind: 'github'");
    expect(decoded).toContain('repo: "octo/widgets"');
    expect(decoded).toContain("stateMachine: 'labels'");
    expect(decoded).toContain('"octo/widgets"');

    // repos.md was also pushed to the bootstrap branch.
    const reposPut = recorded.find(
      (r) => r.method === 'PUT' && r.url.includes('/contents/target-projects/widgets/repos.md'),
    );
    expect(reposPut).toBeDefined();
    const reposPutBody = reposPut?.body as { branch: string; content: string; message: string };
    expect(reposPutBody.branch).toBe('bootstrap/widgets');
    const reposDecoded = Buffer.from(reposPutBody.content, 'base64').toString('utf-8');
    expect(reposDecoded).toContain('octo/widgets');
    expect(reposDecoded).toContain('Repo Registry');
  });

  it('CLAUDE.md update path: diff is included in PR body', async () => {
    const { fetchImpl, recorded } = makeMockFetch({});
    const deps = makeDeps({
      fetchImpl,
      detectStack: happyDetectStack(),
      auditClaudeMd: happyAudit('update'),
      installLabels: happyInstallLabels(),
    });

    const result = await bootstrapProject(HAPPY_INPUT, deps);
    expect(result.auditAction).toBe('update');

    const prCreate = recorded.find(
      (r) =>
        r.method === 'POST' && r.url === 'https://api.github.com/repos/shaunnez/goose-hub/pulls',
    );
    const body = (prCreate?.body as { body: string }).body;
    expect(body).toContain('--- a/CLAUDE.md');
    expect(body).toContain('+++ b/CLAUDE.md');
    expect(body).toContain('```diff');
  });

  it('label install errors are surfaced in PR body', async () => {
    const { fetchImpl, recorded } = makeMockFetch({});
    const installLabels = vi.fn().mockResolvedValue({
      created: 1,
      updated: 0,
      skipped: 0,
      errors: [{ name: 'factory:triaging', message: '422 validation failed' }],
    });
    const deps = makeDeps({
      fetchImpl,
      detectStack: happyDetectStack(),
      auditClaudeMd: happyAudit('ok'),
      installLabels,
    });

    await bootstrapProject(HAPPY_INPUT, deps);

    const prCreate = recorded.find(
      (r) =>
        r.method === 'POST' && r.url === 'https://api.github.com/repos/shaunnez/goose-hub/pulls',
    );
    const body = (prCreate?.body as { body: string }).body;
    expect(body).toContain('errors: 1');
    expect(body).toContain('factory:triaging');
    expect(body).toContain('422 validation failed');
  });
});

// ---------------------------------------------------------------------------
// bootstrapProject — idempotency
// ---------------------------------------------------------------------------

describe('bootstrapProject — idempotency', () => {
  it('returns idempotent-skip when an existing registration PR matches the head branch', async () => {
    const { fetchImpl, recorded } = makeMockFetch({
      existingPrs: [
        {
          number: 1234,
          state: 'open',
          html_url: 'https://github.com/shaunnez/goose-hub/pull/1234',
          ref: 'bootstrap/widgets',
        },
      ],
    });

    const detectStack = happyDetectStack();
    const auditClaudeMd = happyAudit();
    const installLabels = happyInstallLabels();
    const deps = makeDeps({ fetchImpl, detectStack, auditClaudeMd, installLabels });

    const result = await bootstrapProject(HAPPY_INPUT, deps);

    expect(result.status).toBe('idempotent-skip');
    expect(result.registrationPrUrl).toBe('https://github.com/shaunnez/goose-hub/pull/1234');
    expect(result.slug).toBe('widgets');

    // None of the upstream slices should have run.
    expect(detectStack).not.toHaveBeenCalled();
    expect(auditClaudeMd).not.toHaveBeenCalled();
    expect(installLabels).not.toHaveBeenCalled();

    // No PR creation, no contents PUT, no label apply — only the idempotency
    // GET should have been issued.
    const mutatingCalls = recorded.filter(
      (r) => r.method === 'POST' || r.method === 'PUT' || r.method === 'PATCH',
    );
    expect(mutatingCalls).toHaveLength(0);
  });

  it('idempotent-skip even when matching PR is closed/merged', async () => {
    const { fetchImpl } = makeMockFetch({
      existingPrs: [
        {
          number: 4,
          state: 'closed',
          html_url: 'https://github.com/shaunnez/goose-hub/pull/4',
          ref: 'bootstrap/widgets',
        },
      ],
    });
    const deps = makeDeps({
      fetchImpl,
      detectStack: happyDetectStack(),
      auditClaudeMd: happyAudit(),
      installLabels: happyInstallLabels(),
    });

    const result = await bootstrapProject(HAPPY_INPUT, deps);
    expect(result.status).toBe('idempotent-skip');
  });

  it('idempotent-skip ignores PRs whose head ref does not match the slug', async () => {
    const { fetchImpl } = makeMockFetch({
      // GitHub honours the `head=` query but our mock doesn't always — so include
      // a non-matching ref to verify the workflow still filters by exact match.
      existingPrs: [
        {
          number: 7,
          state: 'open',
          html_url: 'https://github.com/shaunnez/goose-hub/pull/7',
          ref: 'bootstrap/something-else',
        },
      ],
      openedPr: { number: 99, html_url: 'https://github.com/shaunnez/goose-hub/pull/99' },
    });
    const deps = makeDeps({
      fetchImpl,
      detectStack: happyDetectStack(),
      auditClaudeMd: happyAudit(),
      installLabels: happyInstallLabels(),
    });

    const result = await bootstrapProject(HAPPY_INPUT, deps);
    expect(result.status).toBe('created');
  });
});

// ---------------------------------------------------------------------------
// bootstrapProject — recover from a stale branch (P1 review)
// ---------------------------------------------------------------------------

describe('bootstrapProject — recovers when bootstrap branch already exists', () => {
  it('treats 422 "Reference already exists" as a no-op and proceeds to open the PR', async () => {
    // Simulates a previous run that created refs/heads/bootstrap/widgets but
    // crashed before opening the PR.
    const { fetchImpl, recorded } = makeMockFetch({
      branchAlreadyExists: true,
      openedPr: { number: 8888, html_url: 'https://github.com/shaunnez/goose-hub/pull/8888' },
    });
    const deps = makeDeps({
      fetchImpl,
      detectStack: happyDetectStack(),
      auditClaudeMd: happyAudit(),
      installLabels: happyInstallLabels(),
    });

    const result = await bootstrapProject(HAPPY_INPUT, deps);

    expect(result.status).toBe('created');
    expect(result.registrationPrUrl).toBe('https://github.com/shaunnez/goose-hub/pull/8888');

    // The PR creation went through after the stale-ref no-op.
    const prCreate = recorded.find(
      (r) =>
        r.method === 'POST' && r.url === 'https://api.github.com/repos/shaunnez/goose-hub/pulls',
    );
    expect(prCreate).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// bootstrapProject — target repo's default branch is honoured (P2 review)
// ---------------------------------------------------------------------------

describe("bootstrapProject — scaffolded config uses the target repo's default branch", () => {
  it('writes defaultBranch=master when the target repo defaults to master', async () => {
    const { fetchImpl, recorded } = makeMockFetch({
      targetDefaultBranch: 'master',
    });
    const deps = makeDeps({
      fetchImpl,
      inspectGithubRepo: happyInspect('master'),
      installLabels: happyInstallLabels(),
    });

    await bootstrapProject(HAPPY_INPUT, deps);

    const configPut = recorded.find(
      (r) =>
        r.method === 'PUT' && r.url.includes('/contents/target-projects/widgets/project.config.ts'),
    );
    expect(configPut).toBeDefined();
    const decoded = Buffer.from(
      (configPut?.body as { content: string }).content,
      'base64',
    ).toString('utf-8');
    expect(decoded).toContain('defaultBranch: "master"');
    expect(decoded).not.toContain('defaultBranch: "main"');
  });
});

describe('bootstrapProject — generated config supports multiple repos safely', () => {
  it('keeps a supported GitHub source and derives local paths from owner/repo', async () => {
    const out = renderProjectConfig({
      slug: 'platform',
      repoRef: 'org-a/api',
      repos: [
        { repoRef: 'org-a/api', defaultBranch: 'main', description: '' },
        { repoRef: 'org-b/api', defaultBranch: 'main', description: '' },
      ],
      defaultBranch: 'main',
      cloneRoot: '/tmp/repos',
      stack: makeNodeStack({ test: 'pnpm test' }),
      detectedAt: '2026-05-07T00:00:00.000Z',
    });

    expect(out).toContain("kind: 'github'");
    expect(out).toContain('repo: "org-a/api"');
    expect(out).toContain("stateMachine: 'labels'");
    expect(out).toContain('localPath: "/tmp/repos/org-a/api"');
    expect(out).toContain('localPath: "/tmp/repos/org-b/api"');
  });
});

// ---------------------------------------------------------------------------
// bootstrapProject — input validation
// ---------------------------------------------------------------------------

describe('bootstrapProject — input validation', () => {
  it('rejects empty repoRef', async () => {
    const { fetchImpl } = makeMockFetch({});
    const deps = makeDeps({
      fetchImpl,
      detectStack: happyDetectStack(),
      auditClaudeMd: happyAudit(),
      installLabels: happyInstallLabels(),
    });

    await expect(bootstrapProject({ ...HAPPY_INPUT, repoRef: '' }, deps)).rejects.toThrow();
  });

  it('rejects malformed repoRef', async () => {
    const { fetchImpl } = makeMockFetch({});
    const deps = makeDeps({
      fetchImpl,
      detectStack: happyDetectStack(),
      auditClaudeMd: happyAudit(),
      installLabels: happyInstallLabels(),
    });

    await expect(bootstrapProject({ ...HAPPY_INPUT, repoRef: 'noslash' }, deps)).rejects.toThrow();
  });

  it('honours explicit slug override (sanitised)', async () => {
    const { fetchImpl, recorded } = makeMockFetch({});
    const deps = makeDeps({
      fetchImpl,
      detectStack: happyDetectStack(),
      auditClaudeMd: happyAudit(),
      installLabels: happyInstallLabels(),
    });

    const result = await bootstrapProject({ ...HAPPY_INPUT, slug: 'My Custom Slug!' }, deps);
    expect(result.slug).toBe('my-custom-slug');
    const prCreate = recorded.find(
      (r) =>
        r.method === 'POST' && r.url === 'https://api.github.com/repos/shaunnez/goose-hub/pulls',
    );
    expect((prCreate?.body as { head: string }).head).toBe('bootstrap/my-custom-slug');
  });
});
