import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { AcceptanceContract } from '@goose-hub/core/acceptance-contracts/types.js';
import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import type { CodeContextEntry } from '@goose-hub/core/agent-runtime/code-context.js';
import { hasEvidenceBlockerDecision } from '@goose-hub/core/agent-runtime/evidence-blocker.js';
import { storeGateFailureArtifact } from '@goose-hub/core/agent-runtime/gate-failure-artifacts.js';
import { groundedOutputToolUseFailure } from '@goose-hub/core/agent-runtime/grounded-output-guard.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import {
  type InvestigationContext,
  latestInvestigationContext,
  pathsTouchInvestigationSurface,
  toolCallsTouchInvestigationSurface,
} from '@goose-hub/core/agent-runtime/investigation-context.js';
import type { ModelTier } from '@goose-hub/core/agent-runtime/models.js';
import { reconcileDecisionSummaries } from '@goose-hub/core/agent-runtime/reconcile-decisions.js';
import {
  type RelatedSurfaceManifest,
  discoveryCallsRepeatRelatedSurface,
} from '@goose-hub/core/agent-runtime/related-surface.js';
import { recordAgentRun } from '@goose-hub/core/agent-runtime/run-record.js';
import { selectRuntime } from '@goose-hub/core/agent-runtime/select-runtime.js';
import { resolveSkillRuntimeForProject } from '@goose-hub/core/agent-runtime/skill-runtime-resolver.js';
import { runWithEscalation } from '@goose-hub/core/agent-runtime/with-escalation.js';
import { openLocalDbPR, type openPR } from '@goose-hub/core/connectors/github/open-pr.js';
import { getEvidencePostEnabled } from '@goose-hub/core/db/repositories/project-settings.js';
import { emitStateTransitionEvent } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { upsertGithubExternalRef } from '@goose-hub/core/integrations/github/external-refs.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { LocalDbWorkItemRepository } from '@goose-hub/core/state-source/local-db-repository.js';
import {
  emitSymbolIndexHintsUsedEvent,
  offeredHintsFromSymbolKeyFiles,
} from '@goose-hub/core/symbol-index/hints-used.js';
import type { SymbolKeyFileHint } from '@goose-hub/core/symbol-index/lookup.js';
import { canonicalPathStringFromAuditPayload } from '@goose-hub/core/tool-layer/tool-call-audit.js';
import { deriveObservedChangedFiles } from '@goose-hub/core/workspaces/observed-changes.js';
import type { orchestratorCommitAll } from '@goose-hub/core/workspaces/orchestrator-git.js';
import {
  type RepoRelativePathNormalization,
  discoverPackageRoots,
  normalizeRepoRelativePath,
} from '@goose-hub/core/workspaces/path-normalization.js';
import { ImplementSchema } from '@goose-hub/skills/implement/schema.js';
import { buildPrBody, runEvidencePost } from './pr-helpers.js';
import type { ImplementOutputShape } from './types.js';

export type { ImplementOutputShape } from './types.js';

export interface RunImplementInput {
  execution: ImplementExecution;
  runId: string;
  projectId: string;
  workItem: WorkItem;
  worktreePath: string;
  stack: {
    packageManager?: string;
    installCommand?: string[];
    testCommand: string;
    lintCommand?: string;
    typecheckCommand?: string;
    e2eCommand?: string;
  };
  appendSystemPrompt: string;
  outputJsonSchema: Record<string, unknown>;
  personaId: string;
  advisorFeedback?: string;
  investigation?: InvestigationContext;
  codeContext?: CodeContextEntry[];
  relatedSurface?: RelatedSurfaceManifest;
  surfaceGuardInvestigation?: InvestigationContext;
  symbolIndexKeyFiles?: SymbolKeyFileHint[];
  acceptanceContract?: AcceptanceContract | null;
  revisionPass?: 0 | 1;
}

export interface ImplementExecution {
  runtime: AgentRuntime;
  projectConfig: Awaited<ReturnType<typeof getProjectBySlug>>;
  budgets: ReturnType<typeof resolveSkillRuntimeForProject>['budgets'];
  modelOverride: string;
  selectedTier: ModelTier;
  selectionReason: string;
}

export interface AfterImplementInput {
  implementOutput: ImplementOutputShape;
  workItem: WorkItem;
  stateSource: StateSource;
  projectId: string;
  targetRepo: string;
  runId: string;
  worktreePath: string;
  baseBranch: string;
  openPRFn: typeof openPR;
  evidenceRuntime?: AgentRuntime;
  evidencePostPrompt: string;
  evidencePostJsonSchema: Record<string, unknown>;
  resolveHeadShaFn: (worktreePath: string) => string;
  /** Orchestrator commits before openPR (ADR 0031 — builder no-commit rule). */
  orchestratorCommitFn: typeof orchestratorCommitAll;
}

export { latestInvestigationContext };

type NormalizedPathField = {
  field: string;
  from: string;
  to: string;
  source: RepoRelativePathNormalization['source'];
  ambiguous?: string[];
};

const WRITE_TOOL_NAMES = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'write',
  'edit',
  'write_file',
  'edit_file',
]);
const FACT_MISMATCH_PATH_LIMIT = 25;
const CONTRACT_GATE_PATH_LIMIT = 10;

function uniqueSorted(paths: string[]): string[] {
  return [...new Set(paths)].sort((a, b) => a.localeCompare(b));
}

function compactPaths(paths: string[]): { count: number; paths: string[]; truncated: boolean } {
  const unique = uniqueSorted(paths);
  return {
    count: unique.length,
    paths: unique.slice(0, FACT_MISMATCH_PATH_LIMIT),
    truncated: unique.length > FACT_MISMATCH_PATH_LIMIT,
  };
}

function stripEventPathDecorators(value: string): string {
  let next = value.trim();
  while (
    next.length >= 2 &&
    ((next.startsWith('"') && next.endsWith('"')) ||
      (next.startsWith("'") && next.endsWith("'")) ||
      (next.startsWith('`') && next.endsWith('`')))
  ) {
    next = next.slice(1, -1).trim();
  }
  return next.replace(/\\/g, '/');
}

function sanitizePathValueForEvent(value: string, worktreePath: string): string {
  const cleaned = stripEventPathDecorators(value);
  if (!isAbsolute(cleaned)) return cleaned;

  const resolvedWorktree = resolve(worktreePath);
  const resolvedPath = resolve(cleaned);
  const relativePath = relative(resolvedWorktree, resolvedPath).replace(/\\/g, '/');
  if (relativePath === '') return '<worktree>';
  if (relativePath === '..' || relativePath.startsWith('../')) return '<outside-worktree>';
  return `<worktree>/${relativePath}`;
}

function compactNormalizedFields(
  fields: NormalizedPathField[],
  worktreePath: string,
): Array<{
  field: string;
  rawValue: string;
  normalizedValue: string;
  source: RepoRelativePathNormalization['source'];
  candidates?: { count: number; paths: string[]; truncated: boolean };
}> {
  return fields.map((field) => ({
    field: field.field,
    rawValue: sanitizePathValueForEvent(field.from, worktreePath),
    normalizedValue: field.to,
    source: field.source,
    ...(field.ambiguous != null && {
      candidates: {
        count: field.ambiguous.length,
        paths: uniqueSorted(field.ambiguous).slice(0, CONTRACT_GATE_PATH_LIMIT),
        truncated: field.ambiguous.length > CONTRACT_GATE_PATH_LIMIT,
      },
    }),
  }));
}

function isWriteOrEditToolName(value: unknown): boolean {
  return typeof value === 'string' && WRITE_TOOL_NAMES.has(value);
}

function observedWritePathsFromToolAudit(runId: string): string[] {
  const events = eventStore.replay({ runId, kind: 'agent.tool-call' });
  const paths: string[] = [];
  for (const event of events) {
    const payload = event.payload as Record<string, unknown> | null;
    if (payload == null || !isWriteOrEditToolName(payload.tool_name ?? payload.tool)) continue;
    const path = canonicalPathStringFromAuditPayload(payload);
    if (path != null) paths.push(path);
  }
  return uniqueSorted(paths);
}

function emitOutputFactMismatch(input: {
  projectId: string;
  workItemId: string;
  runId: string;
  personaId?: string;
  implementOutput: ImplementOutputShape;
  observedChangedPaths: string[];
  observedWritePaths: string[];
}): void {
  const modelDeclaredFiles = uniqueSorted([
    ...input.implementOutput.filesWritten.map((file) => file.path),
    ...input.implementOutput.testsWritten.map((test) => test.path),
  ]);
  const observedFiles = uniqueSorted([...input.observedChangedPaths, ...input.observedWritePaths]);
  if (observedFiles.length === 0) return;

  const declared = new Set(modelDeclaredFiles);
  const observed = new Set(observedFiles);
  const observedNotDeclared = observedFiles.filter((path) => !declared.has(path));
  const declaredNotObserved = modelDeclaredFiles.filter((path) => !observed.has(path));
  if (observedNotDeclared.length === 0 && declaredNotObserved.length === 0) return;

  eventStore.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'agent.output-fact-mismatch',
    payload: {
      runId: input.runId,
      skill: 'implement',
      observedChangedFiles: compactPaths(input.observedChangedPaths),
      observedWriteFiles: compactPaths(input.observedWritePaths),
      modelDeclaredFiles: compactPaths(modelDeclaredFiles),
      mismatches: {
        observedNotDeclared: compactPaths(observedNotDeclared),
        declaredNotObserved: compactPaths(declaredNotObserved),
      },
    },
    runId: input.runId,
    personaId: input.personaId,
  });
}

function emitOutputRepaired(input: {
  projectId: string;
  workItemId: string;
  runId: string;
  personaId?: string;
  worktreePath: string;
  fields: NormalizedPathField[];
  observedChangedPaths: string[];
  observedWritePaths: string[];
}): void {
  if (input.fields.length === 0) return;
  eventStore.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'agent.output-repaired',
    payload: {
      runId: input.runId,
      skill: 'implement',
      gate: 'implement-output-repair',
      fields: compactNormalizedFields(input.fields, input.worktreePath),
      observedChangedFiles: compactPaths(input.observedChangedPaths),
      observedWriteFiles: compactPaths(input.observedWritePaths),
    },
    runId: input.runId,
    personaId: input.personaId,
  });
}

function emitContractGateBlocked(input: {
  projectId: string;
  workItemId: string;
  runId: string;
  personaId?: string;
  gate: string;
  worktreePath: string;
  reason: string;
  fields: NormalizedPathField[];
  observedChangedPaths: string[];
  observedWritePaths: string[];
}): void {
  eventStore.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'agent.contract-gate-blocked',
    payload: {
      runId: input.runId,
      skill: 'implement',
      gate: input.gate,
      reason: input.reason,
      fields: compactNormalizedFields(input.fields, input.worktreePath),
      observedChangedFiles: compactPaths(input.observedChangedPaths),
      observedWriteFiles: compactPaths(input.observedWritePaths),
    },
    runId: input.runId,
    personaId: input.personaId,
  });
}

function evaluateImplementOutputRepairGate(input: {
  projectId: string;
  workItemId: string;
  runId: string;
  personaId?: string;
  worktreePath: string;
  fields: NormalizedPathField[];
  observedChangedPaths: string[];
  observedWritePaths: string[];
}): void {
  const ambiguousFields = input.fields.filter(
    (field) => field.ambiguous != null && field.ambiguous.length > 0,
  );
  if (ambiguousFields.length > 0) {
    emitContractGateBlocked({
      ...input,
      gate: 'implement-output-repair',
      reason: 'ambiguous-path-repair',
      fields: ambiguousFields,
    });
    const fieldNames = ambiguousFields.map((field) => field.field).join(', ');
    throw new Error(
      `contract gate blocked: ambiguous implement output path repair (${fieldNames})`,
    );
  }

  emitOutputRepaired(input);
}

function hasEvidenceBlockerSummary(output: ImplementOutputShape): boolean {
  return hasEvidenceBlockerDecision(output.decisionSummaries);
}

function hasTargetedFrontendUnitTests(output: ImplementOutputShape): boolean {
  const runPaths = new Set(output.testsRun.paths);
  return output.testsWritten.some(
    (test) =>
      test.path.startsWith('apps/web/') &&
      !test.path.startsWith('apps/web/e2e/') &&
      runPaths.has(test.path),
  );
}

function isEvidenceSpecPath(path: string): boolean {
  return /^apps\/web\/e2e\/.*\.spec\.ts$/.test(path);
}

function evaluateObservedWritesGate(input: {
  projectId: string;
  workItemId: string;
  runId: string;
  personaId?: string;
  worktreePath: string;
  output: ImplementOutputShape;
  observedChangedPaths: string[];
  observedWritePaths: string[];
  observedGitAvailable: boolean;
  hasSurfaceGuard: boolean;
}): void {
  const reportsCodeChange =
    input.output.filesWritten.length > 0 || input.output.testsWritten.length > 0;
  if (!reportsCodeChange) return;
  if (!input.observedGitAvailable) return;
  if (input.hasSurfaceGuard) return;
  if (input.observedChangedPaths.length > 0 || input.observedWritePaths.length > 0) return;
  emitContractGateBlocked({
    projectId: input.projectId,
    workItemId: input.workItemId,
    runId: input.runId,
    personaId: input.personaId,
    gate: 'implement-observed-writes',
    worktreePath: input.worktreePath,
    reason: 'no-observed-writes-for-code-change',
    fields: [],
    observedChangedPaths: input.observedChangedPaths,
    observedWritePaths: input.observedWritePaths,
  });
  throw new Error('contract gate blocked: no observed writes for implement code-change task');
}

function evaluateEvidenceRequirementGate(input: {
  projectId: string;
  workItemId: string;
  runId: string;
  personaId?: string;
  worktreePath: string;
  output: ImplementOutputShape;
  observedChangedPaths: string[];
  observedWritePaths: string[];
  evidencePostEnabled: boolean;
}): void {
  if (!input.evidencePostEnabled) return;

  const modelDeclaredPaths = [
    ...input.output.filesWritten.map((file) => file.path),
    ...input.output.testsWritten.map((test) => test.path),
  ];
  const frontendPaths = uniqueSorted([...input.observedChangedPaths, ...modelDeclaredPaths]).filter(
    (path) => path.startsWith('apps/web/'),
  );
  const evidenceBlockerSummary = hasEvidenceBlockerSummary(input.output);
  const frontendUnitTestsCoverEvidence = hasTargetedFrontendUnitTests(input.output);

  if (
    frontendPaths.length > 0 &&
    input.output.evidenceSpecPath == null &&
    !evidenceBlockerSummary &&
    !frontendUnitTestsCoverEvidence
  ) {
    emitContractGateBlocked({
      projectId: input.projectId,
      workItemId: input.workItemId,
      runId: input.runId,
      personaId: input.personaId,
      gate: 'evidence-requirement',
      worktreePath: input.worktreePath,
      reason: 'missing-evidence-spec',
      fields: [
        {
          field: 'evidenceSpecPath',
          from: 'null',
          to: 'null',
          source: 'unresolved',
        },
      ],
      observedChangedPaths: input.observedChangedPaths,
      observedWritePaths: input.observedWritePaths,
    });
    throw new Error(
      `contract gate blocked: evidenceSpecPath is required for apps/web changes (${frontendPaths.join(
        ', ',
      )})`,
    );
  }

  if (input.output.evidenceSpecPath != null) {
    const evidenceSpecPath = input.output.evidenceSpecPath;
    if (!isEvidenceSpecPath(evidenceSpecPath)) {
      emitContractGateBlocked({
        projectId: input.projectId,
        workItemId: input.workItemId,
        runId: input.runId,
        personaId: input.personaId,
        gate: 'evidence-requirement',
        worktreePath: input.worktreePath,
        reason: 'evidence-spec-not-playwright-e2e',
        fields: [
          {
            field: 'evidenceSpecPath',
            from: evidenceSpecPath,
            to: evidenceSpecPath,
            source: 'as-is',
          },
        ],
        observedChangedPaths: input.observedChangedPaths,
        observedWritePaths: input.observedWritePaths,
      });
      throw new Error(
        `contract gate blocked: evidenceSpecPath must point to apps/web/e2e/*.spec.ts (${evidenceSpecPath})`,
      );
    }
    if (!existsSync(resolve(input.worktreePath, evidenceSpecPath))) {
      emitContractGateBlocked({
        projectId: input.projectId,
        workItemId: input.workItemId,
        runId: input.runId,
        personaId: input.personaId,
        gate: 'evidence-requirement',
        worktreePath: input.worktreePath,
        reason: 'evidence-spec-not-found',
        fields: [
          {
            field: 'evidenceSpecPath',
            from: evidenceSpecPath,
            to: evidenceSpecPath,
            source: 'as-is',
          },
        ],
        observedChangedPaths: input.observedChangedPaths,
        observedWritePaths: input.observedWritePaths,
      });
      throw new Error(
        `contract gate blocked: evidenceSpecPath does not exist (${evidenceSpecPath})`,
      );
    }
  }
}

function normalizeImplementOutputPaths(input: {
  output: ImplementOutputShape;
  worktreePath: string;
  investigation?: InvestigationContext;
  surfaceGuardInvestigation?: InvestigationContext;
}): { output: ImplementOutputShape; fields: NormalizedPathField[] } {
  const packageRoots = discoverPackageRoots(input.worktreePath);
  const referencePaths = [
    ...input.output.filesWritten.map((f) => f.path),
    ...input.output.testsWritten.map((t) => t.path),
    ...input.output.testsRun.paths,
    ...(input.output.evidenceSpecPath == null ? [] : [input.output.evidenceSpecPath]),
    ...(input.investigation?.keyFiles.map((f) => f.path) ?? []),
    ...(input.surfaceGuardInvestigation?.keyFiles.map((f) => f.path) ?? []),
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

  return {
    output: {
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
      evidenceSpecPath:
        input.output.evidenceSpecPath == null
          ? null
          : normalizeField('evidenceSpecPath', input.output.evidenceSpecPath),
    },
    fields,
  };
}

function appendWrongSurfaceGuardEvent(input: {
  projectId: string;
  workItemId: string;
  runId: string;
  personaId?: string;
  investigation: InvestigationContext;
  reason: string;
  touchedPaths?: string[];
}): void {
  eventStore.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'agent.wrong-surface-guard',
    payload: {
      runId: input.runId,
      skill: 'implement',
      reason: input.reason,
      expectedKeyFiles: input.investigation.keyFiles.map((f) => f.path),
      touchedPaths: input.touchedPaths ?? [],
      investigationRunId: input.investigation.investigationRunId ?? null,
    },
    runId: input.runId,
    personaId: input.personaId,
  });
}

export function emitWrongSurfaceGuardForRun(input: {
  projectId: string;
  workItemId: string;
  runId: string;
  personaId?: string;
  investigation?: InvestigationContext;
}): void {
  if (input.investigation == null) return;
  const runEvents = eventStore.replay({ runId: input.runId });
  if (
    toolCallsTouchInvestigationSurface({ events: runEvents, investigation: input.investigation })
  ) {
    return;
  }
  appendWrongSurfaceGuardEvent({
    ...input,
    investigation: input.investigation,
    reason: 'tool-calls-missed-investigation-surface',
  });
}

export async function resolveImplementExecution(input: {
  projectId: string;
  workItem: WorkItem;
  injectedRuntime?: AgentRuntime;
}): Promise<ImplementExecution> {
  const projectConfig = await getProjectBySlug(input.projectId);
  const configRuntime = projectConfig?.agentConfig?.runtime ?? 'auto';
  const resolvedRuntime = resolveSkillRuntimeForProject({
    skill: 'implement',
    projectBudgets: projectConfig?.budgets,
    projectId: input.projectId,
    configRuntime,
    role: 'developer',
    allowHoldoutOverride: projectConfig?.agentConfig?.allowHoldoutOverride,
  });

  if (input.injectedRuntime != null) {
    return {
      runtime: input.injectedRuntime,
      projectConfig,
      budgets: resolvedRuntime.budgets,
      modelOverride: resolvedRuntime.modelOverride,
      selectedTier: resolvedRuntime.tier,
      selectionReason: resolvedRuntime.source,
    };
  }

  const runtime = selectRuntime({
    configRuntime,
    model: resolvedRuntime.modelOverride,
    skillProvider: resolvedRuntime.provider,
  });

  return {
    runtime,
    projectConfig,
    budgets: resolvedRuntime.budgets,
    modelOverride: resolvedRuntime.modelOverride,
    selectedTier: resolvedRuntime.tier,
    selectionReason: resolvedRuntime.source,
  };
}

export async function runImplement(input: RunImplementInput): Promise<ImplementOutputShape> {
  const { execution } = input;

  eventStore.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItem.id,
    kind: 'agent.model-selected',
    payload: {
      runId: input.runId,
      skill: 'implement',
      role: 'developer',
      selectedTier: execution.selectedTier,
      reason: execution.selectionReason,
    },
    runId: input.runId,
  });
  if (input.investigation != null) {
    eventStore.appendEvent({
      projectId: input.projectId,
      workItemId: input.workItem.id,
      kind: 'agent.investigation-context-injected',
      payload: {
        runId: input.runId,
        skill: 'implement',
        investigationRunId: input.investigation.investigationRunId ?? null,
        keyFiles: input.investigation.keyFiles.map((f) => f.path),
        keyFileCount: input.investigation.keyFiles.length,
        codeContextCount: input.codeContext?.length ?? 0,
        findingsChars: input.investigation.findings?.length ?? 0,
        openQuestionCount: input.investigation.openQuestions.length,
      },
      runId: input.runId,
      personaId: input.personaId,
    });
  }
  const evidencePostEnabled = getEvidencePostEnabled(
    execution.projectConfig?.id ?? input.projectId,
    execution.projectConfig?.evidencePostEnabled ?? true,
  );

  const { output, result: agentResult } = await runWithEscalation({
    runtime: execution.runtime,
    schema: ImplementSchema,
    projectId: input.projectId,
    workItemId: input.workItem.id,
    projectBudgets: execution.projectConfig?.budgets,
    spec: {
      runId: input.runId,
      role: 'developer',
      skill: 'implement',
      workspaceDir: input.worktreePath,
      context: {
        projectId: input.projectId,
        workItemId: input.workItem.id,
        workItem: {
          title: input.workItem.title,
          body: input.workItem.body,
          number: Number(input.workItem.externalId),
          priority: input.workItem.priority,
        },
        stack: input.stack,
        investigation: input.investigation,
        codeContext: input.codeContext,
        relatedSurface: input.relatedSurface,
        acceptanceContract: input.acceptanceContract,
        advisorFeedback: input.advisorFeedback,
        revisionPass: input.revisionPass ?? 0,
        evidencePostEnabled,
      },
      contextAllowlist: [
        'workItem.title',
        'workItem.body',
        'workItem.number',
        'workItem.priority',
        'stack.packageManager',
        'stack.installCommand',
        'stack.testCommand',
        'stack.lintCommand',
        'stack.typecheckCommand',
        'stack.e2eCommand',
        'investigation',
        'codeContext',
        'relatedSurface',
        'acceptanceContract',
        'advisorFeedback',
        'revisionPass',
        'evidencePostEnabled',
      ],
      freshContext: false,
      toolBundles: ['dev-tools'],
      toolExtras: [],
      budgets: execution.budgets,
      modelOverride: execution.modelOverride,
      personaId: input.personaId,
      outputJsonSchema: input.outputJsonSchema,
      appendSystemPrompt: input.appendSystemPrompt,
    },
  });
  const implementToolEvents = [...agentResult.events, ...eventStore.replay({ runId: input.runId })];
  const groundingFailure = groundedOutputToolUseFailure({
    skill: 'implement',
    events: implementToolEvents,
    allowMissingAudit: true,
  });
  if (groundingFailure != null) {
    const artifactRef = storeGateFailureArtifact({
      projectId: input.projectId,
      workItemId: input.workItem.id,
      runId: input.runId,
      skill: 'implement',
      gate: groundingFailure.reason,
      rawOutput: agentResult.output,
      issues: [{ path: 'agent.tool-call', message: groundingFailure.message }],
    });
    emitContractGateBlocked({
      projectId: input.projectId,
      workItemId: input.workItem.id,
      runId: input.runId,
      personaId: input.personaId,
      gate: 'implement-grounded-output',
      worktreePath: input.worktreePath,
      reason: groundingFailure.reason,
      fields: [],
      observedChangedPaths: [],
      observedWritePaths: [],
    });
    eventStore.appendEvent({
      projectId: input.projectId,
      workItemId: input.workItem.id,
      kind: 'agent.run-failed',
      payload: {
        runId: input.runId,
        skill: 'implement',
        error: groundingFailure.message,
        reason: groundingFailure.reason,
        ...(artifactRef != null ? { artifactRef } : {}),
      },
      runId: input.runId,
      personaId: input.personaId,
    });
    recordAgentRun({
      runId: input.runId,
      personaId: input.personaId,
      workItemId: input.workItem.id,
      projectId: input.projectId,
      role: 'developer',
      skill: 'implement',
      outcome: 'failure',
    });
    throw new Error(`contract gate blocked: ${groundingFailure.message}`);
  }
  emitSymbolIndexHintsUsedEvent({
    projectId: input.projectId,
    workItemId: input.workItem.id,
    consumerSkill: 'implement',
    runId: input.runId,
    personaId: input.personaId,
    offeredHints: offeredHintsFromSymbolKeyFiles(input.symbolIndexKeyFiles ?? []),
    toolEvents: eventStore.replay({ runId: input.runId, kind: 'agent.tool-call' }),
    worktreePath: input.worktreePath,
    appendEvent: (event) => eventStore.appendEvent(event),
  });
  if (
    discoveryCallsRepeatRelatedSurface({
      relatedSurface: input.relatedSurface,
      toolEvents: eventStore.replay({ runId: input.runId, kind: 'agent.tool-call' }),
    })
  ) {
    eventStore.appendEvent({
      projectId: input.projectId,
      workItemId: input.workItem.id,
      kind: 'agent.discovery-budget-exceeded',
      payload: {
        runId: input.runId,
        skill: 'implement',
        checkedAbsentCount: input.relatedSurface?.checkedAbsent.length ?? 0,
      },
      runId: input.runId,
      personaId: input.personaId,
    });
  }
  const normalized = normalizeImplementOutputPaths({
    output,
    worktreePath: input.worktreePath,
    investigation: input.investigation,
    surfaceGuardInvestigation: input.surfaceGuardInvestigation,
  });
  const observedChangedFiles = deriveObservedChangedFiles(input.worktreePath);
  const observedWritePaths = observedWritePathsFromToolAudit(input.runId);
  evaluateObservedWritesGate({
    projectId: input.projectId,
    workItemId: input.workItem.id,
    runId: input.runId,
    personaId: input.personaId,
    worktreePath: input.worktreePath,
    output: normalized.output,
    observedChangedPaths: observedChangedFiles.paths,
    observedWritePaths,
    observedGitAvailable: observedChangedFiles.gitAvailable,
    hasSurfaceGuard: (input.surfaceGuardInvestigation ?? input.investigation) != null,
  });
  evaluateImplementOutputRepairGate({
    projectId: input.projectId,
    workItemId: input.workItem.id,
    runId: input.runId,
    personaId: input.personaId,
    worktreePath: input.worktreePath,
    fields: normalized.fields,
    observedChangedPaths: observedChangedFiles.paths,
    observedWritePaths,
  });
  evaluateEvidenceRequirementGate({
    projectId: input.projectId,
    workItemId: input.workItem.id,
    runId: input.runId,
    personaId: input.personaId,
    worktreePath: input.worktreePath,
    output: normalized.output,
    observedChangedPaths: observedChangedFiles.paths,
    observedWritePaths,
    evidencePostEnabled,
  });
  const implementOutput = ImplementSchema.parse(normalized.output);
  const modelTouchedPaths = [
    ...implementOutput.filesWritten.map((f) => f.path),
    ...implementOutput.testsWritten.map((t) => t.path),
    ...implementOutput.testsRun.paths,
  ];
  emitOutputFactMismatch({
    projectId: input.projectId,
    workItemId: input.workItem.id,
    runId: input.runId,
    personaId: input.personaId,
    implementOutput,
    observedChangedPaths: observedChangedFiles.paths,
    observedWritePaths,
  });
  const surfaceGuardInvestigation = input.surfaceGuardInvestigation ?? input.investigation;
  if (surfaceGuardInvestigation == null) return implementOutput;

  if (observedChangedFiles.paths.length > 0) {
    if (pathsTouchInvestigationSurface(observedChangedFiles.paths, surfaceGuardInvestigation)) {
      return implementOutput;
    }
    appendWrongSurfaceGuardEvent({
      projectId: input.projectId,
      workItemId: input.workItem.id,
      runId: input.runId,
      personaId: input.personaId,
      investigation: surfaceGuardInvestigation,
      reason: 'observed-changes-missed-investigation-surface',
      touchedPaths: observedChangedFiles.paths,
    });
    throw new Error(
      `wrong surface guard: observed changes did not touch investigated key files (${surfaceGuardInvestigation.keyFiles
        .map((f) => f.path)
        .join(', ')})`,
    );
  }

  if (observedChangedFiles.gitAvailable) {
    appendWrongSurfaceGuardEvent({
      projectId: input.projectId,
      workItemId: input.workItem.id,
      runId: input.runId,
      personaId: input.personaId,
      investigation: surfaceGuardInvestigation,
      reason: 'no-observed-changed-files',
      touchedPaths: [],
    });
    throw new Error(
      `wrong surface guard: no observed changed files for investigated key files (${surfaceGuardInvestigation.keyFiles
        .map((f) => f.path)
        .join(', ')})`,
    );
  }

  if (!pathsTouchInvestigationSurface(modelTouchedPaths, surfaceGuardInvestigation)) {
    appendWrongSurfaceGuardEvent({
      projectId: input.projectId,
      workItemId: input.workItem.id,
      runId: input.runId,
      personaId: input.personaId,
      investigation: surfaceGuardInvestigation,
      reason: 'reported-output-missed-investigation-surface',
      touchedPaths: modelTouchedPaths,
    });
    throw new Error(
      `wrong surface guard: reported output did not touch investigated key files (${surfaceGuardInvestigation.keyFiles
        .map((f) => f.path)
        .join(', ')})`,
    );
  }
  return implementOutput;
}

export async function afterImplement(input: AfterImplementInput): Promise<void> {
  const { implementOutput, workItem, stateSource, projectId, runId, worktreePath } = input;
  const stateSourceItemId = workItem.id.startsWith('local:') ? workItem.id : workItem.externalId;
  const observedChangedFiles = deriveObservedChangedFiles(worktreePath);

  // Orchestrator commits the builder's work before opening the PR (ADR 0031).
  // The implement skill writes files but no longer commits; this call stages
  // all changes and creates a single commit attributed to the workflow run.
  const commitResult = input.orchestratorCommitFn(
    worktreePath,
    `fix(#${workItem.externalId}): ${workItem.title.slice(0, 60)}`,
  );
  if (commitResult.status === 'no-changes') {
    throw new Error('implement produced no commit changes');
  }

  // Emit implement decision summaries (#206 pattern).
  reconcileDecisionSummaries(
    runId,
    projectId,
    workItem.id,
    'implement',
    implementOutput.decisionSummaries,
  );
  eventStore.appendEvent({
    projectId,
    workItemId: workItem.id,
    kind: 'agent.implement-complete',
    payload: {
      filesWritten: implementOutput.filesWritten.length,
      testsWritten: implementOutput.testsWritten.length,
      confidence: implementOutput.confidence,
      // #467 — preserved verbatim so QA's workflow can pull dev's targeted
      // test command + paths into its context as `devTestsRun` and bucket
      // full-suite failures as inside- vs outside-targeted.
      testsRun: implementOutput.testsRun,
      observedChangedFiles: {
        count: observedChangedFiles.count,
        paths: observedChangedFiles.paths,
      },
    },
    runId,
  });

  // Step 5: open PR.
  const token = process.env.GITHUB_TOKEN ?? '';
  if (token.length === 0 && process.env.MOCK_OPEN_PR !== 'true') {
    throw new Error('GITHUB_TOKEN env var is required to open PR');
  }
  const linkedIssueRef = workItem.id.startsWith('local:')
    ? latestLinkedGithubIssue(projectId, workItem.id)
    : null;
  const repoRef = linkedIssueRef?.repoRef ?? workItem.repoRef ?? stateSource.repoRef;
  const branchName = `factory/${runId}`;
  const title = `M7.XX: ${workItem.title.slice(0, 50)}`;
  const closesIssueNumber =
    linkedIssueRef != null ? Number(linkedIssueRef.externalId) : Number(workItem.externalId);
  const shouldCloseGithubIssue =
    Number.isFinite(closesIssueNumber) &&
    (linkedIssueRef != null || !workItem.id.startsWith('local:'));
  const body = buildPrBody({
    workItem,
    implementOutput,
    observedChangedFiles,
    closesIssueNumber: shouldCloseGithubIssue ? closesIssueNumber : null,
  });

  const prResult = shouldCloseGithubIssue
    ? await input.openPRFn({
        worktreePath,
        repo: repoRef,
        issueNumber: closesIssueNumber,
        title,
        body,
        branchName,
        baseBranch: input.baseBranch,
        token,
      })
    : await openLocalDbPR({
        worktreePath,
        repo: repoRef,
        title,
        body,
        branchName,
        baseBranch: input.baseBranch,
        token,
      });

  if (workItem.id.startsWith('local:')) {
    upsertGithubExternalRef({
      projectId,
      workItemId: workItem.id,
      kind: 'pull_request',
      repoRef,
      externalId: String(prResult.prNumber),
      url: prResult.prUrl,
    });
    upsertGithubExternalRef({
      projectId,
      workItemId: workItem.id,
      kind: 'branch',
      repoRef,
      externalId: prResult.branch,
    });
  }

  eventStore.appendEvent({
    projectId,
    workItemId: workItem.id,
    kind: 'pr.opened',
    payload: {
      prNumber: prResult.prNumber,
      prUrl: prResult.prUrl,
      branch: prResult.branch,
      baseBranch: prResult.base,
      worktreePath,
      devRunId: runId,
      // Legacy fix-issue has a single developer run, so the delivery
      // lifecycle intentionally aliases the dev run id for M19 scoring.
      pipelineRunId: runId,
    },
    runId,
  });

  await stateSource.comment(
    stateSourceItemId,
    buildAgentComment(
      'Dev',
      'Complete',
      `PR #${prResult.prNumber} opened — transitioning to needs-qa`,
      [`PR: ${prResult.prUrl}`],
    ),
  );

  // Step 6: evidence-post wiring (#234) — best-effort.
  // Resolve the worktree HEAD to the real commit SHA so evidence-post pins
  // its raw URLs to an immutable ref (#233 SHA-pinning contract).
  const prHeadSha = input.resolveHeadShaFn(worktreePath);

  // Look up the BEFORE-state comment posted by playwright-repro during
  // investigation (type:bug only). Absent for feature/chore.
  const investigationEvents = eventStore.replay({ workItemId: workItem.id });
  const investigationComplete = [...investigationEvents]
    .reverse()
    .find((e) => e.kind === 'agent.investigation-complete');
  const beforeCommentUrl = (
    investigationComplete?.payload as { playwrightRepro?: { commentUrl?: string } } | undefined
  )?.playwrightRepro?.commentUrl;

  await runEvidencePost({
    workItem,
    projectId,
    runId,
    appendSystemPrompt: input.evidencePostPrompt,
    outputJsonSchema: input.evidencePostJsonSchema,
    prNumber: prResult.prNumber,
    prHeadSha,
    repoRef,
    evidenceSpecPath: implementOutput.evidenceSpecPath,
    changedPaths: observedChangedFiles.paths,
    beforeCommentUrl,
    worktreePath,
    evidenceRuntime: input.evidenceRuntime,
  });

  // Step 7: M8 path — route through QA before approval (factory:in-progress → factory:needs-qa)
  await stateSource.transitionState(stateSourceItemId, 'factory:in-progress', 'factory:needs-qa');
  emitStateTransitionEvent({
    projectId,
    workItemId: workItem.id,
    from: 'factory:in-progress',
    to: 'factory:needs-qa',
    by: 'fix-issue',
    runId,
  });
}

function latestLinkedGithubIssue(projectId: string, workItemId: string) {
  const refs = new LocalDbWorkItemRepository()
    .listExternalRefs(projectId, workItemId)
    .filter((ref) => ref.provider === 'github' && ref.kind === 'issue');
  return refs.at(-1) ?? null;
}
