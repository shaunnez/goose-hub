import type { z } from 'zod';
import { getProjectBySlug } from '../../../projects/loader.js';
import { recordDecision } from '../../tools/record-decision.js';
import { emitToolCall } from '../audit.js';
import type { FactoryContext } from '../context.js';
import type {
  GetProjectContextInput,
  GetStackCommandsInput,
  RecordDecisionInput,
} from '../schemas.js';

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

  const result: GetProjectContextResult = {
    id: project.id,
    name: project.name,
    slug: project.slug,
    mode: project.mode,
    activeMilestone: project.activeMilestone ?? null,
    repos: project.repos ?? [],
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

  const stack = project.stack;
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

  if (result.recorded) return { recorded: true, id: result.id };
  return { recorded: false, id: result.id, reason: result.reason };
}
