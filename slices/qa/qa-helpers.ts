import { execFileSync } from 'node:child_process';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';

export const QA_PR_DIFF_CHAR_LIMIT = 200_000;

function diffBaseRef(baseBranch = 'main'): string {
  return baseBranch.startsWith('origin/') ? baseBranch : `origin/${baseBranch}`;
}

function runGit(workspaceDir: string, args: string[], maxBuffer = 4 * 1024 * 1024): string {
  return execFileSync('git', args, {
    cwd: workspaceDir,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer,
  });
}

export function capPrDiffForPrompt(
  diff: string,
  workspaceDir: string,
  baseBranch = 'main',
): string {
  if (diff.length <= QA_PR_DIFF_CHAR_LIMIT) return diff;

  let stat = '';
  let files = '';
  const baseRef = diffBaseRef(baseBranch);
  try {
    stat = runGit(workspaceDir, ['diff', '--stat', `${baseRef}...HEAD`]);
    files = runGit(workspaceDir, ['diff', '--name-only', `${baseRef}...HEAD`]);
  } catch {
    // Best-effort context only. The capped raw diff below is still useful.
  }

  return [
    `[QA diff truncated: ${diff.length} characters exceeded ${QA_PR_DIFF_CHAR_LIMIT}.]`,
    files.trim().length > 0 ? `Changed files:\n${files.trim()}` : '',
    stat.trim().length > 0 ? `Diff stat:\n${stat.trim()}` : '',
    `First ${QA_PR_DIFF_CHAR_LIMIT} characters:\n${diff.slice(0, QA_PR_DIFF_CHAR_LIMIT)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function getPrDiff(_workItem: WorkItem, workspaceDir?: string, baseBranch = 'main'): string {
  if (workspaceDir == null) return '';
  try {
    const baseRef = diffBaseRef(baseBranch);
    return capPrDiffForPrompt(
      runGit(workspaceDir, ['diff', `${baseRef}...HEAD`]),
      workspaceDir,
      baseBranch,
    );
  } catch {
    return '';
  }
}

export function getChangedFilePaths(workspaceDir?: string, baseBranch = 'main'): string[] {
  if (workspaceDir == null) return [];
  try {
    const baseRef = diffBaseRef(baseBranch);
    return runGit(workspaceDir, ['diff', '--name-only', `${baseRef}...HEAD`])
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export type UiChangeClassification = {
  hasSignificantUiChange: boolean;
  significantPaths: string[];
  ignoredPaths: string[];
  reason: string;
};

function isIgnoredForE2e(path: string): boolean {
  return (
    path.startsWith('docs/') ||
    path.startsWith('evidence/') ||
    path.startsWith('apps/web/test-results/') ||
    path.startsWith('apps/web/playwright-report/') ||
    /^apps\/web\/e2e\/issue-[^/]+\.spec\.ts$/.test(path) ||
    /\.(png|jpe?g|gif|webm|mp4)$/.test(path)
  );
}

function isTestOnly(path: string): boolean {
  return (
    /\.test\.[cm]?[jt]sx?$/.test(path) ||
    /\.spec\.[cm]?[jt]sx?$/.test(path) ||
    path.includes('/__tests__/')
  );
}

function isSignificantUiPath(path: string): boolean {
  if (isIgnoredForE2e(path) || isTestOnly(path)) return false;
  if (path.startsWith('apps/web/src/')) return true;
  if (path.startsWith('apps/web/routes/') || path.startsWith('apps/web/components/')) return true;
  if (/\.(css|scss|sass|less)$/.test(path)) return true;
  if (/api-client|client-api|frontend-api|timeline|event-stream|events|routes/.test(path)) {
    return true;
  }
  return false;
}

export function classifyUiChanges(paths: string[]): UiChangeClassification {
  const significantPaths = paths.filter(isSignificantUiPath);
  const ignoredPaths = paths.filter((path) => !isSignificantUiPath(path));
  if (significantPaths.length > 0) {
    return {
      hasSignificantUiChange: true,
      significantPaths,
      ignoredPaths,
      reason: `significant UI/API paths changed: ${significantPaths.slice(0, 5).join(', ')}`,
    };
  }
  return {
    hasSignificantUiChange: false,
    significantPaths,
    ignoredPaths,
    reason: paths.length === 0 ? 'no changed files detected' : 'no significant UI changes detected',
  };
}

export interface PrOpenedHints {
  worktreePath?: string;
  devRunId?: string;
  pipelineRunId?: string;
  baseBranch?: string;
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
    baseBranch: typeof payload.baseBranch === 'string' ? payload.baseBranch : undefined,
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
