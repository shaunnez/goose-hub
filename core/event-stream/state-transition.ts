import type { StateName } from '../state-machine/states.js';
import { eventStore } from './store.js';

export interface EmitStateTransitionEventInput {
  projectId: string;
  workItemId: string;
  from: StateName;
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
    payload: { ...input.extraPayload, from: input.from, to: input.to, by: input.by },
    ...(input.runId != null ? { runId: input.runId } : {}),
  });
}
