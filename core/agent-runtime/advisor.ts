import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import advisorConfig from '@goose-hub/skills/advise-on-plan/config.js';
import {
  type AdviseOnPlanOutput,
  AdviseOnPlanSchema,
} from '@goose-hub/skills/advise-on-plan/schema.js';
import { eventStore } from '../event-stream/store.js';
import { ClaudeCliRuntime } from './claude-cli.js';
import type { AgentRuntime } from './interface.js';
import { toJsonSchema } from './schema-bridge.js';
import { selectPersona } from './select-persona.js';

interface AdviseOnPlanInput {
  runId: string;
  projectId: string;
  workItemId: string;
  workItem: { title: string; body: string; number: number; priority: 'high' | 'critical' };
  plan: string;
  /** Pass 0 (first review) by default; 1 for the post-revise re-spawn. */
  revisionPass?: 0 | 1;
  /** The advisor's own pass-0 output, only present when revisionPass === 1. */
  previousAdvisorFeedback?: string;
  /** Optional runtime override — defaults to a new ClaudeCliRuntime. */
  runtime?: AgentRuntime;
}

const ADVISOR_GATED_PRIORITIES = new Set(['high', 'critical']);

/**
 * adviseOnPlan(input) (#182).
 *
 * Wraps the advise-on-plan skill in a fresh-context spawn for high/critical
 * priority work items. Returns the typed advisor output. The caller (the
 * fix-issue workflow, M7.05) inspects the verdict and decides whether to
 * proceed, re-spawn the primary with feedback, or escalate to human.
 *
 * Side effect: emits one agent.decision-summary event per entry in the
 * advisor's decisionSummaries array, plus an agent.run-failed event when
 * the priority is not advisor-gated (catches caller bugs).
 *
 * Throws if the priority isn't 'high'|'critical' (call-site mistake) OR
 * the advisor output fails Zod validation (skill misbehaviour).
 */
export async function adviseOnPlan(input: AdviseOnPlanInput): Promise<AdviseOnPlanOutput> {
  if (!ADVISOR_GATED_PRIORITIES.has(input.workItem.priority)) {
    throw new Error(
      `adviseOnPlan called with priority='${input.workItem.priority}' — only high/critical are advisor-gated`,
    );
  }

  const runtime = input.runtime ?? new ClaudeCliRuntime();
  const personaId = selectPersona(input.projectId, 'researcher');
  const advisorPrompt = readSkillPrompt('advise-on-plan');
  const outputJsonSchema = toJsonSchema(AdviseOnPlanSchema) as Record<string, unknown>;

  const result = await runtime.run({
    runId: input.runId,
    role: advisorConfig.role ?? 'researcher',
    skill: 'advise-on-plan',
    context: {
      projectId: input.projectId,
      workItemId: input.workItemId,
      workItem: input.workItem,
      plan: input.plan,
      revisionPass: input.revisionPass ?? 0,
      previousAdvisorFeedback: input.previousAdvisorFeedback,
    },
    contextAllowlist: advisorConfig.contextAllowlist ?? [],
    freshContext: advisorConfig.freshContext as true,
    toolBundles: advisorConfig.toolBundles,
    toolExtras: [],
    budgets: { maxTurns: 8, maxBudgetUsd: 0.2 },
    personaId,
    outputJsonSchema,
    appendSystemPrompt: advisorPrompt,
  });

  const parsed = AdviseOnPlanSchema.safeParse(result.output);
  if (!parsed.success) {
    eventStore.appendEvent({
      projectId: input.projectId,
      workItemId: input.workItemId,
      kind: 'agent.run-failed',
      payload: { runId: input.runId, error: 'advise-on-plan output validation failed' },
      runId: input.runId,
    });
    throw new Error('advise-on-plan output validation failed');
  }

  // Emit each advisor decision summary as a separate event (#206 pattern).
  for (const summary of parsed.data.decisionSummaries) {
    eventStore.appendEvent({
      projectId: input.projectId,
      workItemId: input.workItemId,
      kind: 'agent.decision-summary',
      payload: { skill: 'advise-on-plan', ...summary },
      runId: input.runId,
    });
  }

  return parsed.data;
}

function readSkillPrompt(skillName: string): string {
  const skillRoot = join(import.meta.dirname, '..', '..', 'skills', skillName);
  return readFileSync(join(skillRoot, 'skill.md'), 'utf8');
}
