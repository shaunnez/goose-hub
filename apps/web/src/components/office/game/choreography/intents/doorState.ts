// Intent: doorState
// Animates the Review chamber door open or closed via RoomLayer.animateDoor.
//
// Invariants:
//   - Calls only RoomLayer.animateDoor / resetDoor; no other layer.
//   - No timing literals; durationMs comes from intent.params (set by factory from cinematic-timings).
//   - Cancel stops the animation; the door stays at current alpha.

import type { Intent } from '../../../lib/choreography';
import type { IntentResult } from '../../layers/types';
import type { ChoreographyCtx } from '../Timeline';

const inflightCancels = new Map<Intent, () => void>();

export function run(intent: Intent, ctx: ChoreographyCtx): Promise<IntentResult> {
  const targetState = intent.params.targetState as 'open' | 'close';
  const durationMs = typeof intent.params.durationMs === 'number' ? intent.params.durationMs : 200;
  const floorIndex = typeof intent.params.floorIndex === 'number' ? intent.params.floorIndex : 0;

  if (targetState !== 'open' && targetState !== 'close') {
    return Promise.resolve({ status: 'failed', reason: 'invalid-door-state' });
  }

  const { promise, cancel: cancelFn } = ctx.roomLayer.animateDoor(
    floorIndex,
    targetState,
    durationMs,
  );

  inflightCancels.set(intent, () => {
    cancelFn();
    inflightCancels.delete(intent);
  });

  return promise.then((r) => {
    inflightCancels.delete(intent);
    return r;
  });
}

export function cancel(intent: Intent, _ctx: ChoreographyCtx): void {
  inflightCancels.get(intent)?.();
}
