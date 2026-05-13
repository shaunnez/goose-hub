import type { PRDOutput } from '../../../skills/write-prd/schema.js';
import { PRDOutputSchema } from '../../../skills/write-prd/schema.js';
import type { AgentRuntime } from '../../agent-runtime/interface.js';
import { OutputValidationError, invokeSkill } from '../../agent-runtime/invoke-skill.js';
import type { Priority } from '../../state-source/interface.js';
import type { ProjectConfig } from '../../types.js';
import type { ProjectContextBundle } from '../grill-and-prd.js';

export type PrdDraftOutcome =
  | { status: 'ok'; prdOutput: PRDOutput }
  | { status: 'invalid'; error: string }
  | { status: 'failed'; error: string };

export interface RunPrdDraftInput {
  workItem: { id: string; title: string; body: string; externalId: string; priority: Priority };
  projectId: string;
  workItemId: string;
  runId: string;
  workflowRunId: string;
  refinedIntent: string;
  fullProjectContext: ProjectContextBundle;
  projectConfig?: Pick<ProjectConfig, 'budgets' | 'stack' | 'targetRepo'> | null;
  priorReplies?: Array<{ role: 'user' | 'agent'; content: string; crystallized?: string }>;
  priorPrd?: PRDOutput;
  humanConcerns?: string[];
  deps?: { runtime?: AgentRuntime };
}

export async function runPrdDraft(input: RunPrdDraftInput): Promise<PrdDraftOutcome> {
  const {
    workItem,
    projectId,
    workItemId,
    runId,
    workflowRunId,
    refinedIntent,
    fullProjectContext,
    priorReplies,
    priorPrd,
    humanConcerns,
    deps,
  } = input;

  let result: Awaited<ReturnType<typeof invokeSkill>>;

  try {
    result = await invokeSkill({
      skillName: 'write-prd',
      projectId,
      workItemId,
      runId,
      context: {
        projectId,
        workItemId,
        workItem: {
          title: workItem.title,
          body: workItem.body,
          number: Number(workItem.externalId),
        },
        refinedIntent,
        priority: workItem.priority,
        projectContext: fullProjectContext,
        ...(priorReplies != null ? { priorReplies } : {}),
        ...(priorPrd != null ? { priorPrd } : {}),
        ...(humanConcerns != null ? { humanConcerns } : {}),
      },
      overrides: { runtimeOverride: deps?.runtime, extraEventPayload: { workflowRunId } },
    });
  } catch (err) {
    if (err instanceof OutputValidationError) {
      return { status: 'invalid', error: err.message };
    }
    return { status: 'failed', error: String(err) };
  }

  const parsed = PRDOutputSchema.safeParse(result.output);
  if (!parsed.success) {
    return { status: 'invalid', error: parsed.error.message };
  }

  return { status: 'ok', prdOutput: parsed.data };
}
