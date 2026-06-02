import { randomUUID } from 'node:crypto';
import { invokeSkill } from '../agent-runtime/invoke-skill.js';
import { eventStore } from '../event-stream/store.js';
import { STATES, type StateName, TERMINAL_STATES } from '../state-machine/states.js';
import { legalTargets } from '../state-machine/transitions.js';
import { validateInterventionAction } from './actions.js';
import {
  leaseForProposal,
  propose,
  recordProposalFailure,
  recoverStaleProposalLeases,
  supersede,
} from './reducer.js';
import { listInterventionEvents, listOpenInterventionsReadyForProposal } from './repository.js';
import {
  type InterventionActionOption,
  InterventionActionOptionSchema,
  type InterventionType,
  type WorkItemIntervention,
} from './types.js';

const DEFAULT_PROPOSAL_FAILURE_LIMIT = 3;
const DEFAULT_PROPOSAL_RETRY_BASE_MS = 60_000;
const DEFAULT_PROPOSAL_RETRY_MAX_MS = 10 * 60_000;

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

function expectedStatesForType(type: InterventionType): readonly StateName[] | null {
  switch (type) {
    case 'needs_human':
      return ['factory:needs-human', 'factory:gate-pending'];
    case 'gate_pending':
      return ['factory:gate-pending'];
    case 'prd_review':
      return ['factory:prd-review'];
    case 'merge_conflict':
      return ['factory:merge-conflict'];
    case 'qa_disagreement':
    case 'manual_override':
    case 'workflow_route_escalation':
      return null;
  }
}

function staleReason(intervention: WorkItemIntervention, state: StateName | null): string | null {
  if (state == null) return null;
  if (TERMINAL_STATES.has(state)) return `latest state is terminal: ${state}`;
  const expected = expectedStatesForType(intervention.interventionType);
  if (expected != null && !expected.includes(state)) {
    return `${intervention.interventionType} applies only in ${expected.join(', ')}; latest state is ${state}`;
  }
  return null;
}

function supersedeStaleIntervention(input: {
  intervention: WorkItemIntervention;
  latestState: StateName;
  reason: string;
  actor: string;
}): boolean {
  const result = supersede({
    id: input.intervention.id,
    expectedVersion: input.intervention.version,
    supersededBy: `latest-state:${input.latestState}`,
    actor: input.actor,
    evidence: {
      reason: input.reason,
      latestState: input.latestState,
      interventionType: input.intervention.interventionType,
    },
  });
  return result.ok;
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

function proposalFailureCount(interventionId: string): number {
  let count = 0;
  const resetEvents = new Set(['propose', 'reopen', 'resolve', 'supersede', 'abort']);
  for (const event of [...listInterventionEvents(interventionId)].reverse()) {
    if (event.eventType === 'proposalFailed') count += 1;
    if (resetEvents.has(event.eventType)) break;
  }
  return count;
}

function proposalRetryDelayMs(input: {
  failureCount: number;
  baseMs?: number;
  maxMs?: number;
}): number {
  const baseMs = input.baseMs ?? DEFAULT_PROPOSAL_RETRY_BASE_MS;
  const maxMs = input.maxMs ?? DEFAULT_PROPOSAL_RETRY_MAX_MS;
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, input.failureCount - 1));
}

export function isGeneratedTestProjectId(projectId: string): boolean {
  return projectId.startsWith('goose-hub-self-discover-e2e-') || projectId.startsWith('test-');
}

export async function processInterventionProposal(input: {
  intervention: WorkItemIntervention;
  leaseOwner?: string;
  leaseMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  maxProposalFailures?: number;
  deps?: InterventionProposerWorkerDeps;
}): Promise<'proposed' | 'failed' | 'skipped'> {
  const now = input.deps?.now?.() ?? new Date();
  if (input.intervention.status !== 'OPEN' || isLeaseActive(input.intervention, now)) {
    return 'skipped';
  }

  const leaseOwner = input.leaseOwner ?? 'intervention-proposer';
  const currentState = inferCurrentState(input.intervention);
  const reason = staleReason(input.intervention, currentState);
  if (currentState != null && reason != null) {
    return supersedeStaleIntervention({
      intervention: input.intervention,
      latestState: currentState,
      reason,
      actor: leaseOwner,
    })
      ? 'skipped'
      : 'failed';
  }

  const leased = leaseForProposal({
    id: input.intervention.id,
    expectedVersion: input.intervention.version,
    leaseOwner,
    leaseExpiresAt: new Date(now.getTime() + (input.leaseMs ?? 5 * 60_000)).toISOString(),
  });
  if (!leased.ok) return 'skipped';

  const runId = input.deps?.runId?.() ?? randomUUID();
  try {
    const runner = input.deps?.invokeSkill ?? invokeSkill;
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
    const failureCount = proposalFailureCount(leased.intervention.id) + 1;
    const maxFailures = input.maxProposalFailures ?? DEFAULT_PROPOSAL_FAILURE_LIMIT;
    const retryDelayMs = proposalRetryDelayMs({
      failureCount,
      baseMs: input.retryBaseMs,
      maxMs: input.retryMaxMs,
    });
    const retryAt =
      failureCount >= maxFailures ? null : new Date(now.getTime() + retryDelayMs).toISOString();
    const failed = recordProposalFailure({
      id: leased.intervention.id,
      expectedVersion: leased.intervention.version,
      error: message,
      evidence: { name: err instanceof Error ? err.name : 'Error', runId },
      actor: leaseOwner,
      retryAt,
      failureCount,
      maxFailures,
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
    includeGeneratedTestProjects?: boolean;
    retryBaseMs?: number;
    retryMaxMs?: number;
    maxProposalFailures?: number;
    deps?: InterventionProposerWorkerDeps;
  } = {},
): Promise<InterventionProposerRunResult> {
  recoverStaleProposalLeases({
    projectId: input.projectId,
    now: input.deps?.now?.(),
    actor: input.leaseOwner,
  });
  const now = input.deps?.now?.() ?? new Date();
  const requestedLimit = input.limit ?? 25;
  const filtersGeneratedProjects =
    input.projectId == null && input.includeGeneratedTestProjects !== true;
  const candidates = listOpenInterventionsReadyForProposal({
    projectId: input.projectId,
    now: now.toISOString(),
    limit: requestedLimit,
    excludeGeneratedTestProjects: filtersGeneratedProjects,
  }).slice(0, requestedLimit);
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
      retryBaseMs: input.retryBaseMs,
      retryMaxMs: input.retryMaxMs,
      maxProposalFailures: input.maxProposalFailures,
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
    includeGeneratedTestProjects?: boolean;
    retryBaseMs?: number;
    retryMaxMs?: number;
    maxProposalFailures?: number;
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
