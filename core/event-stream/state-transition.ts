import type { StateName } from '../state-machine/states.js';
import type { StateSource } from '../state-source/interface.js';
import { eventStore } from './store.js';

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
    if (input.note != null) {
      await input.source.transitionState(input.itemId, input.from, input.to, input.note);
    } else {
      await input.source.transitionState(input.itemId, input.from, input.to);
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

  await input.source.forceState(input.itemId, input.to);
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
