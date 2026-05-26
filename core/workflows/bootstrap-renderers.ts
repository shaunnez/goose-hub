/**
 * bootstrap-renderers.ts — pure string-rendering helpers for the bootstrap workflow.
 *
 * Extracted from bootstrap-project.ts. No I/O, no GitHub calls.
 */

import * as nodePath from 'node:path';
import type { AuditResult } from '../bootstrap/claude-md-auditor.js';
import type { InstallResult } from '../bootstrap/label-installer.js';
import type { StackInfo } from '../bootstrap/stack-detector.js';

// ---------------------------------------------------------------------------
// PrBodyInput
// ---------------------------------------------------------------------------

export interface PrBodyInput {
  repoRef: string;
  repoRefs?: string[];
  slug: string;
  name?: string;
  stack: StackInfo;
  audit: AuditResult;
  labels: InstallResult;
}

export interface BootstrapRepoRenderInput {
  repoRef: string;
  defaultBranch: string;
  description: string;
  cloneUrl?: string;
}

// ---------------------------------------------------------------------------
// Stack summary
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Project config renderer
// ---------------------------------------------------------------------------

/**
 * Generate `target-projects/<slug>/project.config.ts` content with the
 * detected stack baked in. Budgets/personas are intentionally minimal — the
 * human is expected to edit before merging the bootstrap PR.
 */
export function renderProjectConfig(input: {
  slug: string;
  name?: string;
  repoRef: string;
  repos?: BootstrapRepoRenderInput[];
  defaultBranch: string;
  cloneRoot: string;
  stack: StackInfo;
  detectedAt: string;
}): string {
  const { slug, repoRef, defaultBranch, cloneRoot, stack, detectedAt } = input;
  const name = input.name ?? slug;
  const repos = input.repos ?? [{ repoRef, defaultBranch, description: '' }];
  const repoRefs = repos.map((repo) => repo.repoRef);
  const firstRepo = repos[0] ?? { repoRef, defaultBranch, description: '' };
  const stackBlock = renderStackBlock(stack, detectedAt);
  const cloneUrl = firstRepo.cloneUrl ?? `git@github.com:${firstRepo.repoRef}.git`;
  const localPath = localRepoPath(cloneRoot, firstRepo.repoRef);
  const repositoriesBlock = renderRepositoriesBlock(repos, cloneRoot);

  return `import type { ProjectConfig } from '../../core/types.js';

const config: ProjectConfig = {
  id: ${JSON.stringify(slug)},
  name: ${JSON.stringify(name)},
  slug: ${JSON.stringify(slug)},
  source: {
    kind: 'local-db',
    stateMachine: 'db',
    integrations: {
      github: {
        repos: ${JSON.stringify(repoRefs)},
        mirrorLabels: false,
        importIssues: true,
      },
    },
  },
  targetRepo: {
    cloneUrl: ${JSON.stringify(cloneUrl)},
    defaultBranch: ${JSON.stringify(firstRepo.defaultBranch ?? defaultBranch)},
    localPath: ${JSON.stringify(localPath)},
  },
  repositories: ${repositoriesBlock},
  stack: ${stackBlock},
  mode: 'supervised',
  storage: { kind: 'local', path: ${JSON.stringify(`~/.factory/data/${slug}`)} },
  repos: ${JSON.stringify(repoRefs)},
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
      developer: { bundles: ['dev-tools'] },
      qa: { bundles: ['qa-tools'] },
      reviewer: { bundles: ['read', 'qa-tools'] },
      retrospector: { bundles: ['core'] },
      researcher: { bundles: ['read'] },
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
    perBashCommandMaxSeconds: 0,
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

function renderRepositoriesBlock(repos: BootstrapRepoRenderInput[], cloneRoot: string): string {
  const entries = repos.map((repo) => ({
    id: repoId(repo.repoRef),
    repoRef: repo.repoRef,
    cloneUrl: repo.cloneUrl ?? `git@github.com:${repo.repoRef}.git`,
    defaultBranch: repo.defaultBranch,
    localPath: localRepoPath(cloneRoot, repo.repoRef),
    role: 'unknown',
  }));
  return JSON.stringify(entries, null, 4)
    .replace(/"([^"]+)":/g, '$1:')
    .replace(/"unknown"/g, "'unknown'");
}

function repoId(repoRef: string): string {
  return repoRef
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function localRepoPath(cloneRoot: string, repoRef: string): string {
  const repoName = repoRef.split('/')[1] ?? repoRef;
  return nodePath.posix.join(cloneRoot.replace(/\\/g, '/'), repoName);
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

export function renderPrBody(input: PrBodyInput): string {
  const { repoRef, slug, stack, audit, labels } = input;
  const stackSummary = summariseStack(stack);
  const repoRefs = input.repoRefs?.length ? input.repoRefs : [repoRef];

  const claudeBlock = renderClaudeBlock(audit);
  const errorTail =
    labels.errors.length > 0
      ? `\n${labels.errors.map((e) => `  - ${e.name}: ${e.message}`).join('\n')}`
      : '';
  const labelBlock = `- created: ${labels.created}\n- updated: ${labels.updated}\n- skipped: ${labels.skipped}\n- errors: ${labels.errors.length}${errorTail}`;

  return `# Bootstrap registration: ${input.name ?? slug}

This PR registers \`${input.name ?? slug}\` as a Factory-managed project under slug \`${slug}\`.

## Repositories

${repoRefs.map((ref) => `- \`${ref}\``).join('\n')}

## Stack summary

${stackSummary}

## CLAUDE.md audit

${claudeBlock}

## Label install report

${labelBlock}

## Webhook setup

After this PR merges, configure GitHub webhooks on the linked repos so factory ticks
react to label changes:

1. Go to each repo's hook settings, for example \`https://github.com/${repoRefs[0]}/settings/hooks/new\`.
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
        `**Action**: create — no agent instruction file exists in target repo.`,
        '',
        '**Preview** (first 40 lines):',
        '',
        '```markdown',
        audit.content.split('\n').slice(0, 40).join('\n'),
        '```',
      ].join('\n');
    case 'update':
      return [
        `**Action**: update — existing ${audit.path ?? 'agent instruction file'} is missing required sections.`,
        '',
        '**Diff**:',
        '',
        '```diff',
        audit.content,
        '```',
      ].join('\n');
    case 'ok':
      return `**Action**: ok — ${audit.path ?? 'agent instruction file'} already contains all required sections; no changes proposed.`;
  }
}

// ---------------------------------------------------------------------------
// repos.md renderer
// ---------------------------------------------------------------------------

export function renderReposMd(
  slug: string,
  repoRefOrRepos: string | BootstrapRepoRenderInput[],
  description = '',
): string {
  const repos =
    typeof repoRefOrRepos === 'string'
      ? [{ repoRef: repoRefOrRepos, description, defaultBranch: 'main' }]
      : repoRefOrRepos;
  const body = repos
    .map((repo) => {
      const desc = repo.description.trim() || `${repo.repoRef} managed by Factory.`;
      return `### [${repo.repoRef}](https://github.com/${repo.repoRef})\n**Default branch:** \`${repo.defaultBranch}\`\n**Description:** ${desc}`;
    })
    .join('\n\n');
  return `# Repo Registry — ${slug}\n\n${body}\n`;
}
