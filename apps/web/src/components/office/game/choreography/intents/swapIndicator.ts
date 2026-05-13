// Intent: swapIndicator
// Wraps PersonaLayer.setIndicator() or TicketLayer.setIndicator() depending on
// intent.target.kind. Resolves immediately; an optional delayMs param waits
// before settling (used by agent.run-completed: show check for ~250ms then clear).
//
// Invariants:
//   - No tween creation; setIndicator() calls are synchronous.
//   - Optional delay uses scene.time.delayedCall — no setTimeout.
//   - Concurrent intents are tracked per intent-object in inflightCancels.

import type { Intent } from '../../../lib/choreography';
import type { IndicatorKind } from '../../../lib/state-indicators';
import type { IntentResult } from '../../layers/types';
import type { ChoreographyCtx } from '../Timeline';

// Keyed by intent reference so concurrent intents on different lanes are
// each independently cancellable.
const inflightCancels = new Map<Intent, () => void>();

export function run(intent: Intent, ctx: ChoreographyCtx): Promise<IntentResult> {
  const { target, params } = intent;
  const glyph = (params.glyph ?? null) as IndicatorKind | null;
  const delayMs = typeof params.delayMs === 'number' ? params.delayMs : 0;

  return new Promise<IntentResult>((resolve) => {
    const settle = () => {
      inflightCancels.delete(intent);
      applyGlyph(target, glyph, ctx);
      resolve({ status: 'completed' });
    };

    if (delayMs <= 0) {
      settle();
      return;
    }

    const timer = ctx.scene.time.delayedCall(delayMs, settle);
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

function applyGlyph(
  target: Intent['target'],
  glyph: IndicatorKind | null,
  ctx: ChoreographyCtx,
): void {
  if (target.kind === 'persona') {
    ctx.personaLayer.setIndicator(target.id, glyph);
  } else if (target.kind === 'ticket') {
    ctx.ticketLayer.setIndicator(target.id, glyph);
  }
}
