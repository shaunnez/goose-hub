// Intent: spawnVerdictScroll
// Spawns a red-tinted scroll sprite at the QA output interior anchor via
// TicketLayer.spawnTempSprite, then swaps the hero ticket's body texture
// to 'scroll' variant.
//
// Resolves immediately (spawn is synchronous). The cinematic factory's
// onAbort callback must call TicketLayer.destroyTempSprite to clean up.
//
// Invariants:
//   - Calls only TicketLayer primitives; no other layer.
//   - No coordinate literals; worldX/worldY come from intent.params (factory sets from lib/rooms.ts).

import type { Intent } from '../../../lib/choreography';
import type { IntentResult } from '../../layers/types';
import { CINEMATIC_TINTS, TEXTURE_KEYS } from '../../textures';
import type { ChoreographyCtx } from '../Timeline';

export function run(intent: Intent, ctx: ChoreographyCtx): Promise<IntentResult> {
  const ticketId = intent.target.id;
  const worldX = typeof intent.params.worldX === 'number' ? intent.params.worldX : 0;
  const worldY = typeof intent.params.worldY === 'number' ? intent.params.worldY : 0;
  const spriteId =
    typeof intent.params.spriteId === 'string' ? intent.params.spriteId : `scroll-${ticketId}`;
  const tint = CINEMATIC_TINTS.verdictScrollFail;

  ctx.ticketLayer.setVariant(ticketId, 'scroll');
  ctx.ticketLayer.spawnTempSprite(spriteId, TEXTURE_KEYS.ticketScroll, worldX, worldY, tint);

  return Promise.resolve({ status: 'completed' });
}

export function cancel(_intent: Intent, _ctx: ChoreographyCtx): void {
  // No async work to cancel — spawn is synchronous.
}
