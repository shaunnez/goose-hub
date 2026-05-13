// Intent: attachToDesk
// Wraps PersonaLayer.seat() — moves the persona to a specific desk slot within
// their current room via a short tween. Called after walkToRoom places the
// persona at the room entrance; attachToDesk settles them at a particular desk.
//
// Invariants:
//   - Calls only PersonaLayer.seat(); never reads PersonaLayer internals.
//   - No coordinate literals; geometry is resolved inside PersonaLayer.seat().

import type { Intent } from '../../../lib/choreography';
import type { IntentResult } from '../../layers/types';
import type { ChoreographyCtx } from '../Timeline';

export function run(intent: Intent, ctx: ChoreographyCtx): Promise<IntentResult> {
  const personaId = intent.target.id;
  const deskSlot = typeof intent.params.deskSlot === 'number' ? intent.params.deskSlot : 0;

  if (!personaId) {
    return Promise.resolve({ status: 'failed', reason: 'missing-persona' });
  }

  return ctx.personaLayer.seat(personaId, deskSlot);
}

export function cancel(intent: Intent, ctx: ChoreographyCtx): void {
  ctx.personaLayer.cancelWalk(intent.target.id);
}
