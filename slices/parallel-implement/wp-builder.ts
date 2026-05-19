import type {
  AgentBudgets,
  AgentResult,
  AgentRuntime,
  AgentSpec,
} from '@goose-hub/core/agent-runtime/interface.js';
import type { InvestigationContext } from '@goose-hub/core/agent-runtime/investigation-context.js';
import { getRecordDecisionTool } from '@goose-hub/core/db/repositories/project-settings.js';
import type { AgentEvent, AppendEventInput } from '@goose-hub/core/event-stream/store.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import { writeWpBuilderSandbox } from '@goose-hub/core/tool-layer/sandbox.js';
import type { revertWpChanges } from '@goose-hub/core/workspaces/orchestrator-git.js';
import {
  type RepoRelativePathNormalization,
  discoverPackageRoots,
  normalizeRepoRelativePath,
} from '@goose-hub/core/workspaces/path-normalization.js';
import { ImplementWpSchema } from '@goose-hub/skills/implement-wp/schema.js';
import type { ImplementWpOutput } from '@goose-hub/skills/implement-wp/schema.js';
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
  budgets: AgentBudgets;
  modelOverride: string;
  personaId: string;
  wpTimeoutMs: number;
  appendEvent: (input: AppendEventInput) => AgentEvent;
  revertWpChangesFn: typeof revertWpChanges;
  recordIterationFn: typeof recordWpIteration;
  implementWpPrompt: string;
  implementWpJsonSchema: Record<string, unknown>;
  investigation?: InvestigationContext;
}

type NormalizedPathField = {
  field: string;
  from: string;
  to: string;
  source: RepoRelativePathNormalization['source'];
  ambiguous?: string[];
};

function normalizeWpFilesOwned(input: {
  wp: WorkPackage;
  worktreePath: string;
}): { wp: WorkPackage; fields: NormalizedPathField[]; ambiguousFields: NormalizedPathField[] } {
  const packageRoots = discoverPackageRoots(input.worktreePath);
  const fields: NormalizedPathField[] = [];
  const filesOwned = input.wp.filesOwned.map((rawPath, index) => {
    const result = normalizeRepoRelativePath({
      rawPath,
      worktreePath: input.worktreePath,
      packageRoots,
      referencePaths: input.wp.filesOwned,
    });
    if (result.path !== rawPath || result.ambiguous != null) {
      fields.push({
        field: `filesOwned[${index}]`,
        from: rawPath,
        to: result.path,
        source: result.source,
        ...(result.ambiguous != null && { ambiguous: result.ambiguous }),
      });
    }
    return result.path;
  });
  return {
    wp: { ...input.wp, filesOwned },
    fields,
    ambiguousFields: fields.filter(
      (field) => field.source === 'unresolved' && field.ambiguous != null,
    ),
  };
}

function normalizeImplementWpOutputPaths(input: {
  output: ImplementWpOutput;
  worktreePath: string;
  wp: WorkPackage;
}): {
  output: ImplementWpOutput;
  fields: NormalizedPathField[];
  ambiguousFields: NormalizedPathField[];
} {
  const packageRoots = discoverPackageRoots(input.worktreePath);
  const referencePaths = [
    ...input.wp.filesOwned,
    ...input.output.filesWritten.map((file) => file.path),
    ...input.output.testsWritten.map((test) => test.path),
    ...input.output.testsRun.paths,
  ];
  const fields: NormalizedPathField[] = [];
  const normalizeField = (field: string, rawPath: string): string => {
    const result = normalizeRepoRelativePath({
      rawPath,
      worktreePath: input.worktreePath,
      packageRoots,
      referencePaths,
    });
    if (result.path !== rawPath || result.ambiguous != null) {
      fields.push({
        field,
        from: rawPath,
        to: result.path,
        source: result.source,
        ...(result.ambiguous != null && { ambiguous: result.ambiguous }),
      });
    }
    return result.path;
  };
  const output: ImplementWpOutput = {
    ...input.output,
    filesWritten: input.output.filesWritten.map((file, index) => ({
      ...file,
      path: normalizeField(`filesWritten[${index}].path`, file.path),
    })),
    testsWritten: input.output.testsWritten.map((test, index) => ({
      ...test,
      path: normalizeField(`testsWritten[${index}].path`, test.path),
    })),
    testsRun: {
      ...input.output.testsRun,
      paths: input.output.testsRun.paths.map((path, index) =>
        normalizeField(`testsRun.paths[${index}]`, path),
      ),
    },
  };

  return {
    output,
    fields,
    ambiguousFields: fields.filter(
      (field) => field.source === 'unresolved' && field.ambiguous != null,
    ),
  };
}

// ─── Single-WP builder runner ─────────────────────────────────────────────────

export async function runOneWpBuilder(opts: RunOneWpBuilderOptions): Promise<WpBuildPhaseResult> {
  const { iteration, runId, projectId, workItemId } = opts;
  const wpRunId = `${runId}:wp:${opts.wp.id}:iter:${iteration}`;

  const normalizedWp = normalizeWpFilesOwned({
    wp: opts.wp,
    worktreePath: opts.scratchWorktreePath,
  });
  if (normalizedWp.ambiguousFields.length > 0) {
    const reason = `ambiguous repo-relative paths in implement-wp filesOwned: ${normalizedWp.ambiguousFields
      .map((field) => `${field.field} (${field.from})`)
      .join(', ')}`;
    opts.appendEvent({
      projectId,
      workItemId: workItemId ?? null,
      kind: 'agent.contract-gate-blocked',
      payload: {
        runId: wpRunId,
        skill: 'implement-wp',
        wpId: opts.wp.id,
        gate: 'implement-wp-ownership',
        reason: 'ambiguous-files-owned',
        fields: normalizedWp.ambiguousFields,
      },
      runId: wpRunId,
    });
    opts.recordIterationFn(runId, opts.wp.id, iteration, 'failed', reason);
    return { status: 'failed', wpId: opts.wp.id, errorReason: reason, runId: wpRunId };
  }

  const wp = normalizedWp.wp;
  if (normalizedWp.fields.length > 0) {
    opts.appendEvent({
      projectId,
      workItemId: workItemId ?? null,
      kind: 'agent.output-repaired',
      payload: {
        runId: wpRunId,
        skill: 'implement-wp',
        wpId: wp.id,
        gate: 'implement-wp-ownership',
        fields: normalizedWp.fields,
      },
      runId: wpRunId,
    });
  }

  opts.recordIterationFn(runId, wp.id, iteration, 'in-progress');

  opts.appendEvent({
    projectId,
    workItemId: workItemId ?? null,
    kind: 'parallel-implement.wp-started',
    payload: { wpId: wp.id, iteration, wpRunId, scratchPath: opts.scratchWorktreePath },
    runId: wpRunId,
  });
  if (opts.investigation != null) {
    opts.appendEvent({
      projectId,
      workItemId: workItemId ?? null,
      kind: 'agent.investigation-context-injected',
      payload: {
        runId: wpRunId,
        skill: 'implement-wp',
        wpId: wp.id,
        investigationRunId: opts.investigation.investigationRunId ?? null,
        keyFiles: opts.investigation.keyFiles.map((f) => f.path),
        keyFileCount: opts.investigation.keyFiles.length,
        findingsChars: opts.investigation.findings?.length ?? 0,
        openQuestionCount: opts.investigation.openQuestions.length,
      },
      runId: wpRunId,
    });
  }

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
      investigation: opts.investigation,
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
      'investigation',
      'worktreePath',
      'stack.testCommand',
      'stack.lintCommand',
      'stack.typecheckCommand',
    ],
    freshContext: false,
    toolBundles: ['dev-tools'],
    toolExtras: [],
    budgets: { ...opts.budgets, timeoutMs: opts.wpTimeoutMs },
    modelOverride: opts.modelOverride,
    personaId: opts.personaId,
    outputJsonSchema: opts.implementWpJsonSchema,
    appendSystemPrompt: opts.implementWpPrompt,
    sandboxMode: 'preconfigured', // writeWpBuilderSandbox already ran in workflow.ts before spawn
    env: {
      FACTORY_WP_FILESOWNED: wp.filesOwned.join(':'),
      FACTORY_WP_ID: wp.id,
    },
  };

  // Write WP sandbox fresh for each spawn attempt (covers retries and preserves
  // decision-capture hook when experimental.recordDecisionTool is enabled).
  writeWpBuilderSandbox(opts.scratchWorktreePath, wp.filesOwned, wp.id, {
    role: 'developer',
    recordDecisionTool: getRecordDecisionTool(projectId),
  });

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

  const normalized = normalizeImplementWpOutputPaths({
    output: parsed.data,
    worktreePath: opts.scratchWorktreePath,
    wp,
  });
  if (normalized.fields.length > 0) {
    opts.appendEvent({
      projectId,
      workItemId: workItemId ?? null,
      kind: 'agent.path-normalized',
      payload: {
        runId: wpRunId,
        skill: 'implement-wp',
        wpId: wp.id,
        fields: normalized.fields,
      },
      runId: wpRunId,
    });
  }
  if (normalized.ambiguousFields.length > 0) {
    const reason = `ambiguous repo-relative paths in implement-wp output: ${normalized.ambiguousFields
      .map((field) => `${field.field} (${field.from})`)
      .join(', ')}`;
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
  const output = ImplementWpSchema.parse(normalized.output);

  // Build succeeded — return files for the serial commit phase.
  const commitMsg = `M:${wp.id} ${wp.changes.slice(0, 60)}\n\nBuilt by ${opts.personaId}`;
  return {
    status: 'built',
    wp,
    parsedFilesWritten: output.filesWritten,
    wpRunId,
    commitMsg,
    scratchWorktreePath: opts.scratchWorktreePath,
  };
}
