import type { StateName } from '../state-machine/states.js';
import type { StateSource } from '../state-source/interface.js';
import { eventStore } from './store.js';

const RETRY_DELAYS_MS = [200, 600, 1_800];

function isTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  // Network-class errors only. 401/403 are permanent auth failures — fail fast.
  if (msg.includes('fetch failed') || msg.includes('econnreset') || msg.includes('econnrefused'))
    return true;
  // GitHub HTTP status codes embedded in error messages
  const statusMatch = /\b(5\d\d|429)\b/.exec(err.message);
  return statusMatch != null;
}

async function withNetworkRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransient(err)) throw err;
      lastErr = err;
      if (i < RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i]));
      }
    }
  }
  throw lastErr;
}

export interface EmitStateTransitionEventInput {
  projectId: string;
  workItemId: string;
  from?: StateName;
  to: StateName;
  by: string;
  runId?: string;
  extraPayload?: Record<string, unknown>;
}

export function emitStateTransitionEvent(input: EmitStateTransitionEventInput): void {
  eventStore.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'state.transitioned',
    payload: {
      ...input.extraPayload,
      from: input.from ?? null,
      to: input.to,
      by: input.by,
    },
    ...(input.runId != null ? { runId: input.runId } : {}),
  });
}

interface TransitionEventFields {
  source: StateSource;
  itemId: string;
  projectId: string;
  workItemId: string;
  to: StateName;
  by: string;
  runId?: string;
  note?: string;
  extraPayload?: Record<string, unknown>;
}

export type TransitionAndEmitStateInput =
  | (TransitionEventFields & {
      mode: 'legal';
      from: StateName;
    })
  | (TransitionEventFields & {
      mode: 'forced';
      from?: StateName;
      reason?: string;
    });

export async function transitionAndEmitState(input: TransitionAndEmitStateInput): Promise<void> {
  if (input.mode === 'legal') {
    try {
      await withNetworkRetry(() =>
        input.note != null
          ? input.source.transitionState(input.itemId, input.from, input.to, input.note)
          : input.source.transitionState(input.itemId, input.from, input.to),
      );
    } catch (err) {
      if (!isTransient(err)) throw err;
      // All retries exhausted on a transient network error.
      // Emit the local event so the UI/orchestrator reflects the transition,
      // then emit a deferred marker so a reconciler can retry the remote flip.
      emitStateTransitionEvent({
        projectId: input.projectId,
        workItemId: input.workItemId,
        from: input.from,
        to: input.to,
        by: input.by,
        runId: input.runId,
        extraPayload: input.extraPayload,
      });
      eventStore.appendEvent({
        projectId: input.projectId,
        workItemId: input.workItemId,
        kind: 'state.transition-deferred',
        payload: {
          to: input.to,
          by: input.by,
          error: err instanceof Error ? err.message : String(err),
          ...(input.runId != null ? { runId: input.runId } : {}),
        },
        ...(input.runId != null ? { runId: input.runId } : {}),
      });
      return;
    }
    emitStateTransitionEvent({
      projectId: input.projectId,
      workItemId: input.workItemId,
      from: input.from,
      to: input.to,
      by: input.by,
      runId: input.runId,
      extraPayload: input.extraPayload,
    });
    return;
  }

  try {
    await withNetworkRetry(() => input.source.forceState(input.itemId, input.to));
  } catch (err) {
    if (!isTransient(err)) throw err;
    emitStateTransitionEvent({
      projectId: input.projectId,
      workItemId: input.workItemId,
      from: input.from,
      to: input.to,
      by: input.by,
      runId: input.runId,
      extraPayload: {
        ...input.extraPayload,
        forced: true,
        previousStateKnown: input.from != null,
        ...(input.reason != null ? { reason: input.reason } : {}),
      },
    });
    eventStore.appendEvent({
      projectId: input.projectId,
      workItemId: input.workItemId,
      kind: 'state.transition-deferred',
      payload: {
        to: input.to,
        by: input.by,
        error: err instanceof Error ? err.message : String(err),
        ...(input.runId != null ? { runId: input.runId } : {}),
      },
      ...(input.runId != null ? { runId: input.runId } : {}),
    });
    return;
  }
  emitStateTransitionEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    from: input.from,
    to: input.to,
    by: input.by,
    runId: input.runId,
    extraPayload: {
      ...input.extraPayload,
      forced: true,
      previousStateKnown: input.from != null,
      ...(input.reason != null ? { reason: input.reason } : {}),
    },
  });
}
