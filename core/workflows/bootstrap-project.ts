/**
 * bootstrap-project workflow — M12.04
 *
 * Orchestrates the four upstream bootstrap slices and opens a registration
 * pull request against shaunnez/goose-hub:
 *
 *   1. detect stack (`core/bootstrap/stack-detector.ts`)
 *   2. audit CLAUDE.md (`core/bootstrap/claude-md-auditor.ts`)
 *   3. install canonical labels on the target repo (`core/bootstrap/label-installer.ts`)
 *   4. scaffold `target-projects/<slug>/project.config.ts`
 *   5. push files to a fresh branch on shaunnez/goose-hub via the GitHub
 *      Contents API and open a PR labelled `factory:bootstrap-pr`
 *
 * Idempotency:
 *   Before any mutation we list pull requests on shaunnez/goose-hub whose head
 *   ref is `bootstrap/<slug>`. If any exists (open OR closed/merged) we log
 *   and exit with `status: 'idempotent-skip'` — no labels are installed, no
 *   files written, no PR opened.
 *
 * Mechanic note: the registration PR is created entirely via the GitHub
 * REST API (no local clone). We use the Contents API to commit the
 * scaffolded `project.config.ts` (and optional CLAUDE.md when the auditor
 * returns `action: 'create'`) onto a fresh branch we create off the default
 * branch SHA. This keeps the workflow runnable from any host without
 * requiring write access to a local checkout of goose-hub itself.
 */

import * as nodeFs from 'node:fs/promises';
import * as nodePath from 'node:path';
import {
  type AuditResult,
  auditClaudeMd as defaultAuditClaudeMd,
} from '../bootstrap/claude-md-auditor.js';
import {
  type InspectedGithubRepo,
  inspectGithubRepo as defaultInspectGithubRepo,
} from '../bootstrap/github-repo-inspector.js';
import {
  type InstallResult,
  installLabels as defaultInstallLabels,
} from '../bootstrap/label-installer.js';
import { type StackInfo, detectStack as defaultDetectStack } from '../bootstrap/stack-detector.js';
import {
  applyLabels,
  createBranch,
  findExistingRegistrationPrs,
  getDefaultBranchSha,
  openPullRequest,
  putFileOnBranch,
} from './bootstrap-github.js';
import {
  renderPrBody,
  renderProjectConfig,
  renderReposMd,
  summariseStack,
} from './bootstrap-renderers.js';

// Re-export renderer helpers so existing importers keep working.
export { renderPrBody, renderProjectConfig, renderReposMd, summariseStack };

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BootstrapInput {
  /** "owner/repo" of the target project to bootstrap. */
  repoRef?: string;
  /** One or more GitHub repositories to register under the target project. */
  repoRefs?: string[];
  /** GitHub token with repo write access on both target repo + shaunnez/goose-hub. */
  token: string;
  /** Human-facing project alias. Defaults to the slug. */
  name?: string;
  /** Optional override slug; defaults to a sanitised form of the repo name. */
  slug?: string;
  /** Local directory containing (or for cloning) the target repo. */
  cloneRoot: string;
}

export interface BootstrapResult {
  status: 'created' | 'idempotent-skip';
  registrationPrUrl?: string;
  slug: string;
  stackSummary: string;
  auditAction: AuditResult['action'];
  labelCounts?: { created: number; updated: number; skipped: number };
}

export interface BootstrapDeps {
  detectStack?: typeof defaultDetectStack;
  auditClaudeMd?: typeof defaultAuditClaudeMd;
  installLabels?: typeof defaultInstallLabels;
  inspectGithubRepo?: typeof defaultInspectGithubRepo;
  fetch?: typeof fetch;
  writeFile?: typeof nodeFs.writeFile;
  mkdir?: typeof nodeFs.mkdir;
  /** Optional logger; defaults to console.log. */
  log?: (message: string) => void;
}

export class BootstrapInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapInputError';
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Sanitise a repo name (or override) into a safe slug:
 * lowercase, replace non-alphanumeric-or-hyphen with `-`, collapse runs of
 * hyphens, and strip leading/trailing hyphens. Empty input → throws.
 */
export function sanitiseSlug(raw: string): string {
  const lowered = raw.toLowerCase().trim();
  if (lowered.length === 0) {
    throw new BootstrapInputError('slug cannot be empty');
  }
  const replaced = lowered.replace(/[^a-z0-9-]+/g, '-');
  const collapsed = replaced.replace(/-+/g, '-');
  const trimmed = collapsed.replace(/^-+|-+$/g, '');
  if (trimmed.length === 0) {
    throw new BootstrapInputError(`slug \`${raw}\` resolves to empty after sanitisation`);
  }
  return trimmed;
}

/** Parse "owner/repo" → throws BootstrapInputError on shape mismatch. */
export function parseRepoRef(ref: string): { owner: string; repo: string } {
  if (!ref || typeof ref !== 'string') {
    throw new BootstrapInputError('repoRef must be a non-empty string');
  }
  const parts = ref.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new BootstrapInputError(`repoRef must be "owner/repo", got: ${ref}`);
  }
  return { owner: parts[0], repo: parts[1] };
}

export function normalizeRepoRefs(input: Pick<BootstrapInput, 'repoRef' | 'repoRefs'>): string[] {
  const refs = input.repoRefs?.length
    ? input.repoRefs
    : input.repoRef != null
      ? [input.repoRef]
      : [];
  const normalized = refs.map((ref) => ref.trim()).filter(Boolean);
  if (normalized.length === 0) {
    throw new BootstrapInputError('at least one repoRef is required');
  }
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const ref of normalized) {
    parseRepoRef(ref);
    const key = ref.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(ref);
  }
  return deduped;
}

// ---------------------------------------------------------------------------
// Public workflow entry point
// ---------------------------------------------------------------------------

export async function bootstrapProject(
  input: BootstrapInput,
  deps: BootstrapDeps = {},
): Promise<BootstrapResult> {
  const detectStack = deps.detectStack ?? defaultDetectStack;
  const auditClaudeMd = deps.auditClaudeMd ?? defaultAuditClaudeMd;
  const installLabels = deps.installLabels ?? defaultInstallLabels;
  const inspectGithubRepo = deps.inspectGithubRepo ?? defaultInspectGithubRepo;
  const fetchImpl = deps.fetch ?? fetch;
  const writeFileImpl = deps.writeFile ?? nodeFs.writeFile;
  const mkdirImpl = deps.mkdir ?? nodeFs.mkdir;
  const log = deps.log ?? ((msg: string) => console.log(msg));

  const repoRefs = normalizeRepoRefs(input);
  const { owner, repo } = parseRepoRef(repoRefs[0]);
  const slug = sanitiseSlug(input.slug ?? repo);
  const name = input.name?.trim() || slug;

  // ── Idempotency check ────────────────────────────────────────────────
  const existing = await findExistingRegistrationPrs(slug, input.token, fetchImpl);
  if (existing.length > 0) {
    const url = existing[0].html_url;
    log(`bootstrap: registration PR already exists for slug=${slug} (${url}); skipping.`);
    return {
      status: 'idempotent-skip',
      registrationPrUrl: url,
      slug,
      stackSummary: '(skipped — existing PR)',
      auditAction: 'ok',
    };
  }

  // ── Step 1: inspect remote repos + detect stack ──────────────────────
  const inspectedRepos = await inspectRepos({
    repoRefs,
    fetchImpl,
    token: input.token,
    inspectGithubRepo,
    detectStack,
    auditClaudeMd,
    cloneRoot: input.cloneRoot,
    useLocalFallback:
      deps.inspectGithubRepo == null && (deps.detectStack != null || deps.auditClaudeMd != null),
  });
  const primary = inspectedRepos[0];
  const stack = primary.stack;
  const stackSummary = summariseStack(stack);

  // ── Step 2: audit agent instruction files ────────────────────────────
  const audit = primary.audit;

  // ── Step 3: install labels on linked GitHub repos for optional mirroring ─
  const labels = aggregateLabelResults(
    await Promise.all(repoRefs.map((repoRef) => installLabels(repoRef, input.token, fetchImpl))),
  );

  // ── Step 4: scaffold target-projects/<slug>/project.config.ts ────────
  const detectedAt = new Date().toISOString();
  const configContent = renderProjectConfig({
    slug,
    name,
    repoRef: repoRefs[0],
    repos: inspectedRepos.map((repoInfo) => ({
      repoRef: repoInfo.repoRef,
      defaultBranch: repoInfo.defaultBranch,
      description: repoInfo.description,
      cloneUrl: repoInfo.cloneUrl,
    })),
    defaultBranch: primary.defaultBranch,
    cloneRoot: input.cloneRoot,
    stack,
    detectedAt,
  });

  // Optionally write to disk so a local checkout sees the scaffold. We
  // tolerate failures (the canonical artefact lives on the bootstrap
  // branch we push to GitHub).
  const localTargetDir = nodePath.join(input.cloneRoot, '_bootstrap', 'target-projects', slug);
  try {
    await mkdirImpl(localTargetDir, { recursive: true });
    await writeFileImpl(nodePath.join(localTargetDir, 'project.config.ts'), configContent, 'utf-8');
  } catch (err) {
    log(`bootstrap: local scaffold write failed (${String(err)}); continuing with API push.`);
  }

  // ── Step 5: push files + open PR on shaunnez/goose-hub ───────────────
  const branchName = `bootstrap/${slug}`;
  const { defaultBranch, sha } = await getDefaultBranchSha(fetchImpl, input.token);
  await createBranch({
    fetchImpl,
    token: input.token,
    baseSha: sha,
    branchName,
  });

  await putFileOnBranch({
    fetchImpl,
    token: input.token,
    branch: branchName,
    path: `target-projects/${slug}/project.config.ts`,
    content: configContent,
    message: `bootstrap: scaffold target-projects/${slug}/project.config.ts`,
  });

  const reposMdContent = renderReposMd(
    slug,
    inspectedRepos.map((repoInfo) => ({
      repoRef: repoInfo.repoRef,
      defaultBranch: repoInfo.defaultBranch,
      description: repoInfo.description,
      cloneUrl: repoInfo.cloneUrl,
    })),
  );
  await putFileOnBranch({
    fetchImpl,
    token: input.token,
    branch: branchName,
    path: `target-projects/${slug}/repos.md`,
    content: reposMdContent,
    message: `bootstrap: scaffold target-projects/${slug}/repos.md`,
  });

  // CLAUDE.md is a *target-repo* concern, not a goose-hub concern. The
  // audit content is rendered into the PR body so the human can copy it
  // over to the target repo (or the workflow can be extended later to
  // PR it directly into the target). We do NOT add CLAUDE.md to the
  // goose-hub registration PR — that would be a governance violation.

  const prBody = renderPrBody({ repoRef: repoRefs[0], repoRefs, slug, name, stack, audit, labels });
  const opened = await openPullRequest({
    fetchImpl,
    token: input.token,
    branch: branchName,
    base: defaultBranch,
    title: `Bootstrap: ${owner}/${repo}`,
    body: prBody,
  });

  await applyLabels({
    fetchImpl,
    token: input.token,
    issueNumber: opened.number,
    labels: ['factory:bootstrap-pr'],
  });

  log(`bootstrap: opened registration PR ${opened.html_url} for slug=${slug}`);

  return {
    status: 'created',
    registrationPrUrl: opened.html_url,
    slug,
    stackSummary,
    auditAction: audit.action,
    labelCounts: { created: labels.created, updated: labels.updated, skipped: labels.skipped },
  };
}

async function inspectRepos(input: {
  repoRefs: string[];
  fetchImpl: typeof fetch;
  token: string;
  inspectGithubRepo: typeof defaultInspectGithubRepo;
  detectStack: typeof defaultDetectStack;
  auditClaudeMd: typeof defaultAuditClaudeMd;
  cloneRoot: string;
  useLocalFallback: boolean;
}): Promise<InspectedGithubRepo[]> {
  if (input.useLocalFallback) {
    const inspected: InspectedGithubRepo[] = [];
    for (const repoRef of input.repoRefs) {
      const { repo } = parseRepoRef(repoRef);
      const stack = await input.detectStack(nodePath.join(input.cloneRoot, repo));
      const audit = await input.auditClaudeMd(nodePath.join(input.cloneRoot, repo), {
        type: stack.type,
        commands: stack.type === 'node' ? stack.scripts : undefined,
      });
      inspected.push({
        repoRef,
        defaultBranch: 'main',
        description: '',
        cloneUrl: `git@github.com:${repoRef}.git`,
        stack,
        audit,
      });
    }
    return inspected;
  }

  const inspected: InspectedGithubRepo[] = [];
  for (const repoRef of input.repoRefs) {
    inspected.push(
      await input.inspectGithubRepo({
        fetchImpl: input.fetchImpl,
        token: input.token,
        repoRef,
      }),
    );
  }
  return inspected;
}

function aggregateLabelResults(results: InstallResult[]): InstallResult {
  return results.reduce<InstallResult>(
    (acc, result) => ({
      created: acc.created + result.created,
      updated: acc.updated + result.updated,
      skipped: acc.skipped + result.skipped,
      errors: [...acc.errors, ...result.errors],
    }),
    { created: 0, updated: 0, skipped: 0, errors: [] },
  );
}
