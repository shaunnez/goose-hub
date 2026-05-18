// Intent: shelfLand
// Tweens the hero ticket to a Done shelf slot via TicketLayer.shelfLand.
// Existing shelf tickets shift outward.
//
// Invariants:
//   - Calls only TicketLayer.shelfLand; no other layer.
//   - No timing literals; durationMs comes from intent.params (set by factory).
//   - Cancel stops the tween.

import type { Intent } from '../../../lib/choreography';
import type { IntentResult } from '../../layers/types';
import type { ChoreographyCtx } from '../Timeline';

const inflightCancels = new Map<Intent, () => void>();

export function run(intent: Intent, ctx: ChoreographyCtx): Promise<IntentResult> {
  const ticketId = intent.target.id;
  const slotIndex = typeof intent.params.slotIndex === 'number' ? intent.params.slotIndex : 2;
  const durationMs = typeof intent.params.durationMs === 'number' ? intent.params.durationMs : 800;

  if (!ticketId) {
    return Promise.resolve({ status: 'failed', reason: 'missing-ticket-id' });
  }

  const { promise, cancel: cancelFn } = ctx.ticketLayer.shelfLand(ticketId, slotIndex, durationMs);

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
