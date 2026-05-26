/**
 * Bootstrap domain service — wraps the `bootstrapProject` workflow for the
 * web UI's bootstrap wizard (M12.07, issue #308).
 *
 * Two service functions:
 *  - `previewBootstrapService(repoRef)` — runs stack detection + CLAUDE.md
 *    audit + label preview (no GitHub mutations, no PR creation). Used by
 *    wizard steps 2–4 to populate the "review" panels before the human
 *    confirms.
 *  - `runBootstrapService(repoRef, slug?)` — runs the full
 *    `bootstrapProject` workflow (which creates labels and opens the
 *    registration PR). Used by the wizard's final "Open Registration PR"
 *    button.
 *
 * The token never flows from the browser; it's read from
 * `process.env.GITHUB_TOKEN` here. If `MOCK_BOOTSTRAP=true` is set, both
 * functions return deterministic fixture payloads so the web e2e test can
 * walk through the wizard without hitting GitHub or running the workflow.
 */

import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import type { AuditResult } from '@goose-hub/core/bootstrap/claude-md-auditor.js';
import {
  inspectGithubRepo,
  type InspectedGithubRepo,
} from '@goose-hub/core/bootstrap/github-repo-inspector.js';
import { FACTORY_LABELS } from '@goose-hub/core/bootstrap/labels.js';
import { logger } from '@goose-hub/core/logger.js';
import {
  type BootstrapResult,
  bootstrapProject,
  normalizeRepoRefs,
  sanitiseSlug,
  summariseStack,
} from '@goose-hub/core/workflows/bootstrap-project.js';
import type { Result } from '#shared/middleware.js';

export interface PreviewLabelDto {
  name: string;
  color: string;
  description: string;
}

export interface BootstrapPreviewDto {
  slug: string;
  name: string;
  defaultBranch: string;
  repos: Array<{
    repoRef: string;
    defaultBranch: string;
    description: string;
    stackSummary: string;
    auditAction: AuditResult['action'];
    auditPath: string | null;
  }>;
  stack: {
    type: string;
    summary: string;
    raw: unknown;
  };
  audit: {
    action: 'create' | 'update' | 'ok';
    content: string;
    rationale: string;
  };
  labelsToInstall: PreviewLabelDto[];
}

export interface BootstrapRunDto {
  status: 'created' | 'idempotent-skip';
  registrationPrUrl: string | null;
  slug: string;
  stackSummary: string;
  auditAction: 'create' | 'update' | 'ok';
  labelCounts?: { created: number; updated: number; skipped: number };
}

export interface BootstrapRequestDto {
  repoRef?: string;
  repoRefs?: string[];
  slug?: string;
  name?: string;
}

const MOCK_FIXTURE_PREVIEW: BootstrapPreviewDto = {
  slug: 'mock-repo',
  name: 'mock-repo',
  defaultBranch: 'main',
  repos: [
    {
      repoRef: 'octo/mock-repo',
      defaultBranch: 'main',
      description: 'Mock repo',
      stackSummary: 'node (pnpm) — scripts: build, test, lint',
      auditAction: 'create',
      auditPath: 'CLAUDE.md',
    },
  ],
  stack: {
    type: 'node',
    summary: 'node (pnpm) — scripts: build, test, lint',
    raw: {
      type: 'node',
      packageManager: 'pnpm',
      scripts: { build: 'pnpm build', test: 'pnpm test', lint: 'pnpm lint' },
    },
  },
  audit: {
    action: 'create',
    content: '# CLAUDE.md\n\n## What this repo is\n\nMock repo (fixture).\n',
    rationale: 'No CLAUDE.md found in the target repo; a template will be created.',
  },
  labelsToInstall: FACTORY_LABELS.map((l) => ({
    name: l.name,
    color: l.color,
    description: l.description,
  })),
};

const MOCK_FIXTURE_RUN: BootstrapRunDto = {
  status: 'created',
  registrationPrUrl: 'https://github.com/shaunnez/goose-hub/pull/9999',
  slug: 'mock-repo',
  stackSummary: 'node (pnpm) — scripts: build, test, lint',
  auditAction: 'create',
  labelCounts: { created: 28, updated: 0, skipped: 0 },
};

/** Resolve the GitHub token from env. Returns `null` if absent. */
function getGithubToken(): string | null {
  const raw = process.env.GITHUB_TOKEN ?? '';
  return raw.length > 0 ? raw : null;
}

function isMockMode(): boolean {
  return process.env.MOCK_BOOTSTRAP === 'true';
}

function getCloneRoot(): string {
  return process.env.BOOTSTRAP_CLONE_ROOT ?? nodePath.join(nodeOs.tmpdir(), 'goose-hub-bootstrap');
}

export async function previewBootstrapService(
  input: string | BootstrapRequestDto,
): Promise<Result<BootstrapPreviewDto>> {
  const request = normalizeBootstrapRequest(input);
  let repoRefs: string[];
  try {
    repoRefs = normalizeRepoRefs(request);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'invalid repository input',
      status: 400,
    };
  }

  if (isMockMode()) {
    const slug = deriveSlugForRequest(request, repoRefs);
    return {
      ok: true,
      data: {
        ...MOCK_FIXTURE_PREVIEW,
        slug,
        name: request.name?.trim() || slug,
        repos: repoRefs.map((repoRef) => ({ ...MOCK_FIXTURE_PREVIEW.repos[0], repoRef })),
      },
    };
  }

  let slug: string;
  try {
    slug = deriveSlugForRequest(request, repoRefs);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'failed to derive slug',
      status: 400,
    };
  }

  const token = getGithubToken();
  if (token == null) {
    return {
      ok: false,
      error: 'server is missing GITHUB_TOKEN; cannot validate repo accessibility',
      status: 500,
    };
  }

  let inspected: InspectedGithubRepo[];
  try {
    inspected = await Promise.all(
      repoRefs.map((repoRef) => inspectGithubRepo({ fetchImpl: fetch, token, repoRef })),
    );
  } catch (err) {
    logger.warn('bootstrap preview: remote repo inspection failed', {
      repoRefs,
      error: String(err),
    });
    const status = /-> 404| 404[: ]/.test(String(err)) ? 404 : 502;
    return {
      ok: false,
      error:
        status === 404
          ? `repo not found: ${repoRefs.join(', ')}`
          : `failed to inspect github repos: ${String(err)}`,
      status,
    };
  }

  const primary = inspected[0];
  const dto: BootstrapPreviewDto = {
    slug,
    name: request.name?.trim() || slug,
    defaultBranch: primary.defaultBranch,
    repos: inspected.map((repoInfo) => ({
      repoRef: repoInfo.repoRef,
      defaultBranch: repoInfo.defaultBranch,
      description: repoInfo.description,
      stackSummary: summariseStack(repoInfo.stack),
      auditAction: repoInfo.audit.action,
      auditPath: repoInfo.audit.path ?? null,
    })),
    stack: {
      type: primary.stack.type,
      summary: summariseStack(primary.stack),
      raw: primary.stack,
    },
    audit: {
      action: primary.audit.action,
      content: primary.audit.content,
      rationale: primary.audit.rationale,
    },
    labelsToInstall: FACTORY_LABELS.map((l) => ({
      name: l.name,
      color: l.color,
      description: l.description,
    })),
  };

  return { ok: true, data: dto };
}

/**
 * Run the full bootstrap workflow end-to-end and return the registration PR
 * URL on success.
 */
export async function runBootstrapService(
  input: string | BootstrapRequestDto,
  slugOverride?: string,
): Promise<Result<BootstrapRunDto>> {
  const request = normalizeBootstrapRequest(input);
  if (slugOverride != null) request.slug = slugOverride;
  let repoRefs: string[];
  try {
    repoRefs = normalizeRepoRefs(request);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'invalid repository input',
      status: 400,
    };
  }

  if (isMockMode()) {
    const slug = deriveSlugForRequest(request, repoRefs);
    return { ok: true, data: { ...MOCK_FIXTURE_RUN, slug } };
  }

  // Validate the optional client-supplied slug up front so a bad value
  // (e.g. one that sanitises to empty) reports as 400 input error rather
  // than being swallowed by the catch-all 500 below.
  if (request.slug != null) {
    try {
      sanitiseSlug(request.slug);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : `invalid slug: ${request.slug}`,
        status: 400,
      };
    }
  }

  const token = getGithubToken();
  if (token == null) {
    return {
      ok: false,
      error: 'server is missing GITHUB_TOKEN; cannot run bootstrap workflow',
      status: 500,
    };
  }

  let result: BootstrapResult;
  try {
    result = await bootstrapProject({
      repoRef: request.repoRef,
      repoRefs,
      token,
      slug: request.slug,
      name: request.name,
      cloneRoot: getCloneRoot(),
    });
  } catch (err) {
    logger.error('bootstrap workflow failed', { repoRefs, error: String(err) });
    return { ok: false, error: String(err), status: 500 };
  }

  return {
    ok: true,
    data: {
      status: result.status,
      registrationPrUrl: result.registrationPrUrl ?? null,
      slug: result.slug,
      stackSummary: result.stackSummary,
      auditAction: result.auditAction,
      labelCounts: result.labelCounts,
    },
  };
}

function normalizeBootstrapRequest(input: string | BootstrapRequestDto): BootstrapRequestDto {
  return typeof input === 'string' ? { repoRef: input } : { ...input };
}

/** Derive a slug using the same sanitisation as the workflow. */
function deriveSlugForRequest(request: BootstrapRequestDto, repoRefs: string[]): string {
  try {
    if (request.slug != null) return sanitiseSlug(request.slug);
    const firstRepoName = repoRefs[0].split('/')[1] ?? repoRefs[0];
    return sanitiseSlug(firstRepoName);
  } catch {
    return 'unknown';
  }
}
