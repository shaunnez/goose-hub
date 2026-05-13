import { execFileSync } from 'node:child_process';
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
