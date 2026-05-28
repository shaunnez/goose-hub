import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import {
  type EffectiveDevReviewConfig,
  getDiffForDevReview,
  resolveDevReviewConfig,
  runDevReview,
  runDevReviewResponse,
  shouldRunDevReview,
} from '@goose-hub/core/agent-runtime/dev-review-advisor.js';
import { resolveImplementWpBudgetConfig } from '@goose-hub/core/agent-runtime/implement-wp-settings.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import {
  latestInvestigationContext,
  pathsTouchInvestigationSurface,
} from '@goose-hub/core/agent-runtime/investigation-context.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { resolveGlobalSettingsForProject } from '@goose-hub/core/agent-runtime/resolve-for-project.js';
import { resolveProjectAgentExecution } from '@goose-hub/core/agent-runtime/resolve-runtime-for-project.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { openLocalDbPR, openPR } from '@goose-hub/core/connectors/github/open-pr.js';
import { readProjectSettings } from '@goose-hub/core/db/repositories/project-settings.js';
import type { RunDisposition } from '@goose-hub/core/event-stream/run-disposition.js';
import type { AgentEvent, AppendEventInput } from '@goose-hub/core/event-stream/store.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { upsertGithubExternalRef } from '@goose-hub/core/integrations/github/external-refs.js';
import { resolveLatestPrd } from '@goose-hub/core/prd/read-model.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import {
  type ObservedChangedFilesPacket,
  deriveObservedChangedFiles,
} from '@goose-hub/core/workspaces/observed-changes.js';
import {
  cleanupAllWpWorktrees,
  createWpScratchWorktree,
  orchestratorCommitAll,
  orchestratorCommitWp,
  orchestratorPushBranch,
  resolveRemoteBranchHead,
  revertWpChanges,
} from '@goose-hub/core/workspaces/orchestrator-git.js';
import {
  assertGooseHubWebPlaywrightReady,
  type cleanupWorktree,
  createIntegrationWorktree,
  createWorktree,
  prewarmWorktree,
  reattachIntegrationWorktreeAtRemoteTip,
  resolveWorkflowBase,
} from '@goose-hub/core/workspaces/worktree.js';
import type { DevReviewResponseOutput } from '@goose-hub/skills/dev-review-response/schema.js';
import type { DevReviewOutput } from '@goose-hub/skills/dev-review/schema.js';
import { ImplementWpSchema } from '@goose-hub/skills/implement-wp/schema.js';
import { type EngineeringSpec, fileOwnedPath } from '@goose-hub/skills/spec-author/schema.js';
import { normalizeEngineeringSpecPaths } from '../spec-author/path-normalization.js';
import { buildPrdPlanningContext } from '../spec-author/prd-planning-context.js';
import { type DevReviewGateInput, evaluateDevReviewGate } from './dev-review-gate.js';
import {
  type WpDispatchResult,
  buildParallelPrBody,
  getLastWpStatus,
  recordWpIteration,
  runWithConcurrencyCap,
} from './parallel-helpers.js';
import {
  type ImplementWpControlConfig,
  resolveImplementWpBudget,
  resolveImplementWpControl,
} from './wp-budget.js';
import { runOneWpBuilder } from './wp-builder.js';
import { buildImplementWpContextFromSpec } from './wp-context.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type { WpDispatchResult } from './parallel-helpers.js';

export type ParallelImplementWorkflowResult =
  | { status: 'success'; devRunId: string; worktreePath: string; prNumber: number; prUrl: string }
  | { status: 'failed'; devRunId: string; errorReason: string };

export interface ParallelImplementDeps {
  runtime?: AgentRuntime;
  /** Separate runtime for the dev-review Codex pass (defaults to auto-selected Codex runtime). */
  devReviewRuntime?: AgentRuntime;
  /** Separate runtime for the dev-review-response pass (defaults to project skill settings). */
  devReviewResponseRuntime?: AgentRuntime;
  openPRImpl?: typeof openPR;
  openLocalDbPRImpl?: typeof openLocalDbPR;
  upsertGithubExternalRefImpl?: typeof upsertGithubExternalRef;
  createWpWorktreeImpl?: typeof createWpScratchWorktree;
  createIssueWorktreeImpl?: typeof createWorktree;
  /** Override dependency prewarm for tests or alternate package managers. */
  prewarmWorktreeImpl?: typeof prewarmWorktree;
  /** Override post-prewarm dependency verification for tests or alternate package managers. */
  verifyWorktreeDependenciesImpl?: (worktreePath: string) => void;
  resolveWorkflowBaseImpl?: typeof resolveWorkflowBase;
  createIntegrationWorktreeImpl?: typeof createIntegrationWorktree;
  reattachIntegrationWorktreeAtRemoteTipImpl?: typeof reattachIntegrationWorktreeAtRemoteTip;
  cleanupWpWorktreesImpl?: typeof cleanupAllWpWorktrees;
  cleanupIssueWorktreeImpl?: typeof cleanupWorktree;
  orchestratorCommitWpImpl?: typeof orchestratorCommitWp;
  pushBranchImpl?: typeof orchestratorPushBranch;
  resolveRemoteBranchHeadImpl?: typeof resolveRemoteBranchHead;
  revertWpChangesImpl?: typeof revertWpChanges;
  recordIterationImpl?: typeof recordWpIteration;
  getLastStatusImpl?: typeof getLastWpStatus;
  appendEvent?: (input: AppendEventInput) => AgentEvent;
  /** Override getDiffForDevReview for testing. */
  getDiffImpl?: (worktreePath: string, baseBranch?: string) => string;
  /** Override the resolved dev-review config (for testing without a real project DB). */
  devReviewConfigOverride?: EffectiveDevReviewConfig;
  /** Override runDevReview for testing (avoids hitting DB/FS/Codex). */
  runDevReviewImpl?: typeof runDevReview;
  /** Override runDevReviewResponse for testing (avoids hitting DB/FS/Claude). */
  runDevReviewResponseImpl?: typeof runDevReviewResponse;
  /** Override the orchestrator commit-all for dev-review-response edits (for testing). */
  commitDevReviewResponseImpl?: typeof orchestratorCommitAll;
  /** Override persona selection for tests that should not touch SQLite routing state. */
  selectPersonaImpl?: typeof selectPersona;
  /** Override observed changed-file derivation for tests. */
  deriveObservedChangedFilesImpl?: typeof deriveObservedChangedFiles;
  /** Override integration clean check for durability tests. */
  isIntegrationWorktreeCleanImpl?: (worktreePath: string) => boolean;
  /** Override integration HEAD resolution for durability tests. */
  resolveIntegrationHeadImpl?: (worktreePath: string) => string;
  /** Override per-path integration drift detection for durability tests. */
  hasIntegrationChangedPathSinceImpl?: (
    worktreePath: string,
    baseRef: string,
    path: string,
  ) => boolean;
  /** Override event replay for resume tests. */
  replayEventsImpl?: typeof eventStore.replay;
  /** Override live PR state verification for all-persisted resume tests. */
  verifyExistingPrImpl?: (input: {
    repo: string;
    pr: ExistingPipelinePr;
    token?: string;
  }) => Promise<ExistingPipelinePr>;
  implementWpControlOverride?: ImplementWpControlConfig;
}

function uniqueSorted(paths: string[]): string[] {
  return [...new Set(paths)].sort();
}

function compactPaths(paths: string[], limit = 40): { count: number; paths: string[] } {
  const sorted = uniqueSorted(paths);
  return {
    count: sorted.length,
    paths: sorted.slice(0, limit),
  };
}

function filterWpObservedFiles(
  packet: ObservedChangedFilesPacket,
): ObservedChangedFilesPacket['files'] {
  return packet.files.filter(
    (file) => file.path !== '.claude/settings.local.json' && file.path !== '.codex/hooks.json',
  );
}

function declaredWpFilesWritten(paths: Array<{ path: string }>): string[] {
  return uniqueSorted(paths.map((file) => file.path));
}

function emitWpObservedMismatch(input: {
  append: (input: AppendEventInput) => AgentEvent;
  projectId: string;
  workItemId: string;
  wpId: string;
  wpRunId: string;
  modelDeclaredPaths: string[];
  observedPaths: string[];
  reason?: string;
}): void {
  const declared = new Set(input.modelDeclaredPaths);
  const observed = new Set(input.observedPaths);
  const observedNotDeclared = input.observedPaths.filter((path) => !declared.has(path));
  const declaredNotObserved = input.modelDeclaredPaths.filter((path) => !observed.has(path));
  if (
    input.reason == null &&
    observedNotDeclared.length === 0 &&
    declaredNotObserved.length === 0
  ) {
    return;
  }

  input.append({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'agent.output-fact-mismatch',
    payload: {
      runId: input.wpRunId,
      skill: 'implement-wp',
      wpId: input.wpId,
      reason: input.reason ?? 'declared-files-written-differ-from-observed-changes',
      modelDeclaredFiles: compactPaths(input.modelDeclaredPaths),
      observedChangedFiles: compactPaths(input.observedPaths),
      mismatches: {
        observedNotDeclared: compactPaths(observedNotDeclared),
        declaredNotObserved: compactPaths(declaredNotObserved),
      },
    },
    runId: input.wpRunId,
  });
}

function observedOutsideOwned(input: { observedPaths: string[]; filesOwned: string[] }): string[] {
  const owned = new Set(input.filesOwned);
  return input.observedPaths.filter((path) => !owned.has(path));
}

function applyObservedFileToIssueWorktree(input: {
  issueWorktreePath: string;
  scratchWorktreePath: string;
  observedFile: ObservedChangedFilesPacket['files'][number];
}): void {
  const destPath = join(input.issueWorktreePath, input.observedFile.path);
  if (input.observedFile.status === 'deleted') {
    rmSync(destPath, { force: true });
    return;
  }

  const sourcePath = join(input.scratchWorktreePath, input.observedFile.path);
  if (!existsSync(sourcePath)) {
    throw new Error(
      `observed changed file missing from scratch worktree: ${input.observedFile.path}`,
    );
  }
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(sourcePath, destPath);
}

type PersistedWpCheckpoint = {
  wpId: string;
  wpRunId: string;
  iteration: number;
  integrationBranch: string;
  wpCommitSha: string;
  pushedSha: string;
  filesPersisted: string[];
};

type ExistingPipelinePr = {
  prNumber: number;
  prUrl: string;
  branch: string;
  base: string;
  headSha?: string;
  state?: string;
  worktreePath?: string;
};

type WorkflowIntegrationWorktree = {
  worktreePath: string;
  previousHeadSha: string | null;
};

type PersistenceFailureReason =
  | 'push-failed'
  | 'missing-remote-branch'
  | 'remote-head-mismatch'
  | 'dirty-integration-worktree'
  | 'direct-integration-overwrite'
  | 'final-pre-pr-verification-failed'
  | 'pr-metadata-mismatch';

export class PersistenceFailureError extends Error {
  readonly reason: PersistenceFailureReason;
  readonly causeValue?: unknown;

  constructor(reason: PersistenceFailureReason, message: string, causeValue?: unknown) {
    super(message);
    this.name = 'PersistenceFailureError';
    this.reason = reason;
    this.causeValue = causeValue;
  }
}

class BlockedGateError extends Error {
  readonly gate = 'dev-review';

  constructor(message: string) {
    super(message);
    this.name = 'BlockedGateError';
  }
}

function latestLinkedGithubIssue(workItem: WorkItem) {
  return (
    (workItem.externalRefs ?? [])
      .filter((ref) => ref.provider === 'github' && ref.kind === 'issue' && ref.repoRef != null)
      .at(-1) ?? null
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function verifyPersistedBranch(input: {
  worktreePath: string;
  integrationBranch: string;
  expectedCommitSha: string;
  pushBranch: (worktreePath: string, branchName: string) => void;
  resolveRemoteBranchHead: (worktreePath: string, branchName: string) => string | undefined;
  context: string;
  failureReason?: PersistenceFailureReason;
  allowUnverifiedTestPersistence?: boolean;
}): string {
  try {
    input.pushBranch(input.worktreePath, input.integrationBranch);
  } catch (err) {
    throw new PersistenceFailureError(
      'push-failed',
      `${input.context}: push failed: ${errorMessage(err)}`,
      err,
    );
  }

  let remoteHead: string | undefined;
  try {
    remoteHead = input.resolveRemoteBranchHead(input.worktreePath, input.integrationBranch);
  } catch (err) {
    throw new PersistenceFailureError(
      'missing-remote-branch',
      `${input.context}: remote branch missing after push: ${errorMessage(err)}`,
      err,
    );
  }

  if (remoteHead == null || remoteHead.length === 0) {
    if (input.allowUnverifiedTestPersistence === true) {
      return input.expectedCommitSha;
    }
    throw new PersistenceFailureError(
      'missing-remote-branch',
      `${input.context}: remote branch missing after push`,
    );
  }

  if (remoteHead !== input.expectedCommitSha) {
    throw new PersistenceFailureError(
      input.failureReason ?? 'remote-head-mismatch',
      `${input.context}: remote ${remoteHead} != expected ${input.expectedCommitSha}`,
    );
  }

  return remoteHead;
}

function isIntegrationWorktreeClean(worktreePath: string): boolean {
  const status = execFileSync('git', ['status', '--porcelain'], {
    cwd: worktreePath,
    encoding: 'utf8',
  });
  return status.trim().length === 0;
}

function resolveIntegrationHead(worktreePath: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: worktreePath,
    encoding: 'utf8',
  }).trim();
}

function hasIntegrationChangedPathSince(
  worktreePath: string,
  baseRef: string,
  path: string,
): boolean {
  try {
    execFileSync('git', ['diff', '--quiet', baseRef, '--', path], {
      cwd: worktreePath,
      stdio: 'pipe',
    });
    return false;
  } catch {
    return true;
  }
}

function verifyExistingPrMetadata(input: {
  pr: ExistingPipelinePr;
  expectedBranch: string;
  expectedHeadSha: string;
  expectedBaseBranch: string;
}): void {
  if (
    input.pr.branch !== input.expectedBranch ||
    input.pr.base !== input.expectedBaseBranch ||
    input.pr.headSha !== input.expectedHeadSha ||
    input.pr.state !== 'open'
  ) {
    throw new PersistenceFailureError(
      'pr-metadata-mismatch',
      `existing PR metadata mismatch for ${input.expectedBranch}`,
    );
  }
}

async function verifyExistingPrState(input: {
  repo: string;
  pr: ExistingPipelinePr;
  token?: string;
  fetchImpl?: typeof fetch;
}): Promise<ExistingPipelinePr> {
  const fetchFn = input.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (input.token != null && input.token.length > 0) {
    headers.Authorization = `Bearer ${input.token}`;
  }
  const response = await fetchFn(
    `https://api.github.com/repos/${input.repo}/pulls/${input.pr.prNumber}`,
    { headers },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '<no body>');
    throw new Error(
      `GitHub PR verification failed: ${response.status} ${response.statusText} - ${detail}`,
    );
  }
  const json = (await response.json()) as {
    number: number;
    html_url: string;
    state: string;
    head?: { ref?: string; sha?: string };
    base?: { ref?: string };
  };
  return {
    prNumber: json.number,
    prUrl: json.html_url,
    branch: json.head?.ref ?? '',
    base: json.base?.ref ?? '',
    headSha: json.head?.sha,
    state: json.state === 'open' ? 'open' : 'closed',
    worktreePath: input.pr.worktreePath,
  };
}

function persistedWpCheckpoints(input: {
  events: AgentEvent[];
  pipelineRunId: string;
  integrationBranch: string;
}): Map<string, PersistedWpCheckpoint> {
  const checkpoints = new Map<string, PersistedWpCheckpoint>();
  for (const event of input.events) {
    if (event.kind !== 'parallel-implement.wp-persisted') continue;
    const payload = event.payload as Partial<PersistedWpCheckpoint> & {
      pipelineRunId?: string;
      persistMode?: string;
    };
    if (payload.pipelineRunId !== input.pipelineRunId) continue;
    if (payload.integrationBranch !== input.integrationBranch) continue;
    if (
      typeof payload.wpId !== 'string' ||
      typeof payload.wpRunId !== 'string' ||
      typeof payload.iteration !== 'number' ||
      typeof payload.wpCommitSha !== 'string' ||
      typeof payload.pushedSha !== 'string'
    ) {
      continue;
    }
    checkpoints.set(payload.wpId, {
      wpId: payload.wpId,
      wpRunId: payload.wpRunId,
      iteration: payload.iteration,
      integrationBranch: payload.integrationBranch,
      wpCommitSha: payload.wpCommitSha,
      pushedSha: payload.pushedSha,
      filesPersisted: Array.isArray(payload.filesPersisted)
        ? payload.filesPersisted.filter((file): file is string => typeof file === 'string')
        : [],
    });
  }
  return checkpoints;
}

function latestPipelinePr(input: {
  events: AgentEvent[];
  pipelineRunId: string;
  integrationBranch: string;
}): ExistingPipelinePr | null {
  for (const event of [...input.events].reverse()) {
    if (event.kind !== 'pr.opened') continue;
    const payload = event.payload as Partial<ExistingPipelinePr> & {
      pipelineRunId?: string;
      baseBranch?: string;
    };
    if (payload.pipelineRunId !== input.pipelineRunId) continue;
    if (payload.branch !== input.integrationBranch) continue;
    if (
      typeof payload.prNumber !== 'number' ||
      typeof payload.prUrl !== 'string' ||
      typeof payload.branch !== 'string'
    ) {
      continue;
    }
    return {
      prNumber: payload.prNumber,
      prUrl: payload.prUrl,
      branch: payload.branch,
      base: typeof payload.base === 'string' ? payload.base : (payload.baseBranch ?? 'main'),
      headSha: typeof payload.headSha === 'string' ? payload.headSha : undefined,
      state: typeof payload.state === 'string' ? payload.state : undefined,
      worktreePath: typeof payload.worktreePath === 'string' ? payload.worktreePath : undefined,
    };
  }
  return null;
}

// ─── Main workflow ─────────────────────────────────────────────────────────────

export async function runParallelImplementWorkflow(
  workItem: WorkItem,
  spec: EngineeringSpec,
  pipelineRunId: string,
  stateSource: StateSource,
  projectId: string,
  targetRepo: string,
  deps: ParallelImplementDeps = {},
): Promise<ParallelImplementWorkflowResult> {
  const runId = crypto.randomUUID();
  const baseAppend = deps.appendEvent ?? ((input) => eventStore.appendEvent(input));
  const append = (input: AppendEventInput): AgentEvent => {
    const payload =
      input.payload != null && typeof input.payload === 'object' && !Array.isArray(input.payload)
        ? { ...(input.payload as Record<string, unknown>), pipelineRunId }
        : { value: input.payload, pipelineRunId };
    return baseAppend({ ...input, payload });
  };
  const openPRFn = deps.openPRImpl ?? openPR;
  const openLocalDbPRFn = deps.openLocalDbPRImpl ?? openLocalDbPR;
  const upsertGithubExternalRefFn = deps.upsertGithubExternalRefImpl ?? upsertGithubExternalRef;
  const createWpFn = deps.createWpWorktreeImpl ?? createWpScratchWorktree;
  const createIssueFn = deps.createIssueWorktreeImpl ?? createWorktree;
  const usesInjectedWorkflowWorktree =
    deps.createIssueWorktreeImpl != null || deps.createIntegrationWorktreeImpl != null;
  const createIntegrationFn =
    deps.createIntegrationWorktreeImpl ??
    ((repo: string, pipelineId: string, _branchName: string, baseRef?: string) => {
      if (deps.createIssueWorktreeImpl != null) {
        return {
          worktreePath: createIssueFn(repo, pipelineId, baseRef),
          previousHeadSha: null,
        };
      }
      return createIntegrationWorktree(repo, pipelineId, _branchName, baseRef);
    });
  const reattachIntegrationFn =
    deps.reattachIntegrationWorktreeAtRemoteTipImpl ?? reattachIntegrationWorktreeAtRemoteTip;
  const prewarmWtFn =
    deps.prewarmWorktreeImpl ??
    (deps.createIssueWorktreeImpl == null && deps.createWpWorktreeImpl == null
      ? prewarmWorktree
      : () => undefined);
  const shouldRunDefaultWorktreeDependencyPreflight =
    deps.prewarmWorktreeImpl == null &&
    deps.createIssueWorktreeImpl == null &&
    deps.createWpWorktreeImpl == null;
  const verifyWorktreeDepsFn =
    deps.verifyWorktreeDependenciesImpl ??
    (shouldRunDefaultWorktreeDependencyPreflight
      ? assertGooseHubWebPlaywrightReady
      : () => undefined);
  const resolveWorkflowBaseFn = deps.resolveWorkflowBaseImpl ?? resolveWorkflowBase;
  const cleanupWpsFn = deps.cleanupWpWorktreesImpl ?? cleanupAllWpWorktrees;
  // cleanupIssueWorktreeImpl is available for test injection but unused in production:
  // the integration worktree persists until PR merge so QA can reuse the same environment.
  const commitWpFn = deps.orchestratorCommitWpImpl ?? orchestratorCommitWp;
  const pushBranchFn =
    deps.pushBranchImpl ??
    (usesInjectedWorkflowWorktree ? () => undefined : orchestratorPushBranch);
  const resolveRemoteBranchHeadFn =
    deps.resolveRemoteBranchHeadImpl ??
    (usesInjectedWorkflowWorktree
      ? (_worktreePath: string, _branchName: string) => undefined
      : resolveRemoteBranchHead);
  const allowUnverifiedTestPersistence =
    usesInjectedWorkflowWorktree && deps.resolveRemoteBranchHeadImpl == null;
  const revertFn = deps.revertWpChangesImpl ?? revertWpChanges;
  const recordFn = deps.recordIterationImpl ?? recordWpIteration;
  const getStatusFn = deps.getLastStatusImpl ?? getLastWpStatus;
  const deriveObservedChangedFilesFn =
    deps.deriveObservedChangedFilesImpl ?? deriveObservedChangedFiles;
  const shouldEnforceIntegrationMergeGuard =
    deps.isIntegrationWorktreeCleanImpl != null ||
    deps.resolveIntegrationHeadImpl != null ||
    deps.hasIntegrationChangedPathSinceImpl != null ||
    (deps.createIssueWorktreeImpl == null && deps.createIntegrationWorktreeImpl == null);
  const isIntegrationCleanFn = deps.isIntegrationWorktreeCleanImpl ?? isIntegrationWorktreeClean;
  const resolveIntegrationHeadFn = deps.resolveIntegrationHeadImpl ?? resolveIntegrationHead;
  const hasIntegrationChangedPathSinceFn =
    deps.hasIntegrationChangedPathSinceImpl ?? hasIntegrationChangedPathSince;
  const replayEventsFn = deps.replayEventsImpl ?? ((filter) => eventStore.replay(filter));
  const verifyExistingPrFn = deps.verifyExistingPrImpl ?? verifyExistingPrState;

  const projectConfig = await getProjectBySlug(projectId);
  const workflowBase = resolveWorkflowBaseFn(targetRepo, projectConfig?.targetRepo?.defaultBranch);
  const projectSettingsRow = readProjectSettings(projectId);
  const implementWpBudgetConfig = resolveImplementWpBudgetConfig(
    projectConfig?.budgets,
    projectSettingsRow,
  );
  const { runtime, resolvedBudget: implementWpBudget } = resolveProjectAgentExecution({
    skill: 'implement-wp',
    role: 'developer',
    projectId,
    projectConfig,
    injectedRuntime: deps.runtime,
  });
  const globalSettings = resolveGlobalSettingsForProject(projectId, projectConfig?.budgets);
  const maxParallel = globalSettings.maxParallelAgents ?? 3;
  const maxRetries = globalSettings.maxRetries ?? 2;
  const wpTimeoutMs = 900_000;
  const implementWpControl =
    deps.implementWpControlOverride ?? resolveImplementWpControl(implementWpBudgetConfig);
  const devReviewCfg =
    deps.devReviewConfigOverride ??
    resolveDevReviewConfig(projectId, projectConfig?.agentConfig?.devReview);
  const getDiffFn = deps.getDiffImpl ?? getDiffForDevReview;
  const devReviewFn = deps.runDevReviewImpl ?? runDevReview;
  const devReviewResponseFn = deps.runDevReviewResponseImpl ?? runDevReviewResponse;
  const commitDevReviewFn =
    deps.commitDevReviewResponseImpl ??
    ((wt: string, msg: string) => orchestratorCommitAll(wt, msg));

  const { personaId } = (deps.selectPersonaImpl ?? selectPersona)(projectId, 'developer');
  const implementWpPrompt = readPromptWithContext('implement-wp', projectId);
  const implementWpJsonSchema = toJsonSchema(ImplementWpSchema);
  const investigation = latestInvestigationContext({
    projectId,
    workItemId: workItem.id,
    worktreePath: targetRepo,
  });
  const latestPrd =
    workItem.type === 'feature'
      ? await resolveLatestPrd({
          projectId,
          workItemId: workItem.id,
        })
      : null;
  const parentPrdContext =
    latestPrd != null
      ? (buildPrdPlanningContext({
          projectId,
          parentWorkItemId: workItem.id,
          pipelineRunId,
          latestPrd,
        }) ?? undefined)
      : undefined;
  const normalizedSpec = normalizeEngineeringSpecPaths({
    spec,
    worktreePath: targetRepo,
    referencePaths: investigation?.keyFiles.map((file) => file.path) ?? [],
  });
  if (normalizedSpec.fields.length > 0) {
    append({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.path-normalized',
      payload: {
        runId,
        skill: 'parallel-implement',
        fields: normalizedSpec.fields,
      },
      runId,
    });
  }
  if (normalizedSpec.ambiguousFields.length > 0) {
    await stateSource.comment(
      workItem.externalId,
      buildAgentComment('Dev', 'Failed', 'Parallel implement blocked by ambiguous paths', [
        `Ambiguous paths: ${normalizedSpec.ambiguousFields
          .map((field) => `${field.field} (${field.from})`)
          .join(', ')}`,
      ]),
    );
    return {
      status: 'failed',
      devRunId: runId,
      errorReason: 'engineering spec contains ambiguous repo-relative paths',
    };
  }
  const specForRun = normalizedSpec.spec;

  const stack = projectConfig?.stack
    ? {
        testCommand: projectConfig.stack.testCommand,
        lintCommand: projectConfig.stack.lintCommand,
        typecheckCommand: projectConfig.stack.typecheckCommand,
      }
    : { testCommand: 'pnpm test' };

  const allWpIds = specForRun.workPackages.map((wp) => wp.id);
  const scratchWorktrees = new Map<string, string>(); // wpId → path
  let issueWorktreePath: string | undefined;
  const integrationBranch = `factory/run/${pipelineRunId}`;
  const resumeEvents = replayEventsFn({
    projectId,
    workItemId: workItem.id,
  });
  const persistedByWp = persistedWpCheckpoints({
    events: resumeEvents,
    pipelineRunId,
    integrationBranch,
  });
  const existingPr = latestPipelinePr({
    events: resumeEvents,
    pipelineRunId,
    integrationBranch,
  });
  let integrationHeadSha: string | null = null;

  try {
    const plannedWpFiles = specForRun.workPackages.flatMap((wp) =>
      wp.filesOwned.map(fileOwnedPath),
    );
    if (!pathsTouchInvestigationSurface(plannedWpFiles, investigation)) {
      append({
        projectId,
        workItemId: workItem.id,
        kind: 'agent.wrong-surface-guard',
        payload: {
          runId,
          skill: 'parallel-implement',
          reason: 'engineering-spec-missed-investigation-surface',
          expectedKeyFiles: investigation?.keyFiles.map((f) => f.path) ?? [],
          touchedPaths: plannedWpFiles,
          investigationRunId: investigation?.investigationRunId ?? null,
        },
        runId,
      });
      await stateSource.comment(
        workItem.externalId,
        buildAgentComment('Dev', 'Failed', 'Parallel implement blocked by wrong-surface guard', [
          `Expected one of: ${investigation?.keyFiles.map((f) => f.path).join(', ')}`,
        ]),
      );
      return {
        status: 'failed',
        devRunId: runId,
        errorReason: 'engineering spec did not target investigated key files',
      };
    }

    const latestPersisted = [...persistedByWp.values()].at(-1);
    let integrationWorktree: WorkflowIntegrationWorktree;
    if (latestPersisted != null) {
      let remoteHead: string | undefined;
      try {
        remoteHead = resolveRemoteBranchHeadFn(targetRepo, integrationBranch);
      } catch (err) {
        throw new PersistenceFailureError(
          'missing-remote-branch',
          `resume remote branch verification failed: ${errorMessage(err)}`,
          err,
        );
      }
      if (remoteHead == null || remoteHead.length === 0) {
        throw new PersistenceFailureError(
          'missing-remote-branch',
          `resume remote branch missing: ${integrationBranch}`,
        );
      }
      if (remoteHead !== latestPersisted.pushedSha) {
        throw new PersistenceFailureError(
          'remote-head-mismatch',
          `resume remote ${remoteHead} != latest persisted ${latestPersisted.pushedSha}`,
        );
      }
      try {
        integrationWorktree = reattachIntegrationFn(
          targetRepo,
          pipelineRunId,
          integrationBranch,
          latestPersisted.pushedSha,
          workflowBase.ref,
        );
      } catch (err) {
        throw new PersistenceFailureError(
          'dirty-integration-worktree',
          `resume integration worktree reset failed: ${errorMessage(err)}`,
          err,
        );
      }
    } else {
      // Create the integration worktree (all WP commits land here).
      integrationWorktree = createIntegrationFn(
        targetRepo,
        pipelineRunId,
        integrationBranch,
        workflowBase.ref,
      );
    }
    issueWorktreePath = integrationWorktree.worktreePath;
    integrationHeadSha = latestPersisted?.pushedSha ?? integrationWorktree.previousHeadSha;
    prewarmWtFn(issueWorktreePath);
    try {
      verifyWorktreeDepsFn(issueWorktreePath);
    } catch (err) {
      const reason =
        err instanceof Error
          ? err.message
          : 'worktree dependencies unavailable: verification tooling not resolvable';
      await stateSource.comment(
        workItem.externalId,
        buildAgentComment('Dev', 'Failed', 'Parallel implement dependency preflight failed', [
          reason,
        ]),
      );
      return { status: 'failed', devRunId: runId, errorReason: reason };
    }

    const allWpResults: WpDispatchResult[] = [...persistedByWp.values()].map((checkpoint) => ({
      wpId: checkpoint.wpId,
      status: 'ok',
      commitSha: checkpoint.wpCommitSha,
      runId: checkpoint.wpRunId,
    }));

    for (let iteration = 1; iteration <= maxRetries + 1; iteration++) {
      // Carry-forward: skip WPs that are already ok.
      const wpsToRun = specForRun.workPackages.filter((wp) => {
        if (persistedByWp.has(wp.id)) return false;
        const lastStatus = getStatusFn(runId, wp.id);
        return lastStatus !== 'ok';
      });

      if (wpsToRun.length === 0) break;

      append({
        projectId,
        workItemId: workItem.id,
        kind: 'parallel-implement.iteration-started',
        payload: { iteration, wpCount: wpsToRun.length, wpIds: wpsToRun.map((w) => w.id) },
        runId,
      });

      // Execute batches in order (respecting executionOrder).
      // Phase 1: WPs within the same batch build concurrently.
      // Phase 2: successful builds commit serially to the integration worktree
      //          to avoid git index lock contention (ADR 0031).
      for (const batch of specForRun.executionOrder) {
        const batchWps = wpsToRun.filter((wp) => batch.wpIds.includes(wp.id));
        if (batchWps.length === 0) continue;

        const scratchBaseRef = integrationHeadSha ?? workflowBase.ref;
        for (const wp of batchWps) {
          if (scratchWorktrees.has(wp.id)) continue;
          const wtPath = createWpFn(targetRepo, runId, wp.id, scratchBaseRef);
          prewarmWtFn(wtPath);
          scratchWorktrees.set(wp.id, wtPath);
        }

        // Phase 1 — concurrent build (no git writes to integration worktree).
        const buildPhaseResults = await runWithConcurrencyCap(batchWps, maxParallel, (wp) => {
          const specHandoff = buildImplementWpContextFromSpec({
            spec: specForRun,
            wp,
            pipelineRunId,
          });
          return runOneWpBuilder({
            wp,
            iteration,
            runId,
            pipelineRunId,
            projectId,
            workItemId: workItem.id,
            workItem,
            scratchWorktreePath: scratchWorktrees.get(wp.id) ?? '/tmp/missing-scratch',
            stack,
            runtime,
            budgets: resolveImplementWpBudget({
              defaultBudgets: implementWpBudget.budgets,
              workItem,
              wp,
              budgetConfig: implementWpBudgetConfig,
            }),
            modelOverride: implementWpBudget.modelOverride,
            personaId,
            wpTimeoutMs,
            appendEvent: append,
            revertWpChangesFn: revertFn,
            recordIterationFn: recordFn,
            implementWpPrompt,
            implementWpJsonSchema,
            investigation,
            specContext: specHandoff.specContext,
            acceptanceContract: specHandoff.acceptanceContract,
            verificationCommands: specHandoff.verificationCommands,
            parentPrdContext,
            implementWpControl,
            verifyWorktreeDependenciesFn: verifyWorktreeDepsFn,
          });
        });

        // Phase 2 — serial commit (one WP at a time into the integration worktree).
        for (const buildResult of buildPhaseResults) {
          if (buildResult.status !== 'built') {
            const r = buildResult;
            allWpResults.push({
              wpId: r.wpId,
              status: r.status,
              errorReason: r.errorReason,
              runId: r.runId,
            });
            if (r.acceptanceFailure?.kind === 'terminal-blocker') {
              const reason =
                r.errorReason ??
                `implement-wp emitted terminal ${r.acceptanceFailure.decisionKind}`;
              append({
                projectId,
                workItemId: workItem.id,
                kind: 'parallel-implement.wp-terminal-blocked',
                payload: {
                  wpId: r.wpId,
                  wpRunId: r.runId,
                  decisionKind: r.acceptanceFailure.decisionKind,
                  errorReason: reason,
                },
                runId: r.runId,
              });
              await stateSource.comment(
                workItem.externalId,
                buildAgentComment(
                  'Dev',
                  'Failed',
                  'Parallel implement stopped on terminal WP blocker',
                  [`${r.wpId}: ${reason}`],
                ),
              );
              return {
                status: 'failed',
                devRunId: runId,
                errorReason: `Terminal implement-wp ${r.acceptanceFailure.decisionKind} for ${r.wpId}: ${reason}`,
              };
            }
            continue;
          }

          const { wp, parsedFilesWritten, wpRunId, commitMsg, scratchWorktreePath } = buildResult;
          const issueWt = issueWorktreePath ?? '/tmp/missing-issue';
          const observedChangedFiles = deriveObservedChangedFilesFn(scratchWorktreePath);
          const filteredObservedFiles = filterWpObservedFiles(observedChangedFiles);
          const changedPaths = uniqueSorted(filteredObservedFiles.map((file) => file.path));
          const modelDeclaredPaths = declaredWpFilesWritten(parsedFilesWritten);

          if (!observedChangedFiles.gitAvailable) {
            emitWpObservedMismatch({
              append,
              projectId,
              workItemId: workItem.id,
              wpId: wp.id,
              wpRunId,
              modelDeclaredPaths,
              observedPaths: changedPaths,
              reason: 'observed-changes-unavailable',
            });
            for (const fileWritten of parsedFilesWritten) {
              const sourcePath = join(scratchWorktreePath, fileWritten.path);
              if (!existsSync(sourcePath)) continue;
              const destPath = join(issueWt, fileWritten.path);
              mkdirSync(dirname(destPath), { recursive: true });
              copyFileSync(sourcePath, destPath);
            }
          } else {
            if (changedPaths.length === 0) {
              emitWpObservedMismatch({
                append,
                projectId,
                workItemId: workItem.id,
                wpId: wp.id,
                wpRunId,
                modelDeclaredPaths,
                observedPaths: changedPaths,
                reason: 'no-observed-changed-files',
              });
              const reason = 'no observed changed files in WP scratch worktree';
              append({
                projectId,
                workItemId: workItem.id,
                kind: 'parallel-implement.wp-commit-failed',
                payload: { wpId: wp.id, wpRunId, errorReason: reason },
                runId: wpRunId,
              });
              revertFn(scratchWorktreePath, changedPaths);
              recordFn(runId, wp.id, iteration, 'failed', reason);
              allWpResults.push({
                wpId: wp.id,
                status: 'failed',
                errorReason: reason,
                runId: wpRunId,
              });
              await stateSource.comment(
                workItem.externalId,
                buildAgentComment('Dev', 'Failed', 'Parallel implement stopped on no-op WP', [
                  `${wp.id}: ${reason}`,
                ]),
              );
              return {
                status: 'failed',
                devRunId: runId,
                errorReason: reason,
              };
            }

            emitWpObservedMismatch({
              append,
              projectId,
              workItemId: workItem.id,
              wpId: wp.id,
              wpRunId,
              modelDeclaredPaths,
              observedPaths: changedPaths,
            });

            const wpOwnedPaths = wp.filesOwned.map(fileOwnedPath);
            const outsideOwned = observedOutsideOwned({
              observedPaths: changedPaths,
              filesOwned: wpOwnedPaths,
            });
            if (outsideOwned.length > 0) {
              const reason = `observed changes outside filesOwned: ${outsideOwned.join(', ')}`;
              append({
                projectId,
                workItemId: workItem.id,
                kind: 'agent.contract-gate-blocked',
                payload: {
                  runId: wpRunId,
                  skill: 'implement-wp',
                  wpId: wp.id,
                  gate: 'implement-wp-observed-changes',
                  reason: 'observed-changes-outside-files-owned',
                  filesOwned: compactPaths(wpOwnedPaths),
                  observedChangedFiles: compactPaths(changedPaths),
                  outsideOwned: compactPaths(outsideOwned),
                },
                runId: wpRunId,
              });
              append({
                projectId,
                workItemId: workItem.id,
                kind: 'parallel-implement.wp-commit-failed',
                payload: { wpId: wp.id, wpRunId, errorReason: reason },
                runId: wpRunId,
              });
              revertFn(scratchWorktreePath, changedPaths);
              recordFn(runId, wp.id, iteration, 'failed', reason);
              allWpResults.push({
                wpId: wp.id,
                status: 'failed',
                errorReason: reason,
                runId: wpRunId,
              });
              continue;
            }

            if (shouldEnforceIntegrationMergeGuard && !isIntegrationCleanFn(issueWt)) {
              throw new PersistenceFailureError(
                'dirty-integration-worktree',
                `integration worktree is dirty before merging ${wp.id}`,
              );
            }
            if (shouldEnforceIntegrationMergeGuard) {
              const actualIntegrationHead = resolveIntegrationHeadFn(issueWt);
              if (integrationHeadSha != null && actualIntegrationHead !== integrationHeadSha) {
                throw new PersistenceFailureError(
                  'direct-integration-overwrite',
                  `integration HEAD moved before merging ${wp.id}: expected ${integrationHeadSha}, got ${actualIntegrationHead}`,
                );
              }
            }
            if (shouldEnforceIntegrationMergeGuard) {
              for (const changedPath of changedPaths) {
                if (hasIntegrationChangedPathSinceFn(issueWt, scratchBaseRef, changedPath)) {
                  throw new PersistenceFailureError(
                    'direct-integration-overwrite',
                    `integration changed ${changedPath} since scratch base ${scratchBaseRef}`,
                  );
                }
              }
            }

            for (const observedFile of filteredObservedFiles) {
              applyObservedFileToIssueWorktree({
                issueWorktreePath: issueWt,
                scratchWorktreePath,
                observedFile,
              });
            }
          }

          let commitSha: string | undefined;
          try {
            const commitPaths =
              observedChangedFiles.gitAvailable && changedPaths.length > 0
                ? changedPaths
                : modelDeclaredPaths;
            commitSha = commitWpFn(issueWt, commitPaths, commitMsg);
          } catch (commitErr) {
            const reason = commitErr instanceof Error ? commitErr.message : String(commitErr);
            append({
              projectId,
              workItemId: workItem.id,
              kind: 'parallel-implement.wp-commit-failed',
              payload: { wpId: wp.id, wpRunId, errorReason: reason },
              runId: wpRunId,
            });
            revertFn(scratchWorktreePath, wp.filesOwned.map(fileOwnedPath));
            recordFn(runId, wp.id, iteration, 'failed', `commit-failed: ${reason}`);
            allWpResults.push({
              wpId: wp.id,
              status: 'failed',
              errorReason: reason,
              runId: wpRunId,
            });
            continue;
          }

          append({
            projectId,
            workItemId: workItem.id,
            kind: 'parallel-implement.wp-committed',
            payload: { wpId: wp.id, wpRunId, commitSha },
            runId: wpRunId,
          });

          const previousHeadSha = integrationHeadSha;
          const pushedSha = verifyPersistedBranch({
            worktreePath: issueWt,
            integrationBranch,
            expectedCommitSha: commitSha,
            pushBranch: pushBranchFn,
            resolveRemoteBranchHead: resolveRemoteBranchHeadFn,
            context: `persisting ${wp.id}`,
            allowUnverifiedTestPersistence,
          });
          append({
            projectId,
            workItemId: workItem.id,
            kind: 'parallel-implement.wp-persisted',
            payload: {
              schemaVersion: 1,
              pipelineRunId,
              devRunId: runId,
              wpId: wp.id,
              wpRunId,
              iteration,
              integrationBranch,
              baseBranch: workflowBase.branch,
              previousHeadSha,
              wpCommitSha: commitSha,
              pushedSha,
              filesPersisted:
                observedChangedFiles.gitAvailable && changedPaths.length > 0
                  ? changedPaths
                  : modelDeclaredPaths,
              persistMode: 'direct-integration-commit',
            },
            runId: wpRunId,
          });
          integrationHeadSha = pushedSha;
          recordFn(runId, wp.id, iteration, 'ok');
          allWpResults.push({ wpId: wp.id, status: 'ok', commitSha, runId: wpRunId });
          if (buildResult.budgetExceeded != null) {
            append({
              projectId,
              workItemId: workItem.id,
              kind: 'agent.run-failed',
              payload: {
                runId,
                skill: 'parallel-implement',
                runDisposition: 'budget-killed',
                reason: 'budget-exceeded-after-wp-persisted',
                budgetKilledWpId: wp.id,
                wpRunId,
                costUsd: buildResult.budgetExceeded.costUsd,
                budgetUsd: buildResult.budgetExceeded.budgetUsd,
                overByUsd: buildResult.budgetExceeded.overByUsd,
                integrationBranch,
                persistedSha: pushedSha,
              },
              runId,
            });
            await stateSource.comment(
              workItem.externalId,
              buildAgentComment('Dev', 'Failed', 'Parallel implement stopped by budget', [
                `${wp.id}: green work persisted at ${pushedSha}`,
                `Cost $${buildResult.budgetExceeded.costUsd} exceeded budget $${buildResult.budgetExceeded.budgetUsd}`,
              ]),
            );
            return {
              status: 'failed',
              devRunId: runId,
              errorReason: `budget exceeded after persisted WP ${wp.id}`,
            };
          }
        }
      }

      const stillFailed = allWpIds.filter(
        (id) => !persistedByWp.has(id) && getStatusFn(runId, id) !== 'ok',
      );

      if (stillFailed.length === 0) break;

      if (iteration === maxRetries + 1) {
        // Exhausted retries — escalate to needs-human.
        append({
          projectId,
          workItemId: workItem.id,
          kind: 'parallel-implement.exhausted',
          payload: { runId, failedWpIds: stillFailed },
          runId,
        });
        await stateSource.comment(
          workItem.externalId,
          buildAgentComment(
            'Dev',
            'Failed',
            `Parallel implement exhausted ${maxRetries + 1} iterations — escalating`,
            [`Failed WPs: ${stillFailed.join(', ')}`],
          ),
        );
        return {
          status: 'failed',
          devRunId: runId,
          errorReason: `Parallel implement exhausted ${maxRetries + 1} iterations`,
        };
      }
    }

    if (persistedByWp.size === allWpIds.length && existingPr != null) {
      if (integrationHeadSha == null) {
        throw new PersistenceFailureError(
          'pr-metadata-mismatch',
          'existing PR verification failed: no persisted integration head',
        );
      }
      const remoteHead = resolveRemoteBranchHeadFn(
        issueWorktreePath ?? targetRepo,
        integrationBranch,
      );
      if (remoteHead !== integrationHeadSha) {
        throw new PersistenceFailureError(
          'remote-head-mismatch',
          `existing PR remote ${remoteHead ?? 'missing'} != persisted ${integrationHeadSha}`,
        );
      }
      let livePr: ExistingPipelinePr;
      try {
        livePr = await verifyExistingPrFn({
          repo: stateSource.repoRef,
          pr: existingPr,
          token: process.env.GITHUB_TOKEN ?? '',
        });
      } catch (err) {
        throw new PersistenceFailureError(
          'pr-metadata-mismatch',
          `existing PR live verification failed: ${errorMessage(err)}`,
          err,
        );
      }
      verifyExistingPrMetadata({
        pr: livePr,
        expectedBranch: integrationBranch,
        expectedHeadSha: integrationHeadSha,
        expectedBaseBranch: workflowBase.branch,
      });
      append({
        projectId,
        workItemId: workItem.id,
        kind: 'agent.run-completed',
        payload: {
          runId,
          skill: 'parallel-implement',
          runDisposition: 'completed',
          prNumber: livePr.prNumber,
          branch: livePr.branch,
          baseBranch: livePr.base,
        },
        runId,
      });
      return {
        status: 'success',
        devRunId: runId,
        worktreePath: livePr.worktreePath ?? issueWorktreePath ?? '',
        prNumber: livePr.prNumber,
        prUrl: livePr.prUrl,
      };
    }

    // ── Dev-review advisor step with maxRevisionTurns loop (M19.25) ─────────
    // Runs after all WPs are committed, before the PR is opened.
    // Budget guard: skip if perCycleMaxUsd <= 0.
    let devReviewResponseCommitSha: string | undefined;
    let latestDevReviewGate: DevReviewGateInput | null = null;
    if (
      devReviewCfg.enabled &&
      shouldRunDevReview(devReviewCfg.triggerOn, workItem.priority) &&
      issueWorktreePath != null
    ) {
      if (devReviewCfg.perCycleMaxUsd <= 0) {
        append({
          projectId,
          workItemId: workItem.id,
          kind: 'dev-review.budget-skipped',
          payload: { runId, reason: 'perCycleMaxUsd is zero or negative' },
          runId,
        });
      } else {
        try {
          const maxTurns = Math.max(1, Math.min(5, devReviewCfg.maxRevisionTurns));
          let turns = 0;
          let latestDevReviewOutput: DevReviewOutput | null = null;
          let latestDevReviewResponse: DevReviewResponseOutput | null = null;
          let latestDevReviewResponseCommit: DevReviewGateInput['latestResponseCommit'] = null;
          let devReviewFailureReason: string | undefined;
          while (turns < maxTurns) {
            // Each iteration = one Codex dev-review call.
            // Use turn-scoped runId so multi-turn events are distinguishable.
            const turnRunId = turns === 0 ? runId : `${runId}:turn-${turns}`;
            let devReviewOutput: DevReviewOutput;
            try {
              devReviewOutput = await devReviewFn({
                runId: turnRunId,
                projectId,
                workItemId: workItem.id,
                workItem: {
                  title: workItem.title,
                  body: workItem.body,
                  number: Number(workItem.externalId),
                  priority: workItem.priority,
                },
                worktreePath: issueWorktreePath,
                baseBranch: workflowBase.branch,
                stack,
                runtime: deps.devReviewRuntime,
                appendEvent: append,
              });
            } catch (devReviewErr) {
              const msg = errorMessage(devReviewErr);
              append({
                projectId,
                workItemId: workItem.id,
                kind: 'dev-review.error',
                payload: { runId: turnRunId, error: msg },
                runId: turnRunId,
              });
              devReviewFailureReason = `Dev review failed: ${msg}`;
              break;
            }

            latestDevReviewOutput = devReviewOutput;

            if (devReviewOutput.verdict === 'no-blockers') break;
            // On the last turn, inconclusive = no more passes available; skip response.
            if (devReviewOutput.verdict === 'inconclusive' && turns === maxTurns - 1) break;

            // Re-fetch diff after any previous response commits so Codex sees current state.
            const currentDiff = getDiffFn(issueWorktreePath, workflowBase.branch);
            try {
              latestDevReviewResponse = await devReviewResponseFn({
                runId: turnRunId,
                projectId,
                workItemId: workItem.id,
                workItem: {
                  title: workItem.title,
                  body: workItem.body,
                  number: Number(workItem.externalId),
                  priority: workItem.priority,
                },
                prDiff: currentDiff,
                devReviewFindings: devReviewOutput.findings,
                worktreePath: issueWorktreePath,
                stack,
                runtime: deps.devReviewResponseRuntime,
                appendEvent: append,
              });
            } catch (responseErr) {
              const msg = errorMessage(responseErr);
              append({
                projectId,
                workItemId: workItem.id,
                kind: 'dev-review.response-failed',
                payload: { runId: `${turnRunId}:dev-review-response`, error: msg },
                runId: `${turnRunId}:dev-review-response`,
              });
              devReviewFailureReason = `Dev review response failed: ${msg}`;
              break;
            }
            // Commit response edits so the next iteration's Codex diff is current.
            let devReviewCommitResult: DevReviewGateInput['latestResponseCommit'];
            try {
              devReviewCommitResult = commitDevReviewFn(
                issueWorktreePath,
                `chore: dev-review-response turn-${turns} addressing/dismissing findings`,
              );
            } catch (commitErr) {
              const msg = errorMessage(commitErr);
              devReviewFailureReason = `Dev review response commit failed: ${msg}`;
              break;
            }
            latestDevReviewResponseCommit = devReviewCommitResult;
            if (devReviewCommitResult.status === 'committed') {
              devReviewResponseCommitSha = devReviewCommitResult.sha;
            }
            turns++;
          }
          latestDevReviewGate = {
            latestVerdict: latestDevReviewOutput,
            latestResponse: latestDevReviewResponse,
            latestResponseCommit: latestDevReviewResponseCommit,
            ...(devReviewFailureReason != null ? { failureReason: devReviewFailureReason } : {}),
          };
        } catch (devReviewErr) {
          latestDevReviewGate = {
            latestVerdict: null,
            latestResponse: null,
            latestResponseCommit: null,
            failureReason: `Dev review failed: ${errorMessage(devReviewErr)}`,
          };
        }
        if (latestDevReviewGate != null) {
          const gateResult = evaluateDevReviewGate(latestDevReviewGate);
          if (gateResult.status === 'blocked') {
            append({
              projectId,
              workItemId: workItem.id,
              kind: 'gate.awaiting-human',
              payload: {
                gate: 'dev-review',
                reason: gateResult.reason,
                blockerCount: gateResult.blockerCount,
                runDisposition: 'blocked-gate',
              },
              runId,
            });
            throw new BlockedGateError(gateResult.reason);
          }
        }
      }
    }

    if (devReviewResponseCommitSha != null && issueWorktreePath != null) {
      const pushedSha = verifyPersistedBranch({
        worktreePath: issueWorktreePath,
        integrationBranch,
        expectedCommitSha: devReviewResponseCommitSha,
        pushBranch: pushBranchFn,
        resolveRemoteBranchHead: resolveRemoteBranchHeadFn,
        context: 'persisting dev-review response',
        allowUnverifiedTestPersistence,
      });
      integrationHeadSha = pushedSha;
    }

    // All WPs committed — open PR.
    const token = process.env.GITHUB_TOKEN ?? '';
    if (!deps.openPRImpl && token.length === 0 && process.env.MOCK_OPEN_PR !== 'true') {
      throw new Error('GITHUB_TOKEN env var is required to open PR');
    }

    const linkedIssueRef = workItem.id.startsWith('local:')
      ? latestLinkedGithubIssue(workItem)
      : null;
    const repoRef = linkedIssueRef?.repoRef ?? stateSource.repoRef;
    const branchName = integrationBranch;
    const title = `M19.XX: ${workItem.title.slice(0, 50)}`;
    const closesIssueNumber =
      linkedIssueRef != null ? Number(linkedIssueRef.externalId) : Number(workItem.externalId);
    const shouldCloseGithubIssue =
      Number.isFinite(closesIssueNumber) &&
      (linkedIssueRef != null || !workItem.id.startsWith('local:'));
    const body = buildParallelPrBody({
      workItem,
      spec: specForRun,
      wpResults: allWpResults,
      closesIssueNumber: shouldCloseGithubIssue ? closesIssueNumber : null,
    });
    const expectedRemoteHead = devReviewResponseCommitSha ?? integrationHeadSha;
    if (expectedRemoteHead == null) {
      throw new PersistenceFailureError(
        'final-pre-pr-verification-failed',
        'final pre-PR verification failed: no expected integration commit',
      );
    }
    verifyPersistedBranch({
      worktreePath: issueWorktreePath ?? '',
      integrationBranch,
      expectedCommitSha: expectedRemoteHead,
      pushBranch: pushBranchFn,
      resolveRemoteBranchHead: resolveRemoteBranchHeadFn,
      context: 'final pre-PR verification',
      failureReason: 'final-pre-pr-verification-failed',
      allowUnverifiedTestPersistence,
    });

    const prResult = shouldCloseGithubIssue
      ? await openPRFn({
          worktreePath: issueWorktreePath ?? '',
          repo: repoRef,
          issueNumber: closesIssueNumber,
          title,
          body,
          branchName,
          baseBranch: workflowBase.branch,
          token,
          skipPush: true,
        })
      : await openLocalDbPRFn({
          worktreePath: issueWorktreePath ?? '',
          repo: repoRef,
          title,
          body,
          branchName,
          baseBranch: workflowBase.branch,
          token,
          skipPush: true,
        });

    if (workItem.id.startsWith('local:')) {
      upsertGithubExternalRefFn({
        projectId,
        workItemId: workItem.id,
        kind: 'pull_request',
        repoRef,
        externalId: String(prResult.prNumber),
        url: prResult.prUrl,
      });
      upsertGithubExternalRefFn({
        projectId,
        workItemId: workItem.id,
        kind: 'branch',
        repoRef,
        externalId: prResult.branch,
        metadata: { baseBranch: prResult.base },
      });
    }

    append({
      projectId,
      workItemId: workItem.id,
      kind: 'pr.opened',
      payload: {
        prNumber: prResult.prNumber,
        prUrl: prResult.prUrl,
        branch: prResult.branch,
        baseBranch: prResult.base,
        headSha: expectedRemoteHead,
        state: 'open',
        worktreePath: issueWorktreePath ?? '',
        devRunId: runId,
      },
      runId,
    });

    append({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-completed',
      payload: {
        runId,
        skill: 'parallel-implement',
        runDisposition: 'completed',
        prNumber: prResult.prNumber,
        branch: prResult.branch,
        baseBranch: prResult.base,
      },
      runId,
    });

    await stateSource.comment(
      workItem.externalId,
      buildAgentComment(
        'Dev',
        'Complete',
        `PR #${prResult.prNumber} opened — transitioning to needs-qa`,
        [`PR: ${prResult.prUrl}`],
      ),
    );

    return {
      status: 'success',
      devRunId: runId,
      worktreePath: issueWorktreePath ?? '',
      prNumber: prResult.prNumber,
      prUrl: prResult.prUrl,
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const persistenceFailure =
      error instanceof PersistenceFailureError
        ? { runDisposition: 'persistence-failed', persistenceFailureReason: error.reason }
        : undefined;
    const blockedGate =
      error instanceof BlockedGateError
        ? ({ runDisposition: 'blocked-gate' satisfies RunDisposition, gate: error.gate } as const)
        : undefined;
    append({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: {
        runId,
        skill: 'parallel-implement',
        error: error.message,
        ...(persistenceFailure ?? {}),
        ...(blockedGate ?? {}),
      },
      runId,
    });
    await stateSource.comment(
      workItem.externalId,
      buildAgentComment('Dev', 'Failed', 'Parallel implement failed — escalating', [
        `Error: ${error.message}`,
      ]),
    );
    return { status: 'failed', devRunId: runId, errorReason: error.message };
  } finally {
    cleanupWpsFn(runId, allWpIds);
    if (issueWorktreePath != null) {
      // Integration worktree persists until PR merge (QA reuses it). Cleanup on merge.
      // Scratch worktrees are removed immediately — they are build-only.
    }
  }
}
