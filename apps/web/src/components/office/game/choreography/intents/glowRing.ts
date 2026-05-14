// Intent: glowRing
// Renders a radial glow ring expanding at (worldX, worldY) via RoomLayer.glowRingAt.
//
// Invariants:
//   - Calls only RoomLayer.glowRingAt; no other layer.
//   - No coordinate literals; all positions come from intent.params (set by factory).
//   - Cancel stops the animation and destroys the ring.

import type { Intent } from '../../../lib/choreography';
import type { IntentResult } from '../../layers/types';
import type { ChoreographyCtx } from '../Timeline';

const inflightCancels = new Map<Intent, () => void>();

export function run(intent: Intent, ctx: ChoreographyCtx): Promise<IntentResult> {
  const worldX = typeof intent.params.worldX === 'number' ? intent.params.worldX : 0;
  const worldY = typeof intent.params.worldY === 'number' ? intent.params.worldY : 0;
  const durationMs = typeof intent.params.durationMs === 'number' ? intent.params.durationMs : 600;
  const color = typeof intent.params.color === 'number' ? intent.params.color : 0x00ff88;
  const effectId =
    typeof intent.params.effectId === 'string' ? intent.params.effectId : intent.target.id;

  const { promise, cancel: cancelFn } = ctx.roomLayer.glowRingAt(
    effectId,
    worldX,
    worldY,
    durationMs,
    color,
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
