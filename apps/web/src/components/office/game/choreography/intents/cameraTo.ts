// Intent: cameraTo
// Pans the Phaser main camera to a Board 02 §6 named anchor.
// Falls back gracefully if the anchor doesn't exist.
//
// Invariants:
//   - Calls scene.cameras.main.pan() only; no layer mutations.
//   - No coordinate literals; all anchors are from lib/rooms.ts.
//   - Cancel stops the pan (camera stays at intermediate position).

import type { Intent } from '../../../lib/choreography';
import { DEFAULT_EASE } from '../../../lib/cinematic-timings';
import { cameraAnchor } from '../../../lib/rooms';
import type { IntentResult } from '../../layers/types';
import type { ChoreographyCtx } from '../Timeline';

const inflightCancels = new Map<Intent, () => void>();

export function run(intent: Intent, ctx: ChoreographyCtx): Promise<IntentResult> {
  const anchorName = intent.target.id;
  const durationMs = typeof intent.params.durationMs === 'number' ? intent.params.durationMs : 0;
  const anchor = cameraAnchor(anchorName);

  if (!anchor || durationMs <= 0) {
    return Promise.resolve({ status: 'completed' });
  }

  let settled = false;
  let resolveFn!: (r: IntentResult) => void;
  const promise = new Promise<IntentResult>((r) => {
    resolveFn = r;
  });

  ctx.scene.cameras.main.pan(
    anchor.center.x,
    anchor.center.y,
    durationMs,
    DEFAULT_EASE,
    true,
    (_cam: Phaser.Cameras.Scene2D.Camera, progress: number) => {
      if (progress === 1 && !settled) {
        settled = true;
        inflightCancels.delete(intent);
        resolveFn({ status: 'completed' });
      }
    },
  );

  inflightCancels.set(intent, () => {
    if (settled) return;
    settled = true;
    inflightCancels.delete(intent);
    resolveFn({ status: 'cancelled' });
  });

  return promise;
}

export function cancel(intent: Intent, _ctx: ChoreographyCtx): void {
  inflightCancels.get(intent)?.();
}
