import { DeepRetroSchema } from '../../skills/retrospective-deep/schema.js';
import { LightRetroSchema } from '../../skills/retrospective-light/schema.js';
import { resolveBudgets } from '../agent-runtime/budgets.js';
import { ClaudeCliRuntime } from '../agent-runtime/claude-cli.js';
import type { AgentRuntime } from '../agent-runtime/interface.js';
import { readPromptWithContext } from '../agent-runtime/read-prompt.js';
import { toJsonSchema } from '../agent-runtime/schema-bridge.js';
import { selectPersona } from '../agent-runtime/select-persona.js';
import { db } from '../db/db.js';
import { improvementCandidates } from '../db/schema.js';
import { eventStore } from '../event-stream/store.js';
import { archiveLifecycle } from '../learning/archive.js';
import { computeTrend } from '../learning/convergence.js';
import { accumulatePersonaStats } from '../persona/accumulate.js';
import { getProjectBySlug } from '../projects/loader.js';
import type { ImprovementCandidate } from '../retrospective/schemas.js';
import type { StateSource, WorkItem } from '../state-source/interface.js';

export type RetrospectivePolicy = 'always-light' | 'always-deep' | 'auto';

export interface TriggerContext {
  firstRunInMilestone?: boolean;
  qaFailed?: boolean;
  qualityScoreDeclining?: boolean;
  humanRequested?: boolean;
  retriesGe2?: boolean;
  budgetExceeded?: boolean;
  priorityHigh?: boolean;
}

export interface RunRetrospectiveInput {
  workItem: WorkItem;
  stateSource: StateSource;
  projectId: string;
  policy: RetrospectivePolicy;
  triggers?: TriggerContext;
  deps?: { runtime?: AgentRuntime };
}

interface CandidateProvenance {
  runId: string;
  projectId: string;
  sourceWorkItem: string | null;
  personaId: string;
}

function persistCandidates(
  provenance: CandidateProvenance,
  candidates: ImprovementCandidate[],
): void {
  for (const c of candidates) {
    db.insert(improvementCandidates)
      .values({
        projectId: provenance.projectId,
        personaName: provenance.personaId,
        sourceTaskId: provenance.sourceWorkItem,
        suggestionText: c.suggestionText,
        suggestionType: c.kind,
      })
      .run();
  }
}

function selectTier(policy: RetrospectivePolicy, triggers: TriggerContext): 'light' | 'deep' {
  if (policy === 'always-light') return 'light';
  if (policy === 'always-deep') return 'deep';
  if (
    triggers.firstRunInMilestone ||
    triggers.qaFailed ||
    triggers.qualityScoreDeclining ||
    triggers.humanRequested ||
    triggers.retriesGe2 ||
    triggers.budgetExceeded ||
    triggers.priorityHigh
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
  const prompt = readPromptWithContext(skillName, projectId);
  const projectConfig = await getProjectBySlug(projectId);
  const jsonSchema = toJsonSchema(schema);
  const { personaId } = selectPersona(projectId, 'retrospector');

  const itemEvents = eventStore.replay({ projectId, workItemId: workItem.id });

  const priorDecisionSummaries = itemEvents
    .filter((e) => e.kind === 'agent.decision-summary')
    .map((e) => {
      const p = e.payload as { kind?: string; summary?: string; evidence?: string };
      return { kind: p.kind ?? 'VERDICT', summary: p.summary ?? '', evidence: p.evidence };
    });

  const activePersonas = Array.from(
    new Set(
      itemEvents
        .map((e) => e.personaId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  );

  // Collect unique roles from active persona IDs (format: projectId/role/slotIndex)
  const activeRoles = Array.from(
    new Set(
      activePersonas.map((pid) => {
        const parts = pid.split('/');
        return parts.length >= 2 ? (parts[parts.length - 2] ?? 'unknown') : 'unknown';
      }),
    ),
  );

  const roleTrends = activeRoles.map((role) => ({
    role,
    ...computeTrend({ projectId, role }),
  }));

  try {
    const result = await runtime.run({
      runId,
      role: 'retrospector',
      skill: skillName,
      context: {
        workItemId: workItem.id,
        workItem: {
          title: workItem.title,
          body: workItem.body,
          number: Number(workItem.externalId),
        },
        runSummary: {
          personaId,
          role: 'retrospector',
          outcome: 'success',
          decisionSummaries: priorDecisionSummaries,
        },
        activePersonas,
        roleTrends,
      },
      contextAllowlist: [
        'workItem.title',
        'workItem.body',
        'workItem.number',
        'runSummary',
        'activePersonas',
        'roleTrends',
      ],
      freshContext: false,
      toolBundles: ['core'],
      toolExtras: [],
      ...resolveBudgets(skillName, projectConfig?.budgets),
      personaId,
      appendSystemPrompt: prompt,
      outputJsonSchema: jsonSchema,
      extraEventPayload: { tier },
    });

    const parsed =
      tier === 'deep'
        ? DeepRetroSchema.safeParse(result.output)
        : LightRetroSchema.safeParse(result.output);

    if (!parsed.success) {
      eventStore.appendEvent({
        kind: 'agent.run-failed',
        projectId,
        workItemId: workItem.id,
        runId,
        payload: { skill: skillName, error: parsed.error.message },
      });
      accumulatePersonaStats({ personaName: personaId, role: 'retrospector', outcome: 'failure' });
      await stateSource.transitionState(
        workItem.externalId,
        'factory:retrospecting',
        'factory:needs-human',
      );
      return;
    }

    eventStore.appendEvent({
      kind: 'retrospective.completed',
      projectId,
      workItemId: workItem.id,
      runId,
      payload: { tier, output: result.output },
    });

    if (parsed.data.improvementCandidates.length > 0) {
      persistCandidates(
        { runId, projectId, sourceWorkItem: workItem.id, personaId },
        parsed.data.improvementCandidates,
      );
    }
    for (const ds of parsed.data.decisionSummaries) {
      eventStore.appendEvent({
        kind: 'agent.decision-summary',
        projectId,
        workItemId: workItem.id,
        runId,
        payload: { skill: skillName, ...ds },
      });
    }

    accumulatePersonaStats({ personaName: personaId, role: 'retrospector', outcome: 'success' });
    await stateSource.transitionState(workItem.externalId, 'factory:retrospecting', 'factory:done');
    // Archive only after the state transition succeeds — otherwise a transition
    // failure would leave a phantom archive row for a lifecycle that never
    // reached factory:done, skewing future mining and trend output.
    try {
      archiveLifecycle({ projectId, workItemId: workItem.id });
    } catch (archiveErr) {
      eventStore.appendEvent({
        kind: 'system.note',
        projectId,
        workItemId: workItem.id,
        runId,
        payload: { archiveError: String(archiveErr) },
      });
    }
  } catch (err) {
    accumulatePersonaStats({ personaName: personaId, role: 'retrospector', outcome: 'failure' });
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
