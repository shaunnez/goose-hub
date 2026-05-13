import type {
  AgentResult,
  AgentRuntime,
  AgentSpec,
} from '@goose-hub/core/agent-runtime/interface.js';
import type { AgentEvent, AppendEventInput } from '@goose-hub/core/event-stream/store.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import type { revertWpChanges } from '@goose-hub/core/workspaces/orchestrator-git.js';
import { ImplementWpSchema } from '@goose-hub/skills/implement-wp/schema.js';
import type { WorkPackage } from '@goose-hub/skills/spec-author/schema.js';
import type { recordWpIteration } from './parallel-helpers.js';

// ─── Types ────────────────────────────────────────────────────────────────────

// Internal result from the concurrent build phase, before the serial commit phase.
export type WpBuildPhaseResult =
  | {
      status: 'built';
      wp: WorkPackage;
      parsedFilesWritten: Array<{ path: string; reason?: string }>;
      wpRunId: string;
      commitMsg: string;
      scratchWorktreePath: string;
    }
  | { status: 'failed' | 'timeout'; wpId: string; errorReason?: string; runId: string };

export interface RunOneWpBuilderOptions {
  wp: WorkPackage;
  iteration: number;
  runId: string;
  projectId: string;
  workItemId?: string;
  workItem: WorkItem;
  scratchWorktreePath: string;
  stack: { testCommand: string; lintCommand?: string; typecheckCommand?: string };
  runtime: AgentRuntime;
  personaId: string;
  wpTimeoutMs: number;
  appendEvent: (input: AppendEventInput) => AgentEvent;
  revertWpChangesFn: typeof revertWpChanges;
  recordIterationFn: typeof recordWpIteration;
  implementWpPrompt: string;
  implementWpJsonSchema: Record<string, unknown>;
}

// ─── Single-WP builder runner ─────────────────────────────────────────────────

export async function runOneWpBuilder(opts: RunOneWpBuilderOptions): Promise<WpBuildPhaseResult> {
  const { wp, iteration, runId, projectId, workItemId } = opts;
  const wpRunId = `${runId}:wp:${wp.id}:iter:${iteration}`;

  opts.recordIterationFn(runId, wp.id, iteration, 'in-progress');

  opts.appendEvent({
    projectId,
    workItemId: workItemId ?? null,
    kind: 'parallel-implement.wp-started',
    payload: { wpId: wp.id, iteration, wpRunId, scratchPath: opts.scratchWorktreePath },
    runId: wpRunId,
  });

  const spawnSpec: AgentSpec = {
    runId: wpRunId,
    role: 'developer',
    skill: 'implement-wp',
    workspaceDir: opts.scratchWorktreePath,
    context: {
      projectId,
      workItemId,
      workItem: {
        title: opts.workItem.title,
        body: opts.workItem.body,
        number: Number(opts.workItem.externalId),
        priority: opts.workItem.priority,
      },
      wp: {
        id: wp.id,
        filesOwned: wp.filesOwned,
        changes: wp.changes,
        dependsOn: wp.dependsOn,
      },
      worktreePath: opts.scratchWorktreePath,
      stack: opts.stack,
    },
    contextAllowlist: [
      'workItem.title',
      'workItem.body',
      'workItem.number',
      'workItem.priority',
      'wp.id',
      'wp.filesOwned',
      'wp.changes',
      'wp.dependsOn',
      'worktreePath',
      'stack.testCommand',
      'stack.lintCommand',
      'stack.typecheckCommand',
    ],
    freshContext: false,
    toolBundles: ['dev-tools'],
    toolExtras: [],
    budgets: { maxTurns: 150, maxBudgetUsd: 10.0, timeoutMs: opts.wpTimeoutMs },
    personaId: opts.personaId,
    outputJsonSchema: opts.implementWpJsonSchema,
    appendSystemPrompt: opts.implementWpPrompt,
    env: {
      FACTORY_WP_FILESOWNED: wp.filesOwned.join(':'),
      FACTORY_WP_ID: wp.id,
    },
  };

  let result: AgentResult | undefined;
  let errorReason: string | undefined;
  let timedOut = false;

  const start = Date.now();

  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('wp-timeout')), opts.wpTimeoutMs),
    );
    result = await Promise.race([opts.runtime.run(spawnSpec), timeout]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'wp-timeout') {
      timedOut = true;
    } else {
      errorReason = msg;
    }
  }

  if (timedOut) {
    opts.appendEvent({
      projectId,
      workItemId: workItemId ?? null,
      kind: 'parallel-implement.wp-timeout',
      payload: { wpId: wp.id, wpRunId, elapsedMs: Date.now() - start },
      runId: wpRunId,
    });
    opts.revertWpChangesFn(opts.scratchWorktreePath, wp.filesOwned);
    opts.recordIterationFn(runId, wp.id, iteration, 'failed', 'timeout');
    return { status: 'timeout', wpId: wp.id, errorReason: 'timeout', runId: wpRunId };
  }

  if (errorReason != null || result == null) {
    opts.appendEvent({
      projectId,
      workItemId: workItemId ?? null,
      kind: 'parallel-implement.wp-failed',
      payload: { wpId: wp.id, wpRunId, errorReason: errorReason ?? 'unknown' },
      runId: wpRunId,
    });
    opts.revertWpChangesFn(opts.scratchWorktreePath, wp.filesOwned);
    opts.recordIterationFn(runId, wp.id, iteration, 'failed', errorReason ?? 'unknown');
    return { status: 'failed', wpId: wp.id, errorReason: errorReason ?? 'unknown', runId: wpRunId };
  }

  const parsed = ImplementWpSchema.safeParse(result.output);
  if (!parsed.success) {
    const reason = `schema validation failed: ${parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')}`;
    opts.appendEvent({
      projectId,
      workItemId: workItemId ?? null,
      kind: 'parallel-implement.wp-failed',
      payload: { wpId: wp.id, wpRunId, errorReason: reason },
      runId: wpRunId,
    });
    opts.revertWpChangesFn(opts.scratchWorktreePath, wp.filesOwned);
    opts.recordIterationFn(runId, wp.id, iteration, 'failed', reason);
    return { status: 'failed', wpId: wp.id, errorReason: reason, runId: wpRunId };
  }

  // Build succeeded — return files for the serial commit phase.
  const commitMsg = `M:${wp.id} ${wp.changes.slice(0, 60)}\n\nBuilt by ${opts.personaId}`;
  return {
    status: 'built',
    wp,
    parsedFilesWritten: parsed.data.filesWritten,
    wpRunId,
    commitMsg,
    scratchWorktreePath: opts.scratchWorktreePath,
  };
}
