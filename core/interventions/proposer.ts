import { randomUUID } from 'node:crypto';
import { invokeSkill } from '../agent-runtime/invoke-skill.js';
import { eventStore } from '../event-stream/store.js';
import { STATES, type StateName } from '../state-machine/states.js';
import { legalTargets } from '../state-machine/transitions.js';
import { validateInterventionAction } from './actions.js';
import {
  leaseForProposal,
  propose,
  recordProposalFailure,
  recoverStaleProposalLeases,
} from './reducer.js';
import { listInterventions } from './repository.js';
import {
  type InterventionActionOption,
  InterventionActionOptionSchema,
  type WorkItemIntervention,
} from './types.js';

export interface InterventionProposerRunResult {
  processed: number;
  proposed: number;
  failed: number;
  skipped: number;
}

export interface InterventionProposerWorkerDeps {
  invokeSkill?: typeof invokeSkill;
  now?: () => Date;
  runId?: () => string;
}

function isLeaseActive(intervention: WorkItemIntervention, now: Date): boolean {
  if (intervention.leaseOwner == null && intervention.leaseExpiresAt == null) return false;
  if (intervention.leaseExpiresAt == null) return true;
  return Date.parse(intervention.leaseExpiresAt) > now.getTime();
}

function inferCurrentState(intervention: WorkItemIntervention): StateName | null {
  const recentTransitions = eventStore.replay({
    projectId: intervention.projectId,
    workItemId: intervention.workItemId,
    kind: 'state.transitioned',
    order: 'desc',
    limit: 1,
  });
  const payload = recentTransitions[0]?.payload;
  if (payload == null || typeof payload !== 'object') return null;
  const to = (payload as Record<string, unknown>).to;
  if (typeof to !== 'string' || !(STATES as readonly string[]).includes(to)) return null;
  return to as StateName;
}

function buildContext(intervention: WorkItemIntervention): Record<string, unknown> {
  const state = inferCurrentState(intervention);
  const number = Number(intervention.workItemId.split('#').at(-1));
  return {
    intervention: {
      id: intervention.id,
      projectId: intervention.projectId,
      workItemId: intervention.workItemId,
      interventionType: intervention.interventionType,
      title: intervention.title,
      reason: intervention.reason,
      rootCauseSignature: intervention.rootCauseSignature,
      sourceEventId: intervention.sourceEventId,
    },
    workItem: {
      ...(Number.isFinite(number) ? { number } : {}),
      ...(state != null ? { state } : {}),
    },
    recentEvents: eventStore.replay({
      projectId: intervention.projectId,
      workItemId: intervention.workItemId,
      order: 'desc',
      limit: 20,
    }),
    ...(state != null ? { legalTargets: [...legalTargets(state)] } : {}),
  };
}

function parseProposedOptions(output: unknown): InterventionActionOption[] {
  if (output == null || typeof output !== 'object') {
    throw new Error('intervention-proposer returned no object output');
  }
  const options = (output as { options?: unknown }).options;
  return InterventionActionOptionSchema.array().min(1).parse(options);
}

function validateOptions(output: unknown) {
  const options = parseProposedOptions(output);
  for (const option of options) {
    const validation = validateInterventionAction(option.actionType, option.payload);
    if (!validation.ok) {
      throw new Error(`invalid proposed option '${option.actionType}': ${validation.error}`);
    }
  }
  return options;
}

export async function processInterventionProposal(input: {
  intervention: WorkItemIntervention;
  leaseOwner?: string;
  leaseMs?: number;
  deps?: InterventionProposerWorkerDeps;
}): Promise<'proposed' | 'failed' | 'skipped'> {
  const now = input.deps?.now?.() ?? new Date();
  if (input.intervention.status !== 'OPEN' || isLeaseActive(input.intervention, now)) {
    return 'skipped';
  }

  const leaseOwner = input.leaseOwner ?? 'intervention-proposer';
  const leased = leaseForProposal({
    id: input.intervention.id,
    expectedVersion: input.intervention.version,
    leaseOwner,
    leaseExpiresAt: new Date(now.getTime() + (input.leaseMs ?? 5 * 60_000)).toISOString(),
  });
  if (!leased.ok) return 'skipped';

  try {
    const runner = input.deps?.invokeSkill ?? invokeSkill;
    const runId = input.deps?.runId?.() ?? randomUUID();
    const result = await runner({
      skillName: 'intervention-proposer',
      projectId: leased.intervention.projectId,
      workItemId: leased.intervention.workItemId,
      runId,
      context: buildContext(leased.intervention),
    });
    const options = validateOptions(result.output);
    const proposed = propose({
      id: leased.intervention.id,
      expectedVersion: leased.intervention.version,
      options,
      actor: leaseOwner,
      evidence: { runId, personaId: result.personaId },
    });
    return proposed.ok ? 'proposed' : 'skipped';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = recordProposalFailure({
      id: leased.intervention.id,
      expectedVersion: leased.intervention.version,
      error: message,
      evidence: { name: err instanceof Error ? err.name : 'Error' },
      actor: leaseOwner,
    });
    return failed.ok ? 'failed' : 'skipped';
  }
}

export async function runInterventionProposerWorkerOnce(
  input: {
    projectId?: string;
    limit?: number;
    leaseOwner?: string;
    leaseMs?: number;
    deps?: InterventionProposerWorkerDeps;
  } = {},
): Promise<InterventionProposerRunResult> {
  recoverStaleProposalLeases({
    projectId: input.projectId,
    now: input.deps?.now?.(),
    actor: input.leaseOwner,
  });
  const now = input.deps?.now?.() ?? new Date();
  const candidates = listInterventions({
    projectId: input.projectId,
    status: 'OPEN',
    limit: input.limit ?? 25,
  }).filter((intervention) => !isLeaseActive(intervention, now));
  const result: InterventionProposerRunResult = {
    processed: 0,
    proposed: 0,
    failed: 0,
    skipped: 0,
  };
  for (const intervention of candidates) {
    result.processed += 1;
    const outcome = await processInterventionProposal({
      intervention,
      leaseOwner: input.leaseOwner,
      leaseMs: input.leaseMs,
      deps: input.deps,
    });
    result[outcome] += 1;
  }
  return result;
}

export function startInterventionProposerWorker(
  input: {
    projectId?: string;
    intervalMs?: number;
    limit?: number;
    leaseOwner?: string;
    leaseMs?: number;
    deps?: InterventionProposerWorkerDeps;
  } = {},
): () => void {
  const tick = () => {
    runInterventionProposerWorkerOnce(input).catch((err: unknown) => {
      console.error(`[intervention-proposer] worker tick failed: ${String(err)}`);
    });
  };
  tick();
  const timer = setInterval(tick, input.intervalMs ?? 30_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
