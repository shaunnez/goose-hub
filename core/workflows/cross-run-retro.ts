import { CrossRunRetroSchema } from '../../skills/retrospective-cross-run/schema.js';
import { resolveBudgets } from '../agent-runtime/budgets.js';
import { ClaudeCliRuntime } from '../agent-runtime/claude-cli.js';
import type { AgentRuntime } from '../agent-runtime/interface.js';
import { readPromptWithContext } from '../agent-runtime/read-prompt.js';
import { toJsonSchema } from '../agent-runtime/schema-bridge.js';
import { selectPersona } from '../agent-runtime/select-persona.js';
import { db } from '../db/db.js';
import { playbooks } from '../db/schema.js';
import { eventStore } from '../event-stream/store.js';
import { accumulatePersonaStats } from '../persona/accumulate.js';
import { getProjectBySlug } from '../projects/loader.js';

export interface CrossRunRetroInput {
  projectId: string;
  windowDateRange?: {
    startAt: string;
    endAt: string;
  };
  windowSize?: 'day' | 'week' | 'month';
  deps?: { runtime?: AgentRuntime };
}

function computeWindowBounds(
  windowSize?: 'day' | 'week' | 'month',
  dateRange?: { startAt: string; endAt: string },
): { startAt: string; endAt: string } {
  if (dateRange) {
    return dateRange;
  }

  const now = new Date();
  let daysBack = 7; // default week

  if (windowSize === 'day') daysBack = 1;
  else if (windowSize === 'month') daysBack = 30;

  const startAt = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);

  return {
    startAt: startAt.toISOString(),
    endAt: now.toISOString(),
  };
}

function getHistoricalGateScores(
  _projectId: string,
  _windowStart: string,
  _windowEnd: string,
): Array<{ gate: 'qa' | 'review'; scores: number[] }> {
  // TODO: #525 should provide lifecycle archives with gate scores
  // For now, return mock data
  return [
    { gate: 'qa', scores: [0.8, 0.85, 0.9, 0.75, 0.88, 0.92, 0.78, 0.87, 0.91, 0.84] },
    { gate: 'review', scores: [0.95, 0.88, 0.92, 0.97, 0.89, 0.94, 0.91, 0.96, 0.93, 0.9] },
  ];
}

function getHistoricalCosts(
  _projectId: string,
  _windowStart: string,
  _windowEnd: string,
): Array<{ role: string; skill: string; costs: number[] }> {
  // TODO: #525 should provide lifecycle archives with cost data
  // For now, return mock data
  return [
    {
      role: 'developer',
      skill: 'implement',
      costs: [0.22, 0.25, 0.28, 0.2, 0.24, 0.26, 0.23, 0.27],
    },
    {
      role: 'qa',
      skill: 'qa',
      costs: [0.15, 0.18, 0.12, 0.16, 0.19, 0.14, 0.17, 0.13],
    },
  ];
}

function getSampleRetroOutputs(
  _projectId: string,
  _windowStart: string,
  _windowEnd: string,
): Array<{
  workItemNumber: number;
  aggregatedLearnings: Array<{ observation: string }>;
  topPatterns: Array<{ pattern: string; occurrences: number }>;
}> {
  // TODO: #525 should provide archived retrospective outputs
  // For now, return mock data
  return [
    {
      workItemNumber: 100,
      aggregatedLearnings: [{ observation: 'TDD reduces rework' }],
      topPatterns: [{ pattern: 'Prefer vertical slice', occurrences: 5 }],
    },
    {
      workItemNumber: 101,
      aggregatedLearnings: [
        { observation: 'TDD reduces rework' },
        { observation: 'Tests provide confidence' },
      ],
      topPatterns: [{ pattern: 'Prefer vertical slice', occurrences: 4 }],
    },
    {
      workItemNumber: 102,
      aggregatedLearnings: [
        { observation: 'TDD reduces rework' },
        { observation: 'Tests provide confidence' },
        { observation: 'Early testing catches bugs' },
      ],
      topPatterns: [{ pattern: 'Prefer vertical slice', occurrences: 3 }],
    },
  ];
}

export async function runCrossRunRetroWorkflow(input: CrossRunRetroInput): Promise<void> {
  const { projectId, windowDateRange, windowSize, deps = {} } = input;
  const runId = crypto.randomUUID();
  const runtime = deps.runtime ?? new ClaudeCliRuntime();
  const skillName = 'retrospective-cross-run';
  const schema = CrossRunRetroSchema;
  const prompt = readPromptWithContext(skillName, projectId);
  const projectConfig = await getProjectBySlug(projectId);
  const jsonSchema = toJsonSchema(schema);
  const { personaId } = selectPersona(projectId, 'retrospector');

  const windowBounds = computeWindowBounds(windowSize, windowDateRange);
  const { startAt: windowStartAt, endAt: windowEndAt } = windowBounds;

  eventStore.appendEvent({
    kind: 'agent.run-started',
    projectId,
    runId,
    payload: { skill: skillName, personaId },
  });

  const sampleRetros = getSampleRetroOutputs(projectId, windowStartAt, windowEndAt);
  const historicalGates = getHistoricalGateScores(projectId, windowStartAt, windowEndAt);
  const historicalCosts = getHistoricalCosts(projectId, windowStartAt, windowEndAt);

  try {
    const result = await runtime.run({
      runId,
      role: 'retrospector',
      skill: skillName,
      context: {
        projectId,
        windowStartAt,
        windowEndAt,
        lifecycleCount: sampleRetros.length,
        sampleRetroOutputs: sampleRetros,
        historicalGateScores: historicalGates,
        historicalCosts: historicalCosts,
      },
      contextAllowlist: [
        'projectId',
        'windowStartAt',
        'windowEndAt',
        'lifecycleCount',
        'sampleRetroOutputs',
        'historicalGateScores',
        'historicalCosts',
      ],
      freshContext: false,
      toolBundles: ['core'],
      toolExtras: [],
      ...resolveBudgets(skillName, projectConfig?.budgets),
      personaId,
      appendSystemPrompt: prompt,
      outputJsonSchema: jsonSchema,
    });

    const parsed = CrossRunRetroSchema.safeParse(result.output);

    if (!parsed.success) {
      eventStore.appendEvent({
        kind: 'agent.run-failed',
        projectId,
        runId,
        payload: { skill: skillName, error: parsed.error.message },
      });
      accumulatePersonaStats({ personaName: personaId, role: 'retrospector', outcome: 'failure' });
      return;
    }

    // Persist playbook to database
    const manifestJson = JSON.stringify(parsed.data);
    db.insert(playbooks)
      .values({
        projectId,
        windowStartAt,
        windowEndAt,
        manifest: manifestJson,
      })
      .run();

    eventStore.appendEvent({
      kind: 'playbook.created',
      projectId,
      runId,
      payload: {
        skill: skillName,
        windowStartAt,
        windowEndAt,
        lifecycleCount: parsed.data.lifecycleCount,
      },
    });

    for (const ds of parsed.data.decisionSummaries) {
      eventStore.appendEvent({
        kind: 'agent.decision-summary',
        projectId,
        runId,
        payload: { skill: skillName, ...ds },
      });
    }

    accumulatePersonaStats({ personaName: personaId, role: 'retrospector', outcome: 'success' });
  } catch (err) {
    accumulatePersonaStats({ personaName: personaId, role: 'retrospector', outcome: 'failure' });
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      runId,
      payload: { skill: skillName, error: String(err) },
    });
  }
}
