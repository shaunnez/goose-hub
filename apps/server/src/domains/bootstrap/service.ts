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

import { mkdir, stat, writeFile } from 'node:fs/promises';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import type { AuditResult } from '@goose-hub/core/bootstrap/claude-md-auditor.js';
import {
  type InspectedGithubRepo,
  inspectGithubRepo,
} from '@goose-hub/core/bootstrap/github-repo-inspector.js';
import { FACTORY_LABELS } from '@goose-hub/core/bootstrap/labels.js';
import { importGitHubIssuesToLocalDb } from '@goose-hub/core/integrations/github/import-issues.js';
import { logger } from '@goose-hub/core/logger.js';
import type {
  LocalDbSourceConfig,
  ProjectRepositoryConfig,
  TargetRepoConfig,
} from '@goose-hub/core/types.js';
import {
  type BootstrapResult,
  bootstrapProject,
  normalizeRepoRefs,
  sanitiseSlug,
  summariseStack,
} from '@goose-hub/core/workflows/bootstrap-project.js';
import { renderProjectConfig } from '@goose-hub/core/workflows/bootstrap-renderers.js';
import { targetProjectsRoot } from '@goose-hub/target-projects';
import type { Result } from '#shared/middleware.js';
import { getProject } from '#shared/projects.js';

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

export interface LocalDbActivationDto {
  slug: string;
  reposLinked: number;
  issuesImported: number;
  issuesUpdated: number;
  issuesSkipped: number;
  mirrorLabels: boolean;
}

export interface BootstrapRequestDto {
  repoRef?: string;
  repoRefs?: string[];
  slug?: string;
  name?: string;
}

export interface BitbucketWorkspaceGroupDto {
  workspace: string;
  repos: string[];
  defaultBranch?: string;
}

export type ProjectCreationSourceDto =
  | { kind: 'local-only' }
  | { kind: 'github-code'; repoRefs: string[]; defaultBranch?: string; localPath?: string }
  | {
      kind: 'jira';
      baseUrl: string;
      projectKeys: string[];
      importMode: 'manual' | 'assigned-to-me';
    }
  | {
      kind: 'bitbucket';
      workspace?: string;
      repos?: string[];
      workspaces?: BitbucketWorkspaceGroupDto[];
      defaultBranch?: string;
    }
  | {
      kind: 'advanced';
      github?: { repoRefs: string[]; defaultBranch?: string; localPath?: string };
      jira?: {
        baseUrl: string;
        projectKeys: string[];
        importMode: 'manual' | 'assigned-to-me';
      };
      bitbucket?: {
        workspace?: string;
        repos?: string[];
        workspaces?: BitbucketWorkspaceGroupDto[];
        defaultBranch?: string;
      };
    };

export interface LocalProjectCreationRequestDto {
  slug?: string;
  name?: string;
  source: ProjectCreationSourceDto;
}

export interface LocalProjectCreationPreviewDto {
  slug: string;
  name: string;
  configPath: string;
  config: string;
  requiredEnvVars: string[];
  repositories: ProjectRepositoryConfig[];
  integrations: Array<'github' | 'jira' | 'bitbucket'>;
}

export interface LocalProjectCreationRunDto extends LocalProjectCreationPreviewDto {
  status: 'created';
  writtenPath: string;
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

  if (isMockMode()) {
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

  let slug: string;
  try {
    slug = deriveSlugForRequest(request, repoRefs);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : `invalid slug: ${request.slug}`,
      status: 400,
    };
  }

  if (isMockMode()) {
    return { ok: true, data: { ...MOCK_FIXTURE_RUN, slug } };
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
      slug,
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

export async function previewLocalProjectCreationService(
  input: LocalProjectCreationRequestDto,
): Promise<Result<LocalProjectCreationPreviewDto>> {
  try {
    return { ok: true, data: buildLocalProjectCreationPreview(input) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'invalid project creation request',
      status: 400,
    };
  }
}

export async function createLocalProjectService(
  input: LocalProjectCreationRequestDto,
): Promise<Result<LocalProjectCreationRunDto>> {
  let preview: LocalProjectCreationPreviewDto;
  try {
    preview = buildLocalProjectCreationPreview(input);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'invalid project creation request',
      status: 400,
    };
  }

  if (isMockMode()) {
    return {
      ok: true,
      data: {
        ...preview,
        status: 'created',
        writtenPath: nodePath.join('/mock/target-projects', preview.slug, 'project.config.ts'),
      },
    };
  }

  const root = getTargetProjectsRoot();
  const dir = nodePath.join(root, preview.slug);
  const writtenPath = nodePath.join(dir, 'project.config.ts');
  try {
    await stat(writtenPath);
    return {
      ok: false,
      error: `project config already exists for slug "${preview.slug}"`,
      status: 409,
    };
  } catch {
    // Missing is expected for a new local project.
  }

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(writtenPath, preview.config, 'utf-8');
  } catch (err) {
    logger.error('local project creation failed to write config', {
      slug: preview.slug,
      error: String(err),
    });
    return { ok: false, error: String(err), status: 500 };
  }

  return { ok: true, data: { ...preview, status: 'created', writtenPath } };
}

export async function activateLocalDbProject(slug: string): Promise<Result<LocalDbActivationDto>> {
  const cfg = await getProject(slug);
  if (cfg == null) return { ok: false, error: 'project not found', status: 404 };
  if (cfg.source.kind !== 'local-db') {
    return { ok: false, error: 'project source is not local-db', status: 400 };
  }
  const token = getGithubToken() ?? undefined;
  const imported = await importGitHubIssuesToLocalDb({
    projectConfig: cfg,
    token,
  });
  return {
    ok: true,
    data: {
      slug,
      reposLinked: imported.repoRefs.length,
      issuesImported: imported.imported,
      issuesUpdated: imported.updated,
      issuesSkipped: imported.skipped,
      mirrorLabels: cfg.source.integrations?.github?.mirrorLabels === true,
    },
  };
}

function normalizeBootstrapRequest(input: string | BootstrapRequestDto): BootstrapRequestDto {
  return typeof input === 'string' ? { repoRef: input } : { ...input };
}

/** Derive a slug using the same sanitisation as the workflow. */
function deriveSlugForRequest(request: BootstrapRequestDto, repoRefs: string[]): string {
  if (request.slug != null) return sanitiseSlug(request.slug);
  const firstRepoName = repoRefs[0].split('/')[1] ?? repoRefs[0];
  return sanitiseSlug(firstRepoName);
}

function buildLocalProjectCreationPreview(
  input: LocalProjectCreationRequestDto,
): LocalProjectCreationPreviewDto {
  if (input == null || typeof input !== 'object') throw new Error('request body is required');
  const source = input.source;
  if (source == null || typeof source !== 'object') throw new Error('source is required');

  const slug = sanitiseSlug(input.slug ?? defaultSlugForCreationSource(source));
  const name = input.name?.trim() || slug;
  const normalized = normalizeProjectCreationSource(source, slug);
  const config = renderProjectConfig({
    slug,
    name,
    source: normalized.source,
    repositories: normalized.repositories,
    targetRepo: normalized.targetRepo,
    stack: {
      type: 'unknown',
    },
    detectedAt: new Date().toISOString(),
    activeMilestone: undefined,
  });

  return {
    slug,
    name,
    configPath: `target-projects/${slug}/project.config.ts`,
    config,
    requiredEnvVars: normalized.requiredEnvVars,
    repositories: normalized.repositories,
    integrations: normalized.integrations,
  };
}

function normalizeProjectCreationSource(
  source: ProjectCreationSourceDto,
  slug: string,
): {
  source: LocalDbSourceConfig;
  repositories: ProjectRepositoryConfig[];
  targetRepo: TargetRepoConfig;
  requiredEnvVars: string[];
  integrations: Array<'github' | 'jira' | 'bitbucket'>;
} {
  const integrations: NonNullable<LocalDbSourceConfig['integrations']> = {};
  const repositories: ProjectRepositoryConfig[] = [];
  const requiredEnvVars = new Set<string>();
  const enabledIntegrations: Array<'github' | 'jira' | 'bitbucket'> = [];

  const addGithub = (github: {
    repoRefs: string[];
    defaultBranch?: string;
    localPath?: string;
  }) => {
    const repoRefs = normalizeRepoRefs({ repoRefs: github.repoRefs });
    integrations.github = {
      repos: repoRefs,
      mirrorLabels: false,
      importIssues: false,
    };
    enabledIntegrations.push('github');
    for (const repoRef of repoRefs) {
      repositories.push(
        githubRepository(repoRef, github.defaultBranch ?? 'main', github.localPath),
      );
    }
  };

  const addJira = (jira: {
    baseUrl: string;
    projectKeys: string[];
    importMode: 'manual' | 'assigned-to-me';
  }) => {
    const baseUrl = requireNonEmpty(jira.baseUrl, 'jira.baseUrl');
    const projectKeys = normalizeStringList(jira.projectKeys, 'jira.projectKeys');
    integrations.jira = {
      enabled: true,
      baseUrl,
      projectKeys,
      importMode: jira.importMode,
      postBack: { comments: true, transitions: false },
    };
    requiredEnvVars.add('JIRA_EMAIL or ATLASSIAN_EMAIL');
    requiredEnvVars.add('JIRA_API_TOKEN or ATLASSIAN_API_TOKEN');
    enabledIntegrations.push('jira');
  };

  const addBitbucket = (bitbucket: {
    workspace?: string;
    repos?: string[];
    workspaces?: BitbucketWorkspaceGroupDto[];
    defaultBranch?: string;
  }) => {
    const workspaces = normalizeBitbucketWorkspaceGroups(bitbucket);
    integrations.bitbucket = {
      enabled: true,
      workspaces: workspaces.map(({ workspace, repos }) => ({ workspace, repos })),
      postBack: { pullRequests: true, comments: true },
    };
    requiredEnvVars.add('BITBUCKET_TOKEN or BITBUCKET_USERNAME + BITBUCKET_APP_PASSWORD');
    enabledIntegrations.push('bitbucket');
    for (const group of workspaces) {
      for (const repo of group.repos) {
        const repoRef = `${group.workspace}/${repo}`;
        repositories.push(
          bitbucketRepository(repoRef, group.defaultBranch ?? bitbucket.defaultBranch ?? 'main'),
        );
      }
    }
  };

  switch (source.kind) {
    case 'local-only':
      break;
    case 'github-code':
      addGithub(source);
      break;
    case 'jira':
      addJira(source);
      break;
    case 'bitbucket':
      addBitbucket(source);
      break;
    case 'advanced':
      if (source.github != null) addGithub(source.github);
      if (source.jira != null) addJira(source.jira);
      if (source.bitbucket != null) addBitbucket(source.bitbucket);
      break;
    default:
      throw new Error('unsupported project creation source');
  }

  const targetRepo = repositories[0] ?? {
    cloneUrl: '',
    defaultBranch: 'main',
    localPath: `~/code/${slug}`,
  };

  return {
    source: {
      kind: 'local-db',
      stateMachine: 'db',
      ...(Object.keys(integrations).length > 0 ? { integrations } : {}),
    },
    repositories,
    targetRepo,
    requiredEnvVars: [...requiredEnvVars],
    integrations: enabledIntegrations,
  };
}

function defaultSlugForCreationSource(source: ProjectCreationSourceDto): string {
  switch (source.kind) {
    case 'github-code': {
      const first = normalizeRepoRefs({ repoRefs: source.repoRefs })[0];
      return first.split('/')[1] ?? first;
    }
    case 'bitbucket':
      return normalizeBitbucketWorkspaceGroups(source)[0].repos[0];
    case 'jira':
      return normalizeStringList(source.projectKeys, 'jira.projectKeys')[0].toLowerCase();
    case 'advanced':
      if (source.github?.repoRefs?.length)
        return defaultSlugForCreationSource({ kind: 'github-code', ...source.github });
      if (source.bitbucket?.repos?.length) {
        return defaultSlugForCreationSource({ kind: 'bitbucket', ...source.bitbucket });
      }
      if (source.bitbucket?.workspaces?.length) {
        return defaultSlugForCreationSource({ kind: 'bitbucket', ...source.bitbucket });
      }
      if (source.jira?.projectKeys?.length)
        return defaultSlugForCreationSource({ kind: 'jira', ...source.jira });
      throw new Error('advanced source must configure at least one integration');
    case 'local-only':
      throw new Error('slug is required for local-only projects');
  }
}

function githubRepository(
  repoRef: string,
  defaultBranch: string,
  localPath?: string,
): ProjectRepositoryConfig {
  return {
    id: repoId(repoRef),
    repoRef,
    cloneUrl: `git@github.com:${repoRef}.git`,
    defaultBranch,
    localPath: localPath?.trim() || `~/code/${repoRef}`,
    role: 'code',
  };
}

function bitbucketRepository(repoRef: string, defaultBranch: string): ProjectRepositoryConfig {
  return {
    id: repoId(repoRef),
    repoRef,
    cloneUrl: `git@bitbucket.org:${repoRef}.git`,
    defaultBranch,
    localPath: `~/code/${repoRef}`,
    role: 'code',
  };
}

function repoId(repoRef: string): string {
  return repoRef
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function normalizeStringList(values: unknown, field: string): string[] {
  if (!Array.isArray(values)) throw new Error(`${field} must be an array`);
  const normalized = values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
  if (normalized.length === 0) throw new Error(`${field} must contain at least one value`);
  return normalized;
}

function normalizeBitbucketWorkspaceGroups(bitbucket: {
  workspace?: string;
  repos?: string[];
  workspaces?: BitbucketWorkspaceGroupDto[];
  defaultBranch?: string;
}): BitbucketWorkspaceGroupDto[] {
  const groups =
    Array.isArray(bitbucket.workspaces) && bitbucket.workspaces.length > 0
      ? bitbucket.workspaces
      : [
          {
            workspace: bitbucket.workspace,
            repos: bitbucket.repos,
            defaultBranch: bitbucket.defaultBranch,
          },
        ];

  if (groups.length > 3) {
    throw new Error('bitbucket.workspaces supports up to 3 workspaces');
  }

  return groups.map((group, idx) => ({
    workspace: requireNonEmpty(group.workspace, `bitbucket.workspaces[${idx}].workspace`),
    repos: normalizeStringList(group.repos, `bitbucket.workspaces[${idx}].repos`),
    defaultBranch: group.defaultBranch,
  }));
}

function getTargetProjectsRoot(): string {
  return process.env.BOOTSTRAP_TARGET_PROJECTS_ROOT ?? targetProjectsRoot;
}
