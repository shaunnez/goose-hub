import type { StateName } from '../state-machine/states.js';
import { validateInterventionAction } from './actions.js';
import {
  markApplying,
  recordApplicationResult,
  recoverStaleApplying,
  resolve,
  verify,
} from './reducer.js';
import { listInterventions } from './repository.js';
import type { WorkItemIntervention } from './types.js';

export interface InterventionApplierDeps {
  transitionState(input: {
    projectId: string;
    workItemId: string;
    from: StateName;
    to: StateName;
    interventionId: string;
    correlationId: string;
    reason?: string;
  }): Promise<unknown>;
  approveGate?(input: {
    projectId: string;
    workItemId: string;
    interventionId: string;
    correlationId: string;
  }): Promise<unknown>;
  rejectGate?(input: {
    projectId: string;
    workItemId: string;
    reason: string;
    interventionId: string;
    correlationId: string;
  }): Promise<unknown>;
  resumeWorkflow?(input: {
    projectId: string;
    workItemId: string;
    interventionId: string;
    correlationId: string;
  }): Promise<unknown>;
  resolveConflict?(input: {
    projectId: string;
    workItemId: string;
    interventionId: string;
    correlationId: string;
  }): Promise<unknown>;
}

export async function applyDecidedIntervention(input: {
  intervention: WorkItemIntervention;
  leaseOwner: string;
  leaseMs?: number;
  deps: InterventionApplierDeps;
}): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const actionType = input.intervention.decidedActionType;
  if (actionType == null) return { ok: false, error: 'intervention has no decided action' };

  const validation = validateInterventionAction(
    actionType,
    input.intervention.decidedActionPayload,
  );
  if (!validation.ok) return { ok: false, error: validation.error };

  const lease = markApplying({
    id: input.intervention.id,
    expectedVersion: input.intervention.version,
    leaseOwner: input.leaseOwner,
    leaseExpiresAt: new Date(Date.now() + (input.leaseMs ?? 5 * 60_000)).toISOString(),
  });
  if (!lease.ok) return { ok: false, error: lease.error };

  try {
    let result: unknown;
    if (actionType === 'manual_transition') {
      const payload = validation.data as { from: StateName; to: StateName; reason?: string };
      result = await input.deps.transitionState({
        projectId: input.intervention.projectId,
        workItemId: input.intervention.workItemId,
        from: payload.from,
        to: payload.to,
        interventionId: input.intervention.id,
        correlationId: input.intervention.correlationId,
        reason: payload.reason,
      });
    } else if (actionType === 'approve_gate' && input.deps.approveGate != null) {
      result = await input.deps.approveGate({
        projectId: input.intervention.projectId,
        workItemId: input.intervention.workItemId,
        interventionId: input.intervention.id,
        correlationId: input.intervention.correlationId,
      });
    } else if (actionType === 'reject_gate' && input.deps.rejectGate != null) {
      const payload = validation.data as { reason: string };
      result = await input.deps.rejectGate({
        projectId: input.intervention.projectId,
        workItemId: input.intervention.workItemId,
        reason: payload.reason,
        interventionId: input.intervention.id,
        correlationId: input.intervention.correlationId,
      });
    } else if (actionType === 'resume_workflow' && input.deps.resumeWorkflow != null) {
      result = await input.deps.resumeWorkflow({
        projectId: input.intervention.projectId,
        workItemId: input.intervention.workItemId,
        interventionId: input.intervention.id,
        correlationId: input.intervention.correlationId,
      });
    } else if (actionType === 'resolve_conflict' && input.deps.resolveConflict != null) {
      result = await input.deps.resolveConflict({
        projectId: input.intervention.projectId,
        workItemId: input.intervention.workItemId,
        interventionId: input.intervention.id,
        correlationId: input.intervention.correlationId,
      });
    } else if (actionType === 'no_action') {
      result = { ok: true, skipped: true };
    } else {
      throw new Error(`no applier registered for action type '${actionType}'`);
    }

    const applied = recordApplicationResult({
      id: input.intervention.id,
      expectedVersion: lease.intervention.version,
      ok: true,
      result,
      actor: input.leaseOwner,
    });
    if (!applied.ok) return { ok: false, error: applied.error };
    const verified = verify({
      id: input.intervention.id,
      expectedVersion: applied.intervention.version,
      verification: { mode: 'applier-result', result },
      actor: input.leaseOwner,
    });
    if (!verified.ok) return { ok: false, error: verified.error };
    const resolved = resolve({
      id: input.intervention.id,
      expectedVersion: verified.intervention.version,
      reason: 'applier completed',
      actor: input.leaseOwner,
    });
    if (!resolved.ok) return { ok: false, error: resolved.error };
    return { ok: true, result };
  } catch (err) {
    const failed = recordApplicationResult({
      id: input.intervention.id,
      expectedVersion: lease.intervention.version,
      ok: false,
      result: { error: err instanceof Error ? err.message : String(err) },
      actor: input.leaseOwner,
    });
    if (!failed.ok) return { ok: false, error: failed.error };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface InterventionApplierRunResult {
  processed: number;
  applied: number;
  failed: number;
  skipped: number;
}

export async function runInterventionApplierWorkerOnce(input: {
  deps: InterventionApplierDeps;
  projectId?: string;
  limit?: number;
  leaseOwner?: string;
  leaseMs?: number;
  now?: Date;
}): Promise<InterventionApplierRunResult> {
  recoverStaleApplying({ now: input.now, actor: input.leaseOwner });
  const candidates = listInterventions({
    projectId: input.projectId,
    status: 'DECIDED',
    limit: input.limit ?? 25,
  });
  const result: InterventionApplierRunResult = {
    processed: 0,
    applied: 0,
    failed: 0,
    skipped: 0,
  };

  for (const intervention of candidates) {
    result.processed += 1;
    const applied = await applyDecidedIntervention({
      intervention,
      leaseOwner: input.leaseOwner ?? 'intervention-applier',
      leaseMs: input.leaseMs,
      deps: input.deps,
    });
    if (applied.ok) {
      result.applied += 1;
    } else {
      result.failed += 1;
    }
  }
  return result;
}

export function startInterventionApplierWorker(input: {
  deps: InterventionApplierDeps;
  projectId?: string;
  intervalMs?: number;
  limit?: number;
  leaseOwner?: string;
  leaseMs?: number;
}): () => void {
  const tick = () => {
    runInterventionApplierWorkerOnce(input).catch((err: unknown) => {
      console.error(`[intervention-applier] worker tick failed: ${String(err)}`);
    });
  };
  tick();
  const timer = setInterval(tick, input.intervalMs ?? 30_000);
  timer.unref?.();
  return () => clearInterval(timer);
}

export function isApplyingStale(input: {
  intervention: WorkItemIntervention;
  now?: Date;
}): boolean {
  if (input.intervention.status !== 'APPLYING') return false;
  if (input.intervention.leaseExpiresAt == null) return true;
  return Date.parse(input.intervention.leaseExpiresAt) <= (input.now ?? new Date()).getTime();
}
