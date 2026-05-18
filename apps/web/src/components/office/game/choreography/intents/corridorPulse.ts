// Intent: corridorPulse
// East-to-west or west-to-east coloured pulse along the corridor
// via RoomLayer.corridorPulse.
//
// Invariants:
//   - Calls only RoomLayer.corridorPulse; no other layer.
//   - No coordinate literals; fromWorldX/toWorldX/worldY come from intent.params
//     (factory sets them from lib/rooms.ts constants).
//   - Cancel stops the pulse immediately.

import type { Intent } from '../../../lib/choreography';
import type { IntentResult } from '../../layers/types';
import { CINEMATIC_TINTS } from '../../textures';
import type { ChoreographyCtx } from '../Timeline';

const inflightCancels = new Map<Intent, () => void>();

export function run(intent: Intent, ctx: ChoreographyCtx): Promise<IntentResult> {
  const fromWorldX = typeof intent.params.fromWorldX === 'number' ? intent.params.fromWorldX : 0;
  const toWorldX = typeof intent.params.toWorldX === 'number' ? intent.params.toWorldX : 0;
  const worldY = typeof intent.params.worldY === 'number' ? intent.params.worldY : 0;
  const durationMs = typeof intent.params.durationMs === 'number' ? intent.params.durationMs : 1000;
  const color =
    typeof intent.params.color === 'number' ? intent.params.color : CINEMATIC_TINTS.pulseFail;
  const effectId =
    typeof intent.params.effectId === 'string' ? intent.params.effectId : intent.target.id;

  const { promise, cancel: cancelFn } = ctx.roomLayer.corridorPulse(
    effectId,
    fromWorldX,
    toWorldX,
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
