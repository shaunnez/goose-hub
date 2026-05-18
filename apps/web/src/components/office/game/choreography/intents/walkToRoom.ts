// Intent: walkToRoom
// Wraps PersonaLayer.walkToRoom() — the full path-planned walk from wherever
// the persona is to the first desk slot of the destination room.
//
// Invariants:
//   - Calls only PersonaLayer primitives; never reads PersonaLayer internals.
//   - No coordinate literals; all geometry comes from PersonaLayer via lib/rooms.ts.
//   - No Phaser tween creation; tweens are created inside PersonaLayer.walkToRoom().

import type { Intent } from '../../../lib/choreography';
import type { IntentResult } from '../../layers/types';
import type { ChoreographyCtx } from '../Timeline';

export function run(intent: Intent, ctx: ChoreographyCtx): Promise<IntentResult> {
  const personaId = intent.target.id;
  const destRoomId = intent.params.destRoomId as string;
  const deskSlot = typeof intent.params.deskSlot === 'number' ? intent.params.deskSlot : 0;

  if (!personaId || !destRoomId) {
    return Promise.resolve({ status: 'failed', reason: 'missing-params' });
  }

  return ctx.personaLayer.walkToRoom(personaId, destRoomId, deskSlot);
}

export function cancel(intent: Intent, ctx: ChoreographyCtx): void {
  ctx.personaLayer.cancelWalk(intent.target.id);
}
