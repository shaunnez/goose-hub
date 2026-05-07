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
import { auditClaudeMd } from '@goose-hub/core/bootstrap/claude-md-auditor.js';
import { FACTORY_LABELS } from '@goose-hub/core/bootstrap/labels.js';
import { detectStack } from '@goose-hub/core/bootstrap/stack-detector.js';
import { logger } from '@goose-hub/core/logger.js';
import {
  type BootstrapResult,
  bootstrapProject,
  parseRepoRef,
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
  defaultBranch: string;
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

const MOCK_FIXTURE_PREVIEW: BootstrapPreviewDto = {
  slug: 'mock-repo',
  defaultBranch: 'main',
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

/**
 * Preview the stack + CLAUDE.md audit + canonical label set for `repoRef`
 * without making any GitHub mutations.
 *
 * Note: this calls `detectStack` and `auditClaudeMd` against a *local*
 * checkout of the target repo at `<cloneRoot>/<repo>`. The wizard's UX
 * assumes the human has already cloned the repo to the standard location;
 * if the path doesn't exist the detectors fall back to `unknown`/`create`
 * which is still safe (the human can edit the scaffold before merging the
 * registration PR).
 */
export async function previewBootstrapService(
  repoRef: string,
): Promise<Result<BootstrapPreviewDto>> {
  if (typeof repoRef !== 'string' || repoRef.trim().length === 0) {
    return { ok: false, error: 'repoRef is required', status: 400 };
  }

  if (isMockMode()) {
    return {
      ok: true,
      data: { ...MOCK_FIXTURE_PREVIEW, slug: deriveSlugForRepo(repoRef) },
    };
  }

  let parsed: { owner: string; repo: string };
  try {
    parsed = parseRepoRef(repoRef);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : `invalid repoRef: ${repoRef}`,
      status: 400,
    };
  }

  let slug: string;
  try {
    slug = sanitiseSlug(parsed.repo);
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

  // Validate accessibility via GET /repos/:owner/:repo. We use this to
  // populate `defaultBranch` in the response (and to surface 404 early).
  let defaultBranch = 'main';
  try {
    const res = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'goose-hub-bootstrap-preview',
      },
    });
    if (res.status === 404) {
      return { ok: false, error: `repo not found: ${repoRef}`, status: 404 };
    }
    if (!res.ok) {
      return {
        ok: false,
        error: `failed to access ${repoRef}: ${res.status} ${res.statusText}`,
        status: 502,
      };
    }
    const meta = (await res.json()) as { default_branch?: string };
    if (meta.default_branch) defaultBranch = meta.default_branch;
  } catch (err) {
    logger.warn('bootstrap preview: repo accessibility check failed', {
      repoRef,
      error: String(err),
    });
    return {
      ok: false,
      error: `failed to reach github for ${repoRef}: ${String(err)}`,
      status: 502,
    };
  }

  const repoPath = nodePath.join(getCloneRoot(), parsed.repo);

  let stack: Awaited<ReturnType<typeof detectStack>>;
  try {
    stack = await detectStack(repoPath);
  } catch (err) {
    logger.warn('bootstrap preview: stack detection failed', { repoRef, error: String(err) });
    return {
      ok: false,
      error: `stack detection failed for ${repoRef}: ${String(err)}`,
      status: 500,
    };
  }

  let audit: Awaited<ReturnType<typeof auditClaudeMd>>;
  try {
    audit = await auditClaudeMd(repoPath, {
      type: stack.type,
      commands: stack.type === 'node' ? stack.scripts : undefined,
    });
  } catch (err) {
    logger.warn('bootstrap preview: audit failed', { repoRef, error: String(err) });
    return {
      ok: false,
      error: `CLAUDE.md audit failed for ${repoRef}: ${String(err)}`,
      status: 500,
    };
  }

  const dto: BootstrapPreviewDto = {
    slug,
    defaultBranch,
    stack: {
      type: stack.type,
      summary: summariseStack(stack),
      raw: stack,
    },
    audit: { action: audit.action, content: audit.content, rationale: audit.rationale },
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
  repoRef: string,
  slugOverride?: string,
): Promise<Result<BootstrapRunDto>> {
  if (typeof repoRef !== 'string' || repoRef.trim().length === 0) {
    return { ok: false, error: 'repoRef is required', status: 400 };
  }

  if (isMockMode()) {
    const slug = slugOverride ?? deriveSlugForRepo(repoRef);
    return { ok: true, data: { ...MOCK_FIXTURE_RUN, slug } };
  }

  try {
    parseRepoRef(repoRef);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : `invalid repoRef: ${repoRef}`,
      status: 400,
    };
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
      repoRef,
      token,
      slug: slugOverride,
      cloneRoot: getCloneRoot(),
    });
  } catch (err) {
    logger.error('bootstrap workflow failed', { repoRef, error: String(err) });
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

/** Derive a slug from a `repoRef` using the same sanitisation as the workflow. */
function deriveSlugForRepo(repoRef: string): string {
  try {
    const { repo } = parseRepoRef(repoRef);
    return sanitiseSlug(repo);
  } catch {
    return 'unknown';
  }
}
