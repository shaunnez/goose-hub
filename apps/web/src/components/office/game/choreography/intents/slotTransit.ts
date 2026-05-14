// Intent: slotTransit
// Tweens a ticket (or a temp sprite) through a sequence of world-space anchors.
// The three-anchor pattern (interior → exterior → queue) is the v1 canonical use.
//
// intent.target:
//   kind='ticket'  id=ticketId → tweens the actual ticket sprite
//   kind='slot'    id=spriteId → tweens a temp sprite spawned by spawnScoutEnvelope/spawnVerdictScroll
//
// Invariants:
//   - Calls only TicketLayer.slotTransit / slotTransitTempSprite; no other layer.
//   - No coordinate literals; anchors come from intent.params (factory sets from lib/rooms.ts).
//   - Cancel stops the tween at its current position.

import type { Intent } from '../../../lib/choreography';
import type { Point } from '../../../lib/rooms';
import type { IntentResult } from '../../layers/types';
import type { ChoreographyCtx } from '../Timeline';

const inflightCancels = new Map<Intent, () => void>();

export function run(intent: Intent, ctx: ChoreographyCtx): Promise<IntentResult> {
  const durationMs = typeof intent.params.durationMs === 'number' ? intent.params.durationMs : 600;
  const anchors = (intent.params.anchors ?? []) as Point[];

  if (anchors.length < 2) {
    return Promise.resolve({ status: 'failed', reason: 'insufficient-anchors' });
  }

  let result: { promise: Promise<IntentResult>; cancel: () => void };

  if (intent.target.kind === 'slot') {
    result = ctx.ticketLayer.slotTransitTempSprite(intent.target.id, anchors, durationMs);
  } else {
    result = ctx.ticketLayer.slotTransit(intent.target.id, anchors, durationMs);
  }

  inflightCancels.set(intent, () => {
    result.cancel();
    inflightCancels.delete(intent);
  });

  return result.promise.then((r) => {
    inflightCancels.delete(intent);
    return r;
  });
}

export function cancel(intent: Intent, _ctx: ChoreographyCtx): void {
  inflightCancels.get(intent)?.();
}
