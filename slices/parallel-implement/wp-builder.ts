import { existsSync, readFileSync } from 'node:fs';
import type { AcceptanceContract } from '@goose-hub/core/acceptance-contracts/types.js';
import type { ExecutableCheck } from '@goose-hub/core/acceptance-contracts/types.js';
import { buildCodeContextBundle } from '@goose-hub/core/agent-runtime/code-context.js';
import type {
  AgentBudgets,
  AgentResult,
  AgentRuntime,
  AgentSpec,
  BudgetExceededMetadata,
} from '@goose-hub/core/agent-runtime/interface.js';
import type { InvestigationContext } from '@goose-hub/core/agent-runtime/investigation-context.js';
import { safeParseOutputForSchema } from '@goose-hub/core/agent-runtime/output-normalization.js';
import { reconcileDecisionSummaries } from '@goose-hub/core/agent-runtime/reconcile-decisions.js';
import {
  collectReportedRunTestFailures,
  collectWrittenTestVerificationFailures,
  formatWrittenTestVerificationFailure,
  hasSuccessfulVerificationToolCall,
  isEditToolCall,
  toolCallInput,
  toolCallName,
} from '@goose-hub/core/agent-runtime/test-verification-evidence.js';
import { getRecordDecisionTool } from '@goose-hub/core/db/repositories/project-settings.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
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
import {
  type WorkPackage,
  fileOwnedPath,
  fileOwnedStatus,
} from '@goose-hub/skills/spec-author/schema.js';
import type { PrdPlanningContext } from '../spec-author/prd-planning-context.js';
import type { recordWpIteration } from './parallel-helpers.js';
import type { ImplementWpControlConfig } from './wp-budget.js';
import type { ImplementWpSpecContext } from './wp-context.js';
import { commandMentionsWpFile } from './wp-context.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type TerminalDecisionKind = 'TOOL_FAILURE' | 'BLOCKER';

export type ImplementWpAcceptanceFailure =
  | { kind: 'terminal-blocker'; reason: string; decisionKind: TerminalDecisionKind }
  | { kind: 'verification-failed'; reason: string }
  | { kind: 'low-confidence'; reason: string };

// Internal result from the concurrent build phase, before the serial commit phase.
export type WpBuildPhaseResult =
  | {
      status: 'built';
      wp: WorkPackage;
      parsedFilesWritten: Array<{ path: string; reason?: string }>;
      wpRunId: string;
      commitMsg: string;
      scratchWorktreePath: string;
      budgetExceeded?: BudgetExceededMetadata;
    }
  | {
      status: 'failed' | 'timeout';
      wpId: string;
      errorReason?: string;
      runId: string;
      acceptanceFailure?: ImplementWpAcceptanceFailure;
    };

export interface RunOneWpBuilderOptions {
  wp: WorkPackage;
  iteration: number;
  runId: string;
  pipelineRunId?: string;
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
  specContext?: ImplementWpSpecContext;
  acceptanceContract?: AcceptanceContract;
  verificationCommands?: ExecutableCheck[];
  parentPrdContext?: PrdPlanningContext;
  implementWpControl?: ImplementWpControlConfig;
  verifyWorktreeDependenciesFn?: (worktreePath: string) => void;
}

type CodeSnippet = {
  path: string;
  label: string;
  content: string;
  truncated?: boolean;
};

type NormalizedPathField = {
  field: string;
  from: string;
  to: string;
  source: RepoRelativePathNormalization['source'];
  ambiguous?: string[];
};

function isTerminalDecisionKind(kind: unknown): kind is TerminalDecisionKind {
  return kind === 'TOOL_FAILURE' || kind === 'BLOCKER';
}

function terminalDecisionReason(kind: TerminalDecisionKind, summary?: unknown): string {
  return typeof summary === 'string' && summary.trim().length > 0
    ? `implement-wp emitted ${kind}: ${summary.trim()}`
    : `implement-wp emitted ${kind}`;
}

function terminalDecisionFailure(
  output: ImplementWpOutput,
  events: AgentEvent[],
): Extract<ImplementWpAcceptanceFailure, { kind: 'terminal-blocker' }> | null {
  for (const summary of output.decisionSummaries) {
    if (isTerminalDecisionKind(summary.kind)) {
      return {
        kind: 'terminal-blocker',
        reason: terminalDecisionReason(summary.kind, summary.summary),
        decisionKind: summary.kind,
      };
    }
  }

  for (const event of events) {
    if (event.kind !== 'agent.decision-summary') continue;
    const payload = event.payload as { kind?: unknown; summary?: unknown };
    if (isTerminalDecisionKind(payload.kind)) {
      return {
        kind: 'terminal-blocker',
        reason: terminalDecisionReason(payload.kind, payload.summary),
        decisionKind: payload.kind,
      };
    }
  }
  return null;
}

function isRetryCapFinalVerificationFailure(failure: ImplementWpAcceptanceFailure | null): boolean {
  if (failure?.kind !== 'terminal-blocker') return false;
  return /(?:final|exact-file|rerun|verification).*(?:retry cap|locked out|refused|harness retry)/i.test(
    failure.reason,
  );
}

function mergeRuntimeAndDurableEvents(
  runtimeEvents: AgentEvent[],
  durableEvents: AgentEvent[],
): AgentEvent[] {
  const seenIds = new Set(runtimeEvents.map((event) => event.id));
  return [...runtimeEvents, ...durableEvents.filter((event) => !seenIds.has(event.id))];
}

function implementWpAcceptanceFailure(input: {
  output: ImplementWpOutput;
  events: AgentEvent[];
  verificationRequired: boolean;
}): ImplementWpAcceptanceFailure | null {
  const terminalFailure = terminalDecisionFailure(input.output, input.events);
  const retryCapFinalVerificationFailure = isRetryCapFinalVerificationFailure(terminalFailure);
  const writtenTestPaths = [...new Set(input.output.testsWritten.map((test) => test.path))];
  let writtenTestsCoveredByParentPass = false;
  if (writtenTestPaths.length > 0) {
    const failedWrittenTests = collectWrittenTestVerificationFailures(
      input.events,
      writtenTestPaths,
    );
    const writtenFailureReason = formatWrittenTestVerificationFailure(failedWrittenTests);
    if (writtenFailureReason != null) {
      return {
        kind: 'verification-failed',
        reason: writtenFailureReason,
      };
    }
    writtenTestsCoveredByParentPass = true;
  }
  if (
    terminalFailure != null &&
    !(retryCapFinalVerificationFailure && writtenTestsCoveredByParentPass)
  ) {
    return terminalFailure;
  }
  if (
    input.output.confidence === 'low' &&
    input.verificationRequired &&
    !(retryCapFinalVerificationFailure && writtenTestsCoveredByParentPass)
  ) {
    return {
      kind: 'low-confidence',
      reason: 'implement-wp returned low confidence while verification was required',
    };
  }
  const reportedRunPaths = [...new Set(input.output.testsRun.paths)];
  if (reportedRunPaths.length > 0) {
    const failedPaths = collectReportedRunTestFailures({
      events: input.events,
      reportedRunPaths,
      writtenTestPaths,
    });
    if (failedPaths.length > 0) {
      return {
        kind: 'verification-failed',
        reason: `required run_tests did not pass for: ${failedPaths.join(', ')}`,
      };
    }
  }
  if (input.verificationRequired && !hasSuccessfulVerificationToolCall(input.events)) {
    return {
      kind: 'verification-failed',
      reason: 'verification was required but no verification tool passed',
    };
  }
  return null;
}

function isVerificationToolCall(event: AgentEvent): boolean {
  const name = toolCallName(event)?.toLowerCase();
  if (name == null) return false;
  if (name.includes('test') || name.includes('lint') || name.includes('typecheck')) return true;
  const command = toolCallInput(event).command;
  return (
    typeof command === 'string' &&
    /\b(test|vitest|lint|typecheck|tsc|biome|playwright)\b/.test(command)
  );
}

function editTestLoopDiagnosis(input: {
  events: AgentEvent[];
  maxCycles: number;
}): { cycleCount: number; recentToolCalls: Array<{ toolName: string; command?: string }> } | null {
  let editedSinceVerification = false;
  let cycleCount = 0;
  const recentToolCalls: Array<{ toolName: string; command?: string }> = [];
  for (const event of input.events) {
    const toolName = toolCallName(event);
    if (toolName == null) continue;
    const command = toolCallInput(event).command;
    recentToolCalls.push({
      toolName,
      ...(typeof command === 'string' ? { command: command.slice(0, 300) } : {}),
    });
    if (recentToolCalls.length > 8) recentToolCalls.shift();

    if (isEditToolCall(event)) {
      editedSinceVerification = true;
      continue;
    }
    if (editedSinceVerification && isVerificationToolCall(event)) {
      cycleCount += 1;
      editedSinceVerification = false;
    }
  }

  if (cycleCount <= input.maxCycles) return null;
  return { cycleCount, recentToolCalls };
}

function normalizeWpFilesOwned(input: {
  wp: WorkPackage;
  worktreePath: string;
}): { wp: WorkPackage; fields: NormalizedPathField[]; ambiguousFields: NormalizedPathField[] } {
  const packageRoots = discoverPackageRoots(input.worktreePath);
  const fields: NormalizedPathField[] = [];
  const rawPaths = input.wp.filesOwned.map(fileOwnedPath);
  const filesOwned = input.wp.filesOwned.map((entry, index) => {
    const rawPath = fileOwnedPath(entry);
    const result = normalizeRepoRelativePath({
      rawPath,
      worktreePath: input.worktreePath,
      packageRoots,
      referencePaths: rawPaths,
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
    if (typeof entry === 'string') return result.path;
    return { ...entry, path: result.path };
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
    ...input.wp.filesOwned.map(fileOwnedPath),
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

function wpRelevantExecutableChecks(input: {
  acceptanceContract?: AcceptanceContract;
  verificationCommands?: ExecutableCheck[];
  filesOwned: string[];
}): ExecutableCheck[] {
  const fromCriteria =
    input.acceptanceContract?.criteria.flatMap((criterion) => criterion.executableChecks ?? []) ??
    [];
  const candidates = [...fromCriteria, ...(input.verificationCommands ?? [])];
  const seen = new Set<string>();
  return candidates.filter((check) => {
    if (!commandMentionsWpFile(check.command, input.filesOwned)) return false;
    const key = `${check.id}\0${check.command}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildCodeSnippets(input: {
  worktreePath: string;
  filesOwned: string[];
  maxChars?: number;
}): CodeSnippet[] {
  const maxChars = input.maxChars ?? 6_000;
  const maxPerFile = 1_500;
  const snippets: CodeSnippet[] = [];
  let remaining = maxChars;
  for (const path of input.filesOwned) {
    if (remaining <= 0) break;
    const abs = `${input.worktreePath}/${path}`;
    if (!existsSync(abs)) continue;
    const content = readFileSync(abs, 'utf8');
    const slice = content.slice(0, Math.min(maxPerFile, remaining));
    if (slice.trim().length === 0) continue;
    snippets.push({
      path,
      label: 'owned file preview',
      content: slice,
      ...(slice.length < content.length ? { truncated: true } : {}),
    });
    remaining -= slice.length;
  }
  return snippets;
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
  if (opts.verifyWorktreeDependenciesFn != null) {
    try {
      opts.verifyWorktreeDependenciesFn(opts.scratchWorktreePath);
    } catch (err) {
      const reason =
        err instanceof Error
          ? err.message
          : 'worktree dependencies unavailable: verification tooling not resolvable';
      opts.appendEvent({
        projectId,
        workItemId: workItemId ?? null,
        kind: 'parallel-implement.wp-failed',
        payload: {
          wpId: wp.id,
          wpRunId,
          errorReason: reason,
          failureKind: 'terminal-blocker',
          decisionKind: 'BLOCKER',
        },
        runId: wpRunId,
      });
      opts.recordIterationFn(runId, wp.id, iteration, 'failed', reason);
      return {
        status: 'failed',
        wpId: wp.id,
        errorReason: reason,
        runId: wpRunId,
        acceptanceFailure: { kind: 'terminal-blocker', reason, decisionKind: 'BLOCKER' },
      };
    }
  }
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
  const wpFilePaths = wp.filesOwned.map(fileOwnedPath);
  const codeSnippets = buildCodeSnippets({
    worktreePath: opts.scratchWorktreePath,
    filesOwned: wpFilePaths,
  });
  const codeContext =
    opts.investigation == null
      ? []
      : buildCodeContextBundle({
          worktreePath: opts.scratchWorktreePath,
          keyFiles: opts.investigation.keyFiles.filter((file) => wpFilePaths.includes(file.path)),
        });
  const verificationCommands = wpRelevantExecutableChecks({
    acceptanceContract: opts.acceptanceContract,
    verificationCommands: opts.verificationCommands,
    filesOwned: wpFilePaths,
  });
  opts.appendEvent({
    projectId,
    workItemId: workItemId ?? null,
    kind: 'parallel-implement.wp-context-assembled',
    payload: {
      schemaVersion: 1,
      pipelineRunId: opts.pipelineRunId ?? runId,
      devRunId: runId,
      wpId: wp.id,
      wpRunId,
      iteration,
      counts: {
        ownedFiles: wpFilePaths.length,
        newOwnedFiles: wp.filesOwned.filter((file) => fileOwnedStatus(file) === 'new').length,
        codeSnippets: codeSnippets.length,
        codeContextEntries: codeContext.length,
        specContracts: opts.specContext?.interfaceContracts.length ?? 0,
        relevantAcceptanceCriteria: opts.acceptanceContract?.criteria.length ?? 0,
        verificationCommands: verificationCommands.length,
        referenceFiles: 0,
      },
    },
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
        filesOwned: wpFilePaths,
        changes: wp.changes,
        dependsOn: wp.dependsOn,
      },
      ...(codeSnippets.length > 0 ? { codeSnippets } : {}),
      ...(codeContext.length > 0 ? { codeContext } : {}),
      ...(opts.specContext != null ? { specContext: opts.specContext } : {}),
      ...(verificationCommands.length > 0 ? { verificationCommands } : {}),
      investigation: opts.investigation,
      acceptanceContract: opts.acceptanceContract,
      parentPrdContext:
        opts.parentPrdContext != null
          ? {
              source: opts.parentPrdContext.source,
              parentWorkItemId: opts.parentPrdContext.parentWorkItemId,
              prdRunId: opts.parentPrdContext.prdRunId,
              title: opts.parentPrdContext.title,
              problem: opts.parentPrdContext.problem,
              proposedSolution: opts.parentPrdContext.proposedSolution,
              outOfScope: opts.parentPrdContext.outOfScope,
              successCriteria: opts.parentPrdContext.successCriteria,
              acceptanceCriteria: opts.parentPrdContext.acceptanceCriteria,
              journeys: opts.parentPrdContext.journeys,
              functionalSpec: opts.parentPrdContext.functionalSpec,
              verticalSlices: opts.parentPrdContext.verticalSlices,
              implementationDecisions: opts.parentPrdContext.implementationDecisions,
              testingDecisions: opts.parentPrdContext.testingDecisions,
              ...(opts.parentPrdContext.artifactRef != null && {
                artifactRef: opts.parentPrdContext.artifactRef,
              }),
            }
          : undefined,
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
      'codeSnippets',
      'codeContext',
      'specContext',
      'verificationCommands',
      'investigation',
      'acceptanceContract',
      'parentPrdContext',
      'stack.testCommand',
      'stack.lintCommand',
      'stack.typecheckCommand',
    ],
    freshContext: false,
    toolBundles: ['dev-tools'],
    toolExtras: [],
    budgets: { ...opts.budgets, timeoutMs: opts.wpTimeoutMs },
    budgetPolicy: { onPostRunExceeded: 'return-output' },
    modelOverride: opts.modelOverride,
    personaId: opts.personaId,
    outputJsonSchema: opts.implementWpJsonSchema,
    appendSystemPrompt: opts.implementWpPrompt,
    sandboxMode: 'preconfigured', // writeWpBuilderSandbox already ran in workflow.ts before spawn
    env: {
      FACTORY_WP_FILESOWNED: wpFilePaths.join(':'),
      FACTORY_WP_ID: wp.id,
    },
  };

  // Write WP sandbox fresh for each spawn attempt (covers retries and preserves
  // decision-capture hook when experimental.recordDecisionTool is enabled).
  writeWpBuilderSandbox(opts.scratchWorktreePath, wpFilePaths, wp.id, {
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
    opts.revertWpChangesFn(opts.scratchWorktreePath, wp.filesOwned.map(fileOwnedPath));
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
    opts.revertWpChangesFn(opts.scratchWorktreePath, wp.filesOwned.map(fileOwnedPath));
    opts.recordIterationFn(runId, wp.id, iteration, 'failed', errorReason ?? 'unknown');
    return { status: 'failed', wpId: wp.id, errorReason: errorReason ?? 'unknown', runId: wpRunId };
  }

  const runEvents = mergeRuntimeAndDurableEvents(
    result.events,
    eventStore.replay({ runId: wpRunId }),
  );

  const loopDiagnosis = editTestLoopDiagnosis({
    events: runEvents,
    maxCycles: opts.implementWpControl?.editTestLoopMaxCycles ?? 3,
  });
  if (loopDiagnosis != null) {
    opts.appendEvent({
      projectId,
      workItemId: workItemId ?? null,
      kind: 'parallel-implement.wp-loop-cap-hit',
      payload: {
        schemaVersion: 1,
        pipelineRunId: opts.pipelineRunId ?? runId,
        devRunId: runId,
        wpId: wp.id,
        wpRunId,
        iteration,
        cycleCount: loopDiagnosis.cycleCount,
        maxCycles: opts.implementWpControl?.editTestLoopMaxCycles ?? 3,
        recentToolCalls: loopDiagnosis.recentToolCalls,
        diagnosis: 'edit-test-loop-cap-exceeded',
      },
      runId: wpRunId,
    });
    opts.appendEvent({
      projectId,
      workItemId: workItemId ?? null,
      kind: 'parallel-implement.wp-failed',
      payload: { wpId: wp.id, wpRunId, errorReason: 'edit-test-loop-cap-exceeded' },
      runId: wpRunId,
    });
    opts.revertWpChangesFn(opts.scratchWorktreePath, wp.filesOwned.map(fileOwnedPath));
    opts.recordIterationFn(runId, wp.id, iteration, 'failed', 'edit-test-loop-cap-exceeded');
    return {
      status: 'failed',
      wpId: wp.id,
      errorReason: 'edit-test-loop-cap-exceeded',
      runId: wpRunId,
    };
  }

  const parsed = safeParseOutputForSchema(ImplementWpSchema, result.output);
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
    opts.revertWpChangesFn(opts.scratchWorktreePath, wp.filesOwned.map(fileOwnedPath));
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
    opts.revertWpChangesFn(opts.scratchWorktreePath, wp.filesOwned.map(fileOwnedPath));
    opts.recordIterationFn(runId, wp.id, iteration, 'failed', reason);
    return { status: 'failed', wpId: wp.id, errorReason: reason, runId: wpRunId };
  }
  const output = ImplementWpSchema.parse(normalized.output);
  reconcileDecisionSummaries(
    wpRunId,
    projectId,
    workItemId ?? null,
    'implement-wp',
    output.decisionSummaries,
  );

  const acceptanceFailure = implementWpAcceptanceFailure({
    output,
    events: runEvents,
    verificationRequired:
      output.testsWritten.length > 0 ||
      output.testsRun.paths.length > 0 ||
      verificationCommands.length > 0,
  });
  if (acceptanceFailure != null) {
    opts.appendEvent({
      projectId,
      workItemId: workItemId ?? null,
      kind: 'parallel-implement.wp-failed',
      payload: {
        wpId: wp.id,
        wpRunId,
        errorReason: acceptanceFailure.reason,
        failureKind: acceptanceFailure.kind,
        ...(acceptanceFailure.kind === 'terminal-blocker'
          ? { decisionKind: acceptanceFailure.decisionKind }
          : {}),
        confidence: output.confidence,
        testsWritten: output.testsWritten.map((test) => test.path),
        testsRun: output.testsRun.paths,
      },
      runId: wpRunId,
    });
    opts.revertWpChangesFn(opts.scratchWorktreePath, wp.filesOwned.map(fileOwnedPath));
    opts.recordIterationFn(runId, wp.id, iteration, 'failed', acceptanceFailure.reason);
    return {
      status: 'failed',
      wpId: wp.id,
      errorReason: acceptanceFailure.reason,
      runId: wpRunId,
      acceptanceFailure,
    };
  }

  // Build succeeded — return files for the serial commit phase.
  const commitMsg = `M:${wp.id} ${wp.changes.slice(0, 60)}\n\nBuilt by ${opts.personaId}`;
  return {
    status: 'built',
    wp,
    parsedFilesWritten: output.filesWritten,
    wpRunId,
    commitMsg,
    scratchWorktreePath: opts.scratchWorktreePath,
    ...(result.budgetExceeded != null ? { budgetExceeded: result.budgetExceeded } : {}),
  };
}
