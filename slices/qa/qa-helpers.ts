import { execFileSync } from 'node:child_process';
import type { QaE2eMode } from '@goose-hub/core/db/repositories/project-settings.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';

export function getPrDiff(_workItem: WorkItem, workspaceDir?: string): string {
  if (workspaceDir == null) return '';
  try {
    return execFileSync('git', ['diff', 'origin/main...HEAD'], {
      cwd: workspaceDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return '';
  }
}

function diffNameOnly(workspaceDir: string, baseRef: string): string[] {
  return execFileSync('git', ['diff', '--name-only', `${baseRef}...HEAD`], {
    cwd: workspaceDir,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function resolveOriginHead(workspaceDir: string): string | null {
  try {
    return execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
      cwd: workspaceDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

export function getChangedPaths(workspaceDir?: string, baseBranch = 'main'): string[] {
  if (workspaceDir == null) return [];
  const candidates = [
    `origin/${baseBranch}`,
    baseBranch,
    resolveOriginHead(workspaceDir),
    'origin/HEAD',
    'HEAD~1',
  ].filter((ref): ref is string => ref != null && ref.length > 0);
  for (const ref of [...new Set(candidates)]) {
    try {
      return diffNameOnly(workspaceDir, ref);
    } catch {
      // Try the next base ref. Worktrees from other projects may not have
      // origin/main, and shallow fetches may not have every remote ref.
    }
  }
  return [];
}

function isIgnoredForUiE2e(path: string): boolean {
  return (
    path.startsWith('docs/') ||
    path.endsWith('.md') ||
    path.startsWith('evidence/') ||
    path.includes('/test-results/') ||
    /^apps\/web\/e2e\/issue-[^/]+\.spec\.ts$/.test(path) ||
    /\.test\.[tj]sx?$/.test(path) ||
    /\.spec\.[tj]sx?$/.test(path)
  );
}

function hasUiFileExtension(path: string): boolean {
  return /\.(tsx|jsx|html|css|scss|sass|less)$/.test(path);
}

export function classifyUiChange(paths: string[]): {
  hasUiChange: boolean;
  matchedPaths: string[];
} {
  const matchedPaths = paths.filter((path) => {
    if (isIgnoredForUiE2e(path)) return false;
    return (
      hasUiFileExtension(path) ||
      path.startsWith('apps/web/src/') ||
      path.startsWith('apps/web/app/') ||
      path.startsWith('apps/web/routes/') ||
      path.startsWith('apps/web/components/') ||
      path.startsWith('apps/web/styles/') ||
      path === 'apps/web/package.json' ||
      path === 'apps/web/playwright.config.ts' ||
      path === 'apps/web/playwright-e2e-pipeline.config.ts' ||
      path.endsWith('.css') ||
      path.includes('/api/') ||
      path.includes('/events') ||
      path.includes('/timeline') ||
      path.includes('api-client') ||
      path.includes('client.ts')
    );
  });
  return { hasUiChange: matchedPaths.length > 0, matchedPaths };
}

export type E2eDecision = {
  mode: QaE2eMode;
  command?: string;
  reason: string;
  changedPaths?: string[];
};

export function decideQaE2e(input: {
  mode: QaE2eMode;
  configuredCommand?: string | null;
  changedPaths: string[];
}): E2eDecision {
  const command = input.configuredCommand ?? undefined;
  if (input.mode === 'off') {
    return { mode: input.mode, reason: 'qaE2eMode=off' };
  }
  if (command == null || command.length === 0) {
    return { mode: input.mode, reason: 'No e2e command configured' };
  }
  if (input.mode === 'always') {
    return { mode: input.mode, command, reason: 'qaE2eMode=always' };
  }
  const classification = classifyUiChange(input.changedPaths);
  if (classification.hasUiChange) {
    return {
      mode: input.mode,
      command,
      reason: 'UI-facing changes detected',
      changedPaths: classification.matchedPaths,
    };
  }
  return {
    mode: input.mode,
    reason: 'No UI-facing changes detected',
    changedPaths: input.changedPaths,
  };
}

export interface PrOpenedHints {
  worktreePath?: string;
  devRunId?: string;
  pipelineRunId?: string;
}

export function findPrOpenedHints(workItemId: string): PrOpenedHints {
  const events = eventStore.replay({ workItemId });
  const prOpened = events
    .slice()
    .reverse()
    .find((e) => e.kind === 'pr.opened');
  if (prOpened == null) return {};
  const payload = prOpened.payload as Record<string, unknown>;
  return {
    worktreePath: typeof payload.worktreePath === 'string' ? payload.worktreePath : undefined,
    devRunId: typeof payload.devRunId === 'string' ? payload.devRunId : undefined,
    pipelineRunId: typeof payload.pipelineRunId === 'string' ? payload.pipelineRunId : undefined,
  };
}

/**
 * Reads the developer's targeted-test-run record from the most recent
 * `agent.implement-complete` event for this work item (#467). Returns
 * undefined if no implement-complete event exists or the payload is
 * missing/malformed — QA still runs, just without cross-reference data.
 */
export function findDevTestsRun(
  workItemId: string,
): { command: string; paths: string[] } | undefined {
  const events = eventStore.replay({ workItemId });
  const implementComplete = events
    .slice()
    .reverse()
    .find((e) => e.kind === 'agent.implement-complete');
  if (implementComplete == null) return undefined;
  const payload = implementComplete.payload as Record<string, unknown>;
  const tr = payload.testsRun;
  if (
    tr == null ||
    typeof tr !== 'object' ||
    typeof (tr as { command?: unknown }).command !== 'string' ||
    !Array.isArray((tr as { paths?: unknown }).paths) ||
    !(tr as { paths: unknown[] }).paths.every((p) => typeof p === 'string')
  ) {
    return undefined;
  }
  return tr as { command: string; paths: string[] };
}
