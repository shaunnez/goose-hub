import { inArray } from 'drizzle-orm';
import { db } from '../db/db.js';
import { agentRunCosts } from '../db/schema.js';
import { eventStore } from '../event-stream/store.js';
import { type StateName, TERMINAL_STATES } from '../state-machine/states.js';
import {
  interventionTimestamp,
  listAllInterventions,
  listInterventionEvents,
  listInterventions,
} from './repository.js';
import { ACTIVE_INTERVENTION_STATUSES, type InterventionType } from './types.js';

export interface InterventionAuditReport {
  generatedAt: string;
  activeByProjectType: Array<{
    projectId: string;
    interventionType: InterventionType;
    count: number;
  }>;
  activeTerminalStateRows: Array<{
    interventionId: string;
    projectId: string;
    workItemId: string;
    interventionType: InterventionType;
    status: string;
    latestState: StateName;
  }>;
  repeatedProposalFailures: Array<{
    interventionId: string;
    projectId: string;
    workItemId: string;
    interventionType: InterventionType;
    failureCount: number;
    lastError: string | null;
  }>;
  proposerCosts: Array<{
    interventionId: string;
    projectId: string;
    workItemId: string;
    runIds: string[];
    estimatedCostUsd: number;
  }>;
}

function latestWorkItemState(input: { projectId: string; workItemId: string }): StateName | null {
  const [transition] = eventStore.replay({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'state.transitioned',
    order: 'desc',
    limit: 1,
  });
  const payload = transition?.payload;
  if (payload == null || typeof payload !== 'object') return null;
  const to = (payload as Record<string, unknown>).to;
  if (typeof to !== 'string' || !TERMINAL_STATES.has(to as StateName)) return null;
  return to as StateName;
}

function payloadObject(payload: unknown): Record<string, unknown> {
  return payload != null && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
}

function failureError(payload: unknown): string | null {
  const error = payloadObject(payload).error;
  return typeof error === 'string' ? error : null;
}

function proposerRunId(payload: unknown): string | null {
  const evidence = payloadObject(payload).evidence;
  if (evidence == null || typeof evidence !== 'object') return null;
  const runId = (evidence as Record<string, unknown>).runId;
  return typeof runId === 'string' && runId.length > 0 ? runId : null;
}

export function loadInterventionAuditReport(
  input: {
    projectId?: string;
    limit?: number;
  } = {},
): InterventionAuditReport {
  const interventions =
    input.limit == null
      ? listAllInterventions({ projectId: input.projectId })
      : listInterventions({ projectId: input.projectId, limit: input.limit });
  const active = interventions.filter((intervention) =>
    ACTIVE_INTERVENTION_STATUSES.has(intervention.status),
  );

  const activeCounts = new Map<string, InterventionAuditReport['activeByProjectType'][number]>();
  for (const intervention of active) {
    const key = `${intervention.projectId}\0${intervention.interventionType}`;
    const current =
      activeCounts.get(key) ??
      ({
        projectId: intervention.projectId,
        interventionType: intervention.interventionType,
        count: 0,
      } satisfies InterventionAuditReport['activeByProjectType'][number]);
    current.count += 1;
    activeCounts.set(key, current);
  }

  const activeTerminalStateRows = active.flatMap((intervention) => {
    const latestState = latestWorkItemState(intervention);
    if (latestState == null) return [];
    return [
      {
        interventionId: intervention.id,
        projectId: intervention.projectId,
        workItemId: intervention.workItemId,
        interventionType: intervention.interventionType,
        status: intervention.status,
        latestState,
      },
    ];
  });

  const runIdsByIntervention = new Map<string, Set<string>>();
  const repeatedProposalFailures: InterventionAuditReport['repeatedProposalFailures'] = [];
  for (const intervention of interventions) {
    const events = listInterventionEvents(intervention.id);
    const proposalFailures = events.filter((event) => event.eventType === 'proposalFailed');
    for (const event of events) {
      const runId = proposerRunId(event.payload);
      if (runId == null) continue;
      const runIds = runIdsByIntervention.get(intervention.id) ?? new Set<string>();
      runIds.add(runId);
      runIdsByIntervention.set(intervention.id, runIds);
    }
    if (proposalFailures.length < 2) continue;
    repeatedProposalFailures.push({
      interventionId: intervention.id,
      projectId: intervention.projectId,
      workItemId: intervention.workItemId,
      interventionType: intervention.interventionType,
      failureCount: proposalFailures.length,
      lastError: failureError(proposalFailures.at(-1)?.payload),
    });
  }

  const allRunIds = [
    ...new Set([...runIdsByIntervention.values()].flatMap((runIds) => [...runIds])),
  ];
  const costs =
    allRunIds.length === 0
      ? []
      : db
          .select({
            runId: agentRunCosts.runId,
            costUsd: agentRunCosts.costUsd,
          })
          .from(agentRunCosts)
          .where(inArray(agentRunCosts.runId, allRunIds))
          .all();
  const costByRunId = new Map(costs.map((row) => [row.runId, row.costUsd]));
  const interventionById = new Map(
    interventions.map((intervention) => [intervention.id, intervention]),
  );
  const proposerCosts = [...runIdsByIntervention.entries()]
    .map(([interventionId, runIdSet]) => {
      const intervention = interventionById.get(interventionId);
      const runIds = [...runIdSet].sort();
      if (intervention == null || runIds.length === 0) return null;
      const estimatedCostUsd = runIds.reduce(
        (sum, runId) => sum + (costByRunId.get(runId) ?? 0),
        0,
      );
      return {
        interventionId,
        projectId: intervention.projectId,
        workItemId: intervention.workItemId,
        runIds,
        estimatedCostUsd,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  return {
    generatedAt: interventionTimestamp(),
    activeByProjectType: [...activeCounts.values()].sort((a, b) =>
      `${a.projectId}:${a.interventionType}`.localeCompare(`${b.projectId}:${b.interventionType}`),
    ),
    activeTerminalStateRows,
    repeatedProposalFailures,
    proposerCosts,
  };
}

export function formatInterventionAuditReport(report: InterventionAuditReport): string {
  const lines = [`Operator intervention audit (${report.generatedAt})`, ''];

  lines.push('Active interventions by project/type:');
  if (report.activeByProjectType.length === 0) {
    lines.push('- none');
  } else {
    for (const row of report.activeByProjectType) {
      lines.push(`- ${row.projectId} ${row.interventionType}: ${row.count}`);
    }
  }
  lines.push('');

  lines.push('Active interventions with terminal latest state:');
  if (report.activeTerminalStateRows.length === 0) {
    lines.push('- none');
  } else {
    for (const row of report.activeTerminalStateRows) {
      lines.push(
        `- ${row.interventionId} ${row.projectId} ${row.workItemId} ${row.interventionType} ${row.status} latest=${row.latestState}`,
      );
    }
  }
  lines.push('');

  lines.push('Rows with repeated proposalFailed events:');
  if (report.repeatedProposalFailures.length === 0) {
    lines.push('- none');
  } else {
    for (const row of report.repeatedProposalFailures) {
      lines.push(
        `- ${row.interventionId} ${row.projectId} ${row.workItemId} ${row.interventionType}: ${row.failureCount} failures last=${row.lastError ?? 'unknown'}`,
      );
    }
  }
  lines.push('');

  lines.push('Estimated proposer cost by intervention id:');
  if (report.proposerCosts.length === 0) {
    lines.push('- none');
  } else {
    for (const row of report.proposerCosts) {
      lines.push(
        `- ${row.interventionId} ${row.projectId} ${row.workItemId}: $${row.estimatedCostUsd.toFixed(6)} runs=${row.runIds.join(',')}`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}
