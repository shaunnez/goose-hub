// Intent: swapWallTint
// Sets or restores a wall-tint overlay on a room via RoomLayer.
// The tint is applied on run() and restored on cancel() / complete if
// restoreOnComplete is set in params.
//
// Invariants:
//   - Calls only RoomLayer.setWallTint / restoreWallTint; no other layer.
//   - No coordinate literals; roomId comes from intent.target.id.
//   - Resolves immediately (the tint change is a snap, not a tween).

import type { Intent } from '../../../lib/choreography';
import type { RoomId } from '../../../lib/rooms';
import type { IntentResult } from '../../layers/types';
import type { ChoreographyCtx } from '../Timeline';

const inflightRestores = new Map<Intent, () => void>();

export function run(intent: Intent, ctx: ChoreographyCtx): Promise<IntentResult> {
  const roomId = intent.target.id as RoomId;
  const floorIndex = typeof intent.params.floorIndex === 'number' ? intent.params.floorIndex : 0;
  const alpha = typeof intent.params.alpha === 'number' ? intent.params.alpha : 0.2;
  const restoreOnComplete =
    typeof intent.params.restoreOnComplete === 'boolean' ? intent.params.restoreOnComplete : false;

  ctx.roomLayer.setWallTint(floorIndex, roomId, alpha);

  inflightRestores.set(intent, () => {
    ctx.roomLayer.restoreWallTint(floorIndex, roomId);
  });

  if (restoreOnComplete) {
    ctx.roomLayer.restoreWallTint(floorIndex, roomId);
    inflightRestores.delete(intent);
  }

  return Promise.resolve({ status: 'completed' });
}

export function cancel(intent: Intent, _ctx: ChoreographyCtx): void {
  inflightRestores.get(intent)?.();
  inflightRestores.delete(intent);
}
