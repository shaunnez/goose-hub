import type { z } from 'zod';
import { eventStore } from '../../../event-stream/store.js';
import { getProjectBySlug } from '../../../projects/loader.js';
import type { WorkItem } from '../../../state-source/interface.js';
import { listLocalDbRepoLinks } from '../../../workspaces/repo-affinity.js';
import { stackCommandsForWorktree } from '../../../workspaces/stack-commands.js';
import { recordDecision } from '../../tools/record-decision.js';
import { emitToolCall } from '../audit.js';
import type { FactoryContext } from '../context.js';
import type {
  GetProjectContextInput,
  GetStackCommandsInput,
  GetWorkItemInput,
  RecordDecisionInput,
} from '../schemas.js';
import { getStateSourceForProject } from './_github.js';

export class ToolDataMissingError extends Error {
  readonly kind = 'ToolDataMissingError' as const;
  readonly tool: string;

  constructor(tool: string, message: string) {
    super(message);
    this.name = 'ToolDataMissingError';
    this.tool = tool;
  }
}

export interface GetProjectContextResult {
  id: string;
  name: string;
  slug: string;
  mode: string;
  activeMilestone: string | null;
  repos: ReadonlyArray<string>;
  repositories: ReadonlyArray<{
    id: string;
    repoRef: string;
    localPath: string | null;
    defaultBranch: string;
    role: string;
    selectedForWorkItem: boolean;
  }>;
}

export interface GetStackCommandsResult {
  runtime: string;
  packageManager: string;
  buildCommand: string | null;
  testCommand: string | null;
  lintCommand: string | null;
  typecheckCommand: string | null;
  e2eCommand: string | null;
}

export interface RecordDecisionResult {
  recorded: boolean;
  id: string;
  reason?: 'duplicate';
}

/**
 * `factory_get_project_context` — returns the run's project config slice the
 * agent is allowed to see. Holdout-safe: no persona/budget detail, no model
 * config, no governance pointers.
 */
export async function getProjectContext(
  ctx: FactoryContext,
  _input: z.infer<typeof GetProjectContextInput> = {},
): Promise<GetProjectContextResult> {
  const project = await getProjectBySlug(ctx.projectId);
  if (project == null) {
    throw new ToolDataMissingError(
      'get_project_context',
      `No project config found for slug '${ctx.projectId}'.`,
    );
  }
  const linkedRepoRefs = new Set(
    listLocalDbRepoLinks(project.id, ctx.workItemId).map((link) => link.repoRef),
  );

  const result: GetProjectContextResult = {
    id: project.id,
    name: project.name,
    slug: project.slug,
    mode: project.mode,
    activeMilestone: project.activeMilestone ?? null,
    repos: project.repos ?? [],
    repositories: (project.repositories ?? []).map((repo) => ({
      id: repo.id,
      repoRef: repo.repoRef,
      localPath: repo.localPath ?? null,
      defaultBranch: repo.defaultBranch,
      role: repo.role ?? 'unknown',
      selectedForWorkItem:
        linkedRepoRefs.has(repo.repoRef) ||
        (ctx.workItemId.length > 0 &&
          (ctx.workItemId.includes(repo.repoRef) || ctx.workspaceRoot === repo.localPath)),
    })),
  };

  emitToolCall(ctx, { tool: 'get_project_context', input: {}, status: 'ok' });
  return result;
}

/**
 * `factory_get_stack_commands` — exposes the project's stack commands so an
 * agent can call `run_tests` / `run_lint` / `run_typecheck` knowing which
 * argv Factory will construct. The agent does not run these strings itself.
 */
export async function getStackCommands(
  ctx: FactoryContext,
  _input: z.infer<typeof GetStackCommandsInput> = {},
): Promise<GetStackCommandsResult> {
  const project = await getProjectBySlug(ctx.projectId);
  if (project == null) {
    throw new ToolDataMissingError(
      'get_stack_commands',
      `No project config found for slug '${ctx.projectId}'.`,
    );
  }

  const stack = await stackCommandsForWorktree(ctx.workspaceRoot, project.stack);
  const result: GetStackCommandsResult = {
    runtime: stack.runtime,
    packageManager: stack.packageManager,
    buildCommand: stack.buildCommand ?? null,
    testCommand: stack.testCommand ?? null,
    lintCommand: stack.lintCommand ?? null,
    typecheckCommand: stack.typecheckCommand ?? null,
    e2eCommand: stack.e2eCommand ?? null,
  };

  emitToolCall(ctx, { tool: 'get_stack_commands', input: {}, status: 'ok' });
  return result;
}

export interface GetWorkItemResult {
  id: string;
  externalId: string;
  repoRef: string | null;
  title: string;
  body: string;
  type: WorkItem['type'];
  priority: WorkItem['priority'];
  state: WorkItem['state'];
  schedule: WorkItem['schedule'];
  milestoneTitle: string | null;
  dependsOn: ReadonlyArray<string>;
  blocks: ReadonlyArray<string>;
}

/**
 * `factory_get_work_item` — returns the run's work item from the state
 * source. Holdout-safe: omits parentId/authorIsOwner/createdAt; QA and
 * Review need title + body + state, not the meta fields. Token is read
 * from the orchestrator env (FACTORY_GITHUB_TOKEN / GITHUB_TOKEN).
 */
export async function getWorkItem(
  ctx: FactoryContext,
  _input: z.infer<typeof GetWorkItemInput> = {},
): Promise<GetWorkItemResult> {
  if (ctx.workItemId.length === 0) {
    throw new ToolDataMissingError(
      'get_work_item',
      `Run ${ctx.runId} has no work item id; factory_get_work_item is not applicable.`,
    );
  }

  const source = await getStateSourceForProject(ctx.projectId);
  const item = await source.getItem(ctx.workItemId);

  const result: GetWorkItemResult = {
    id: item.id,
    externalId: item.externalId,
    repoRef: item.repoRef,
    title: item.title,
    body: item.body,
    type: item.type,
    priority: item.priority,
    state: item.state,
    schedule: item.schedule,
    milestoneTitle: item.milestoneTitle ?? null,
    dependsOn: item.dependsOn,
    blocks: item.blocks,
  };

  emitToolCall(ctx, {
    tool: 'get_work_item',
    input: { workItemId: ctx.workItemId },
    status: 'ok',
  });
  return result;
}

/**
 * `factory_record_decision` — wraps the existing SQLite-backed
 * `recordDecision()` helper. Inputs are validated by `RecordDecisionInput`
 * (which constrains `kind` to the canonical `DecisionKindSchema` enum), so
 * unrecognized kinds fail before the DB write rather than coercing to
 * 'UNKNOWN'.
 */
export function recordDecisionTool(
  ctx: FactoryContext,
  input: z.infer<typeof RecordDecisionInput>,
): RecordDecisionResult {
  const result = recordDecision({
    runId: ctx.runId,
    kind: input.kind,
    what: input.what,
    why: input.why,
    iteration: input.iteration,
    phase: input.phase,
  });

  emitToolCall(ctx, {
    tool: 'record_decision',
    input: { kind: input.kind },
    status: 'ok',
  });

  if (result.recorded) {
    eventStore.appendEvent({
      projectId: ctx.projectId,
      workItemId: ctx.workItemId,
      runId: ctx.runId,
      personaId: ctx.personaId ?? null,
      kind: 'agent.decision-summary-live',
      payload: {
        run_id: ctx.runId,
        kind: input.kind,
        summary: input.what,
        evidence: input.why,
        timestamp: new Date().toISOString(),
        ...(ctx.skill != null ? { skill: ctx.skill } : {}),
        ...(ctx.personaId != null ? { personaId: ctx.personaId } : {}),
      },
    });
    return { recorded: true, id: result.id };
  }
  return { recorded: false, id: result.id, reason: result.reason };
}
