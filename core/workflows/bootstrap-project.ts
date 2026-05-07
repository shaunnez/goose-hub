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
  type InstallResult,
  installLabels as defaultInstallLabels,
} from '../bootstrap/label-installer.js';
import { type StackInfo, detectStack as defaultDetectStack } from '../bootstrap/stack-detector.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BootstrapInput {
  /** "owner/repo" of the target project to bootstrap. */
  repoRef: string;
  /** GitHub token with repo write access on both target repo + shaunnez/goose-hub. */
  token: string;
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

/** The repository where registration PRs are opened. */
const REGISTRATION_REPO = 'shaunnez/goose-hub';

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

interface GhPullRefSummary {
  number: number;
  state: string;
  html_url: string;
  head?: { ref?: string };
}

/**
 * List PRs in shaunnez/goose-hub whose head ref equals `bootstrap/<slug>`.
 * GitHub's `head` filter requires the form `<owner>:<branch>`.
 */
async function findExistingRegistrationPrs(
  slug: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<GhPullRefSummary[]> {
  const branch = `bootstrap/${slug}`;
  // Owner of the registration repo; we filter on this owner's branches.
  const [registrationOwner] = REGISTRATION_REPO.split('/');
  const url = `https://api.github.com/repos/${REGISTRATION_REPO}/pulls?head=${encodeURIComponent(`${registrationOwner}:${branch}`)}&state=all&per_page=100`;
  const res = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'goose-hub-bootstrap',
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to list registration PRs: ${res.status} ${res.statusText}`);
  }
  const all = (await res.json()) as GhPullRefSummary[];
  // Defensive: GitHub honours the head filter, but verify ref equality anyway.
  return all.filter((p) => p.head?.ref === branch);
}

/** Render a one-line summary of detected stack info for the PR body. */
export function summariseStack(stack: StackInfo): string {
  switch (stack.type) {
    case 'node': {
      const scripts = Object.entries(stack.scripts)
        .filter(([, v]) => Boolean(v))
        .map(([k]) => k)
        .join(', ');
      return `node (${stack.packageManager})${scripts ? ` — scripts: ${scripts}` : ''}`;
    }
    case 'python':
      return `python (test: ${stack.testRunner}${stack.lintTool ? `, lint: ${stack.lintTool}` : ''})`;
    case 'go':
      return `go (module: ${stack.moduleName || 'unknown'})`;
    case 'rust':
      return `rust (crate: ${stack.crateName || 'unknown'})`;
    case 'ruby':
      return `ruby (test: ${stack.testRunner})`;
    case 'unknown':
      return 'unknown — no stack manifest detected';
  }
}

/**
 * Generate `target-projects/<slug>/project.config.ts` content with the
 * detected stack baked in. Budgets/personas are intentionally minimal — the
 * human is expected to edit before merging the bootstrap PR.
 */
export function renderProjectConfig(input: {
  slug: string;
  repoRef: string;
  defaultBranch: string;
  cloneRoot: string;
  stack: StackInfo;
  detectedAt: string;
}): string {
  const { slug, repoRef, defaultBranch, cloneRoot, stack, detectedAt } = input;
  const stackBlock = renderStackBlock(stack, detectedAt);
  const cloneUrl = `git@github.com:${repoRef}.git`;
  const localPath = nodePath.posix.join(cloneRoot.replace(/\\/g, '/'), slug);

  return `import type { ProjectConfig } from '../../core/types.js';

const config: ProjectConfig = {
  id: '${slug}',
  name: '${slug}',
  slug: '${slug}',
  source: {
    kind: 'github',
    repo: '${repoRef}',
    stateMachine: 'labels',
  },
  targetRepo: {
    cloneUrl: '${cloneUrl}',
    defaultBranch: '${defaultBranch}',
    localPath: '${localPath}',
  },
  stack: ${stackBlock},
  mode: 'supervised',
  storage: { kind: 'local', path: '~/.factory/data/${slug}' },
  repos: ['${repoRef}'],
  agentConfig: {
    runtime: 'claude-cli',
    rolesModels: {
      triager: { primary: 'haiku', fallback: 'haiku', advisor: null },
      griller: { primary: 'sonnet', fallback: 'haiku', advisor: null },
      'prd-writer': { primary: 'sonnet', fallback: 'haiku', advisor: null },
      decomposer: { primary: 'sonnet', fallback: 'haiku', advisor: null },
      investigator: { primary: 'sonnet', fallback: 'haiku', advisor: null },
      developer: { primary: 'haiku', fallback: 'sonnet', advisor: null },
      qa: { primary: 'sonnet', fallback: null, advisor: null },
      reviewer: { primary: 'sonnet', fallback: null, advisor: null },
      retrospector: { primary: 'sonnet', fallback: 'haiku', advisor: null },
      researcher: { primary: 'sonnet', fallback: 'haiku', advisor: null },
    },
    fallbackPolicy: {
      critical: 'same-tier-only',
      high: 'same-tier-only',
      medium: 'allow-down-tier',
      low: 'allow-down-tier',
    },
    toolAllowlists: {
      triager: { bundles: ['core'] },
      griller: { bundles: ['core'] },
      'prd-writer': { bundles: ['read', 'core'] },
      decomposer: { bundles: ['read', 'core'] },
      investigator: { bundles: ['read', 'core'] },
      developer: { bundles: ['read', 'write', 'shell'] },
      qa: { bundles: ['read', 'shell', 'validate'] },
      reviewer: { bundles: ['read', 'validate'] },
      retrospector: { bundles: ['core'] },
      researcher: { bundles: ['web'] },
    },
    advisorMode: {
      enabled: false,
      triggerOn: { priorities: [] },
      maxAdvisorBudgetUsd: 0,
      disableInAutonomous: true,
    },
    retrospectivePolicy: {
      defaultTier: 'light',
      deepTriggers: [],
    },
  },
  budgets: {
    dailyTokens: 0,
    maxParallelAgents: 0,
    maxRetries: 0,
    maxIssuesPerDayFromNonOwners: 0,
    maxBashSeconds: 0,
    perWorkflowMaxUsd: 0,
    perAgentMaxUsd: 0,
    perAdvisorMaxUsd: 0,
  },
  governance: {
    immutablePaths: [
      'MISSION.md',
      'FACTORY_RULES.md',
      'CLAUDE.md',
      'target-projects/**/MISSION.md',
      'target-projects/**/FACTORY_RULES.md',
      'target-projects/**/project.config.ts',
      'target-projects/**/personas/**',
    ],
  },
  isolation: { mode: 'native' },
  archiveAfterDays: 7,
  visibility: 'always_visible',
  colorStripe: '#6366f1',
};

export default config;
`;
}

function renderStackBlock(stack: StackInfo, detectedAt: string): string {
  const ts = JSON.stringify(detectedAt);
  switch (stack.type) {
    case 'node': {
      const s = stack.scripts;
      const lines: string[] = [
        `    runtime: 'node',`,
        `    packageManager: ${JSON.stringify(stack.packageManager)},`,
      ];
      if (s.build) lines.push(`    buildCommand: ${JSON.stringify(s.build)},`);
      lines.push(`    testCommand: ${JSON.stringify(s.test ?? 'pnpm test')},`);
      if (s.lint) lines.push(`    lintCommand: ${JSON.stringify(s.lint)},`);
      if (s.typecheck) lines.push(`    typecheckCommand: ${JSON.stringify(s.typecheck)},`);
      if (s.e2e) lines.push(`    e2eCommand: ${JSON.stringify(s.e2e)},`);
      lines.push(`    detectedAt: ${ts},`);
      return `{\n${lines.join('\n')}\n  }`;
    }
    case 'python': {
      const testCommand = stack.testRunner === 'pytest' ? 'pytest' : 'python -m unittest';
      const lines = [
        `    runtime: 'python',`,
        `    packageManager: 'pip',`,
        `    testCommand: ${JSON.stringify(testCommand)},`,
      ];
      if (stack.lintTool) lines.push(`    lintCommand: ${JSON.stringify(stack.lintTool)},`);
      lines.push(`    detectedAt: ${ts},`);
      return `{\n${lines.join('\n')}\n  }`;
    }
    case 'go': {
      const lines = [
        `    runtime: 'go',`,
        `    packageManager: 'go-modules',`,
        `    buildCommand: ${JSON.stringify(stack.buildCommand)},`,
        `    testCommand: ${JSON.stringify(stack.testCommand)},`,
        `    detectedAt: ${ts},`,
      ];
      return `{\n${lines.join('\n')}\n  }`;
    }
    case 'rust': {
      const lines = [
        `    runtime: 'rust',`,
        `    packageManager: 'cargo',`,
        `    buildCommand: ${JSON.stringify(stack.buildCommand)},`,
        `    testCommand: ${JSON.stringify(stack.testCommand)},`,
        `    detectedAt: ${ts},`,
      ];
      return `{\n${lines.join('\n')}\n  }`;
    }
    case 'ruby': {
      const testCommand = stack.testRunner === 'rspec' ? 'rspec' : 'rake test';
      const lines = [
        `    runtime: 'ruby',`,
        `    packageManager: 'bundler',`,
        `    testCommand: ${JSON.stringify(testCommand)},`,
        `    detectedAt: ${ts},`,
      ];
      return `{\n${lines.join('\n')}\n  }`;
    }
    case 'unknown':
      return `{
    runtime: 'unknown',
    packageManager: 'unknown',
    testCommand: 'echo "TODO: configure testCommand"',
    detectedAt: ${ts},
  }`;
  }
}

// ---------------------------------------------------------------------------
// PR body rendering
// ---------------------------------------------------------------------------

interface PrBodyInput {
  repoRef: string;
  slug: string;
  stack: StackInfo;
  audit: AuditResult;
  labels: InstallResult;
}

export function renderPrBody(input: PrBodyInput): string {
  const { repoRef, slug, stack, audit, labels } = input;
  const stackSummary = summariseStack(stack);

  const claudeBlock = renderClaudeBlock(audit);
  const errorTail =
    labels.errors.length > 0
      ? `\n${labels.errors.map((e) => `  - ${e.name}: ${e.message}`).join('\n')}`
      : '';
  const labelBlock = `- created: ${labels.created}\n- updated: ${labels.updated}\n- skipped: ${labels.skipped}\n- errors: ${labels.errors.length}${errorTail}`;

  return `# Bootstrap registration: ${repoRef}

This PR registers \`${repoRef}\` as a Factory-managed project under slug \`${slug}\`.

## Stack summary

${stackSummary}

## CLAUDE.md audit

${claudeBlock}

## Label install report

${labelBlock}

## Webhook setup

After this PR merges, configure a GitHub webhook on \`${repoRef}\` so factory ticks
react to label changes:

1. Go to \`https://github.com/${repoRef}/settings/hooks/new\`.
2. **Payload URL**: \`https://<your-goose-hub-host>/webhook/github\`
3. **Content type**: \`application/json\`
4. **Secret**: the value of \`GITHUB_WEBHOOK_SECRET\` from your goose-hub server env.
5. **Events**: select *Issues*, *Pull requests*, and *Issue comments*.
6. **Active**: yes.

After saving, send a test ping and confirm the goose-hub server logs an
\`ingest.event-received\` event for the project slug \`${slug}\`.
`;
}

function renderClaudeBlock(audit: AuditResult): string {
  switch (audit.action) {
    case 'create':
      return [
        '**Action**: create — no CLAUDE.md exists in target repo.',
        '',
        '**Preview** (first 40 lines):',
        '',
        '```markdown',
        audit.content.split('\n').slice(0, 40).join('\n'),
        '```',
      ].join('\n');
    case 'update':
      return [
        '**Action**: update — existing CLAUDE.md is missing required sections.',
        '',
        '**Diff**:',
        '',
        '```diff',
        audit.content,
        '```',
      ].join('\n');
    case 'ok':
      return '**Action**: ok — CLAUDE.md already contains all required sections; no changes proposed.';
  }
}

// ---------------------------------------------------------------------------
// GitHub Contents API helpers (used to push files onto a fresh branch)
// ---------------------------------------------------------------------------

interface GhJson {
  [key: string]: unknown;
}

async function ghJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit & { token: string },
): Promise<GhJson> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${init.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'goose-hub-bootstrap',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetchImpl(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${init.method ?? 'GET'} ${url} → ${res.status}: ${text}`);
  }
  return (await res.json()) as GhJson;
}

interface CreateBranchInput {
  fetchImpl: typeof fetch;
  token: string;
  baseSha: string;
  branchName: string;
}

async function getDefaultBranchSha(
  fetchImpl: typeof fetch,
  token: string,
): Promise<{ defaultBranch: string; sha: string }> {
  const repoMeta = await ghJson(fetchImpl, `https://api.github.com/repos/${REGISTRATION_REPO}`, {
    method: 'GET',
    token,
  });
  const defaultBranch = String(repoMeta.default_branch ?? 'main');
  const refMeta = await ghJson(
    fetchImpl,
    `https://api.github.com/repos/${REGISTRATION_REPO}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
    { method: 'GET', token },
  );
  const sha = String((refMeta.object as GhJson | undefined)?.sha ?? '');
  if (!sha) throw new Error(`could not resolve default branch sha for ${REGISTRATION_REPO}`);
  return { defaultBranch, sha };
}

async function createBranch(input: CreateBranchInput): Promise<void> {
  try {
    await ghJson(input.fetchImpl, `https://api.github.com/repos/${REGISTRATION_REPO}/git/refs`, {
      method: 'POST',
      token: input.token,
      body: JSON.stringify({ ref: `refs/heads/${input.branchName}`, sha: input.baseSha }),
    });
  } catch (err) {
    // GitHub returns 422 "Reference already exists" if a previous run created
    // the branch but errored before opening the PR. Treat that as a no-op so
    // the workflow can self-recover. Any other error must propagate.
    const msg = err instanceof Error ? err.message : String(err);
    if (/422/.test(msg) && /already exists/i.test(msg)) {
      return;
    }
    throw err;
  }
}

async function getRepoInfo(
  fetchImpl: typeof fetch,
  token: string,
  repoRef: string,
): Promise<{ defaultBranch: string; description: string }> {
  const meta = await ghJson(fetchImpl, `https://api.github.com/repos/${repoRef}`, {
    method: 'GET',
    token,
  });
  return {
    defaultBranch: String(meta.default_branch ?? 'main'),
    description: String(meta.description ?? ''),
  };
}

export function renderReposMd(slug: string, repoRef: string, description: string): string {
  const desc = description.trim() || `${repoRef} managed by Factory.`;
  return `# Repo Registry — ${slug}\n\n### [${repoRef}](https://github.com/${repoRef})\n**Description:** ${desc}\n`;
}

async function putFileOnBranch(input: {
  fetchImpl: typeof fetch;
  token: string;
  branch: string;
  path: string;
  content: string;
  message: string;
}): Promise<void> {
  const url = `https://api.github.com/repos/${REGISTRATION_REPO}/contents/${input.path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
  // Encode without relying on Buffer typings (works in Node 18+).
  const encoded = Buffer.from(input.content, 'utf-8').toString('base64');
  await ghJson(input.fetchImpl, url, {
    method: 'PUT',
    token: input.token,
    body: JSON.stringify({ message: input.message, content: encoded, branch: input.branch }),
  });
}

interface OpenedPr {
  number: number;
  html_url: string;
}

async function openPullRequest(input: {
  fetchImpl: typeof fetch;
  token: string;
  branch: string;
  base: string;
  title: string;
  body: string;
}): Promise<OpenedPr> {
  const data = await ghJson(
    input.fetchImpl,
    `https://api.github.com/repos/${REGISTRATION_REPO}/pulls`,
    {
      method: 'POST',
      token: input.token,
      body: JSON.stringify({
        title: input.title,
        head: input.branch,
        base: input.base,
        body: input.body,
        draft: false,
      }),
    },
  );
  return { number: Number(data.number), html_url: String(data.html_url) };
}

async function applyLabels(input: {
  fetchImpl: typeof fetch;
  token: string;
  issueNumber: number;
  labels: string[];
}): Promise<void> {
  await ghJson(
    input.fetchImpl,
    `https://api.github.com/repos/${REGISTRATION_REPO}/issues/${input.issueNumber}/labels`,
    {
      method: 'POST',
      token: input.token,
      body: JSON.stringify({ labels: input.labels }),
    },
  );
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
  const fetchImpl = deps.fetch ?? fetch;
  const writeFileImpl = deps.writeFile ?? nodeFs.writeFile;
  const mkdirImpl = deps.mkdir ?? nodeFs.mkdir;
  const log = deps.log ?? ((msg: string) => console.log(msg));

  const { owner, repo } = parseRepoRef(input.repoRef);
  const slug = sanitiseSlug(input.slug ?? repo);
  const repoPath = nodePath.join(input.cloneRoot, repo);

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

  // ── Step 1: detect stack ─────────────────────────────────────────────
  const stack = await detectStack(repoPath);
  const stackSummary = summariseStack(stack);

  // ── Step 2: audit CLAUDE.md ──────────────────────────────────────────
  const audit = await auditClaudeMd(repoPath, {
    type: stack.type,
    commands: stack.type === 'node' ? stack.scripts : undefined,
  });

  // ── Step 3: install labels on the *target* repo ──────────────────────
  const labels = await installLabels(input.repoRef, input.token, fetchImpl);

  // ── Step 4: scaffold target-projects/<slug>/project.config.ts ────────
  // Fetch the *target* repo's default branch and description in one round-trip.
  const { defaultBranch: targetDefaultBranch, description: targetDescription } = await getRepoInfo(
    fetchImpl,
    input.token,
    input.repoRef,
  );
  const detectedAt = new Date().toISOString();
  const configContent = renderProjectConfig({
    slug,
    repoRef: input.repoRef,
    defaultBranch: targetDefaultBranch,
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

  const reposMdContent = renderReposMd(slug, input.repoRef, targetDescription);
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

  const prBody = renderPrBody({ repoRef: input.repoRef, slug, stack, audit, labels });
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
