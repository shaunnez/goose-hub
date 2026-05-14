// Intent: delay
// Resolves after ms milliseconds using scene.time.delayedCall.
// Used for "hold" steps in cinematics (e.g. hold door open for 800ms).
//
// Invariants:
//   - No layer calls; purely temporal.
//   - Cancel clears the timer and resolves immediately with 'cancelled'.

import type { Intent } from '../../../lib/choreography';
import type { IntentResult } from '../../layers/types';
import type { ChoreographyCtx } from '../Timeline';

const inflightCancels = new Map<Intent, () => void>();

export function run(intent: Intent, ctx: ChoreographyCtx): Promise<IntentResult> {
  const ms = typeof intent.params.ms === 'number' ? intent.params.ms : 0;

  return new Promise<IntentResult>((resolve) => {
    if (ms <= 0) {
      resolve({ status: 'completed' });
      return;
    }
    const timer = ctx.scene.time.delayedCall(ms, () => {
      inflightCancels.delete(intent);
      resolve({ status: 'completed' });
    });
    inflightCancels.set(intent, () => {
      timer.remove(false);
      inflightCancels.delete(intent);
      resolve({ status: 'cancelled' });
    });
  });
}

export function cancel(intent: Intent, _ctx: ChoreographyCtx): void {
  inflightCancels.get(intent)?.();
}
