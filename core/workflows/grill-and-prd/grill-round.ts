import type { GrillMeOutput } from '../../../skills/grill-me/schema.js';
import { GrillMeOutputSchema } from '../../../skills/grill-me/schema.js';
import type { AgentRuntime } from '../../agent-runtime/interface.js';
import { OutputValidationError, invokeSkill } from '../../agent-runtime/invoke-skill.js';
import { safeParseOutputForSchema } from '../../agent-runtime/output-normalization.js';
import type { ProjectConfig } from '../../types.js';
import type { ProjectContextBundle } from '../grill-and-prd.js';

export type GrillRoundOutcome =
  | { status: 'question'; question: string; recommendedAnswer?: string; output: GrillMeOutput }
  | { status: 'ready'; refinedIntent: string; output: GrillMeOutput; forced?: boolean }
  | { status: 'invalid'; error: string }
  | { status: 'failed'; error: string };

export interface RunGrillRoundInput {
  workItem: { id: string; title: string; body: string; externalId: string };
  projectId: string;
  workItemId: string;
  runId: string;
  workflowRunId: string;
  discoverSessionId: string;
  worktreePath: string;
  priorReplies: Array<{ role: 'user' | 'agent'; content: string; crystallized?: string }>;
  projectContext: ProjectContextBundle;
  codeGrounding?: unknown;
  scoutDigest?: unknown;
  projectConfig?: Pick<ProjectConfig, 'budgets' | 'stack' | 'targetRepo'> | null;
  deps?: { runtime?: AgentRuntime };
}

export async function runGrillRound(input: RunGrillRoundInput): Promise<GrillRoundOutcome> {
  const {
    workItem,
    projectId,
    workItemId,
    runId,
    workflowRunId,
    discoverSessionId,
    worktreePath,
    priorReplies,
    projectContext,
    codeGrounding,
    scoutDigest,
    projectConfig,
    deps,
  } = input;

  const roundNumber = priorReplies.filter((r) => r.role === 'agent').length + 1;

  let result: Awaited<ReturnType<typeof invokeSkill>>;

  try {
    result = await invokeSkill({
      skillName: 'grill-me',
      projectId,
      workItemId,
      runId,
      context: {
        projectId,
        workItemId,
        workItem: {
          title: workItem.title,
          body: workItem.body,
          number: workItem.externalId,
        },
        priorReplies,
        roundNumber,
        projectContext,
        ...(codeGrounding != null ? { codeGrounding } : {}),
        ...(scoutDigest != null ? { scoutDigest } : {}),
      },
      overrides: {
        workspaceDir: worktreePath,
        runtimeOverride: deps?.runtime,
        extraEventPayload: { roundNumber, workflowRunId, discoverSessionId },
        ...(projectConfig != null && { projectConfigOverride: projectConfig }),
      },
    });
  } catch (err) {
    if (err instanceof OutputValidationError) {
      return { status: 'invalid', error: err.message };
    }
    return { status: 'failed', error: String(err) };
  }

  const parsed = safeParseOutputForSchema(GrillMeOutputSchema, result.output);
  if (!parsed.success) {
    return { status: 'invalid', error: parsed.error.message };
  }

  const grillOutput = parsed.data;

  if (!grillOutput.readyForPRD && roundNumber > 7) {
    const refinedIntent =
      grillOutput.refinedIntent.trim() !== '' ? grillOutput.refinedIntent.trim() : workItem.body;
    return {
      status: 'ready',
      refinedIntent,
      output: { ...grillOutput, readyForPRD: true, refinedIntent },
      forced: true,
    };
  }

  if (!grillOutput.readyForPRD) {
    const questionEntry = grillOutput.questions[0];
    if (questionEntry == null || questionEntry.text.trim() === '') {
      return {
        status: 'invalid',
        error: 'grill-me returned readyForPRD:false with no questions',
      };
    }
    return {
      status: 'question',
      question: questionEntry.text,
      recommendedAnswer: questionEntry.recommendedAnswer ?? undefined,
      output: grillOutput,
    };
  }

  return { status: 'ready', refinedIntent: grillOutput.refinedIntent, output: grillOutput };
}
