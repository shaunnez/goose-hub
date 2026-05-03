import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DeepRetroSchema } from '../../skills/retrospective-deep/schema.js';
import { LightRetroSchema } from '../../skills/retrospective-light/schema.js';
import { ClaudeCliRuntime } from '../agent-runtime/claude-cli.js';
import type { AgentRuntime } from '../agent-runtime/interface.js';
import { toJsonSchema } from '../agent-runtime/schema-bridge.js';
import { selectPersona } from '../agent-runtime/select-persona.js';
import { eventStore } from '../event-stream/store.js';
import type { StateSource, WorkItem } from '../state-source/interface.js';

const REPO_ROOT = join(import.meta.dirname, '../..');

function readPrompt(skillName: string): string {
  return readFileSync(join(REPO_ROOT, 'skills', skillName, 'skill.md'), 'utf8');
}

export type RetrospectivePolicy = 'always-light' | 'always-deep' | 'auto';

export interface TriggerContext {
  firstRunInMilestone?: boolean;
  qaFailed?: boolean;
  qualityScoreDeclining?: boolean;
  humanRequested?: boolean;
}

export interface RunRetrospectiveInput {
  workItem: WorkItem;
  stateSource: StateSource;
  projectId: string;
  policy: RetrospectivePolicy;
  triggers?: TriggerContext;
  deps?: { runtime?: AgentRuntime };
}

function selectTier(policy: RetrospectivePolicy, triggers: TriggerContext): 'light' | 'deep' {
  if (policy === 'always-light') return 'light';
  if (policy === 'always-deep') return 'deep';
  if (
    triggers.firstRunInMilestone ||
    triggers.qaFailed ||
    triggers.qualityScoreDeclining ||
    triggers.humanRequested
  ) {
    return 'deep';
  }
  return 'light';
}

export async function runRetrospectiveWorkflow(input: RunRetrospectiveInput): Promise<void> {
  const { workItem, stateSource, projectId, policy, triggers = {}, deps = {} } = input;
  const runId = crypto.randomUUID();
  const runtime = deps.runtime ?? new ClaudeCliRuntime();
  const tier = selectTier(policy, triggers);
  const skillName = tier === 'deep' ? 'retrospective-deep' : 'retrospective-light';
  const schema = tier === 'deep' ? DeepRetroSchema : LightRetroSchema;
  const prompt = readPrompt(skillName);
  const jsonSchema = toJsonSchema(schema);
  const personaId = selectPersona(projectId, 'retrospector');

  eventStore.appendEvent({
    kind: 'agent.run-started',
    projectId,
    workItemId: workItem.id,
    runId,
    payload: { skill: skillName, tier, personaId },
  });

  try {
    const result = await runtime.run({
      runId,
      role: 'retrospector',
      skill: skillName,
      context: {
        workItem: {
          title: workItem.title,
          body: workItem.body,
          number: Number(workItem.externalId),
        },
        runSummary: { personaId, role: 'retrospector', outcome: 'success', decisionSummaries: [] },
      },
      contextAllowlist: ['workItem.title', 'workItem.body', 'workItem.number', 'runSummary'],
      freshContext: false,
      toolBundles: ['core'],
      toolExtras: [],
      budgets: { maxTurns: 10, maxBudgetUsd: 0.5 },
      personaId,
      appendSystemPrompt: prompt,
      outputJsonSchema: jsonSchema,
    });

    eventStore.appendEvent({
      kind: 'retrospective.completed',
      projectId,
      workItemId: workItem.id,
      runId,
      payload: { tier, output: result.output },
    });

    for (const ds of result.decisionSummaries) {
      eventStore.appendEvent({
        kind: 'agent.decision-summary',
        projectId,
        workItemId: workItem.id,
        runId,
        payload: { skill: skillName, ...ds },
      });
    }

    await stateSource.transitionState(workItem.externalId, 'factory:retrospecting', 'factory:done');
  } catch (err) {
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      workItemId: workItem.id,
      runId,
      payload: { skill: skillName, error: String(err) },
    });
    await stateSource.transitionState(
      workItem.externalId,
      'factory:retrospecting',
      'factory:needs-human',
    );
  }
}
