// Intent: spawnScoutEnvelope
// Spawns an envelope sprite at the given world position via TicketLayer.spawnTempSprite.
// Resolves immediately (spawn is synchronous).
//
// Used by investigationWave factory to materialise a scout's envelope at the
// Library interior anchor before slotTransit moves it south.
//
// Invariants:
//   - Calls only TicketLayer.spawnTempSprite; no other layer.
//   - No coordinate literals; worldX/worldY come from intent.params (factory sets from lib/rooms.ts).

import type { Intent } from '../../../lib/choreography';
import type { IntentResult } from '../../layers/types';
import { TEXTURE_KEYS } from '../../textures';
import type { ChoreographyCtx } from '../Timeline';

export function run(intent: Intent, ctx: ChoreographyCtx): Promise<IntentResult> {
  const spriteId =
    typeof intent.params.spriteId === 'string' ? intent.params.spriteId : intent.target.id;
  const worldX = typeof intent.params.worldX === 'number' ? intent.params.worldX : 0;
  const worldY = typeof intent.params.worldY === 'number' ? intent.params.worldY : 0;

  ctx.ticketLayer.spawnTempSprite(spriteId, TEXTURE_KEYS.ticketEnvelope, worldX, worldY);

  return Promise.resolve({ status: 'completed' });
}

export function cancel(_intent: Intent, _ctx: ChoreographyCtx): void {
  // No async work to cancel — spawn is synchronous.
}
