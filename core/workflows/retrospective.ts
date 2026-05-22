import { DeepRetroSchema } from '../../skills/retrospective-deep/schema.js';
import { LightRetroSchema } from '../../skills/retrospective-light/schema.js';
import type { AgentRuntime } from '../agent-runtime/interface.js';
import { safeParseOutputForSchema } from '../agent-runtime/output-normalization.js';
import { readPromptWithContext } from '../agent-runtime/read-prompt.js';
import { reconcileDecisionSummaries } from '../agent-runtime/reconcile-decisions.js';
import { resolveProjectAgentExecution } from '../agent-runtime/resolve-runtime-for-project.js';
import { toJsonSchema } from '../agent-runtime/schema-bridge.js';
import { selectPersona } from '../agent-runtime/select-persona.js';
import { runCodeQualityAudit } from '../audit/run-audit.js';
import { db } from '../db/db.js';
import { improvementCandidates } from '../db/schema.js';
import { transitionAndEmitState } from '../event-stream/state-transition.js';
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
  /** Local worktree to audit. When supplied AND deep retro fires on a
   * priority:high work item, the code-quality-audit skill runs as a tail
   * step (#698). Caller is responsible for providing a stable, fully
   * checked-out path — typically the dev worktree from the just-merged PR. */
  auditWorktreePath?: string | null;
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
        personaName: c.sourcePersonaId ?? provenance.personaId,
        sourceTaskId: provenance.sourceWorkItem,
        suggestionText: c.suggestionText,
        suggestionType: c.kind,
      })
      .run();
  }
}

function pipelineRunIdFromEvents(
  events: Array<{ kind: string; payload: unknown }>,
): string | undefined {
  for (const e of [...events].reverse()) {
    if (e.kind !== 'pr.opened') continue;
    const p = e.payload as { pipelineRunId?: string } | null;
    if (p?.pipelineRunId != null && typeof p.pipelineRunId === 'string') return p.pipelineRunId;
  }
  return undefined;
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
  const tier = selectTier(policy, triggers);
  const skillName = tier === 'deep' ? 'retrospective-deep' : 'retrospective-light';
  const schema = tier === 'deep' ? DeepRetroSchema : LightRetroSchema;
  const prompt = readPromptWithContext(skillName, projectId);
  const projectConfig = await getProjectBySlug(projectId);
  const { runtime, resolvedBudget } = resolveProjectAgentExecution({
    skill: skillName,
    role: 'retrospector',
    projectId,
    projectConfig,
    injectedRuntime: deps.runtime,
  });
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
  const triggerReasons = Object.entries(triggers)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);

  try {
    const result = await runtime.run({
      runId,
      role: 'retrospector',
      skill: skillName,
      workItemId: workItem.id,
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
        triggerReasons,
        activePersonas,
        roleTrends,
      },
      contextAllowlist: [
        'workItem.title',
        'workItem.body',
        'workItem.number',
        'runSummary',
        ...(tier === 'deep' ? ['triggerReasons'] : []),
        'activePersonas',
        'roleTrends',
      ],
      freshContext: false,
      toolBundles: ['core'],
      toolExtras: [],
      ...resolvedBudget,
      personaId,
      appendSystemPrompt: prompt,
      outputJsonSchema: jsonSchema,
      extraEventPayload: { tier },
    });

    const parsed =
      tier === 'deep'
        ? safeParseOutputForSchema(DeepRetroSchema, result.output)
        : safeParseOutputForSchema(LightRetroSchema, result.output);

    if (!parsed.success) {
      eventStore.appendEvent({
        kind: 'agent.run-failed',
        projectId,
        workItemId: workItem.id,
        runId,
        payload: { skill: skillName, error: parsed.error.message },
      });
      accumulatePersonaStats({ personaName: personaId, role: 'retrospector', outcome: 'failure' });
      await transitionAndEmitState({
        mode: 'legal',
        source: stateSource,
        itemId: workItem.externalId,
        projectId,
        workItemId: workItem.id,
        from: 'factory:retrospecting',
        to: 'factory:needs-human',
        by: skillName,
        runId,
      });
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
    reconcileDecisionSummaries(
      runId,
      projectId,
      workItem.id,
      skillName,
      parsed.data.decisionSummaries,
    );

    accumulatePersonaStats({ personaName: personaId, role: 'retrospector', outcome: 'success' });

    // ─── code-quality-audit hook (#698) ────────────────────────────────────────
    // Deep retro on a priority:high lifecycle gets a tail audit run when the
    // caller supplied a worktree. Top-3 audit recommendations become extra
    // ImprovementCandidates. Autonomy gate fires when audit_score < 60 in
    // autonomous mode — the lifecycle transitions to factory:needs-human
    // instead of factory:done so the human can review the architectural
    // regression before the next cycle starts.
    const shouldAudit =
      tier === 'deep' && triggers.priorityHigh === true && input.auditWorktreePath != null;

    let auditAutonomyGateFired = false;
    if (shouldAudit) {
      // Skip the audit cleanly when the tracker uses non-numeric IDs — the
      // skill's context schema requires `workItem.number: number` and
      // coercing a Jira-style ID would produce NaN.
      const numericIssue = /^\d+$/.test(workItem.externalId)
        ? Number.parseInt(workItem.externalId, 10)
        : null;
      if (numericIssue != null) {
        const auditResult = await runCodeQualityAudit({
          projectId,
          workItemId: workItem.id,
          worktreePath: input.auditWorktreePath as string,
          pipelineRunId: pipelineRunIdFromEvents(itemEvents),
          workItem: { title: workItem.title, number: numericIssue },
          trigger: 'deep-retro',
          mode: projectConfig?.mode ?? 'supervised',
        });
        if (auditResult.ok) {
          persistCandidates(
            { runId, projectId, sourceWorkItem: workItem.id, personaId },
            auditResult.improvementCandidates,
          );
          auditAutonomyGateFired = auditResult.autonomyGateFired;
        }
      }
    }

    if (auditAutonomyGateFired) {
      await transitionAndEmitState({
        mode: 'legal',
        source: stateSource,
        itemId: workItem.externalId,
        projectId,
        workItemId: workItem.id,
        from: 'factory:retrospecting',
        to: 'factory:needs-human',
        by: skillName,
        runId,
        extraPayload: { auditAutonomyGateFired: true },
      });
      // Skip archive — the lifecycle hasn't reached factory:done.
      return;
    }

    await transitionAndEmitState({
      mode: 'legal',
      source: stateSource,
      itemId: workItem.externalId,
      projectId,
      workItemId: workItem.id,
      from: 'factory:retrospecting',
      to: 'factory:done',
      by: skillName,
      runId,
    });
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
    await transitionAndEmitState({
      mode: 'legal',
      source: stateSource,
      itemId: workItem.externalId,
      projectId,
      workItemId: workItem.id,
      from: 'factory:retrospecting',
      to: 'factory:needs-human',
      by: skillName,
      runId,
    });
  }
}
