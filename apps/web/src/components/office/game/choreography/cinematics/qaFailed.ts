// Cinematic factory: qaFailed
// Trigger: qa.functional-failed (hero ticket). Lane: critical.
// Total ≤ 3.5s (qaFailedHardCapMs) per Board 02 §14.1.
//
// Sequence:
//   1. spawnVerdictScroll at QA output interior anchor
//   2. slotTransit scroll through qa.output slot (interior → exterior → queue)
//   3. corridorPulse east-to-west (parallel with swapWallTint review wall dim)
//   4. walkToRoom ticket → dev room
//   5. swapIndicator ticket → bang
//   6. hero release (camera return handled by player)
//
// Ambient suppression: active (critical lane).
// Emit 'choreo.retry-incremented' on complete (Phase 6 draws the badge).
//
// Invariants:
//   - Pure factory; all timings from lib/cinematic-timings.ts.
//   - All coordinates from lib/rooms.ts.

import type { Intent, Timeline } from '../../../lib/choreography';
import { TIMING } from '../../../lib/cinematic-timings';
import { floorOriginY } from '../../../lib/layout';
import { CORRIDOR_WALK_Y, roomSlotAnchors } from '../../../lib/rooms';
import { CINEMATIC_TINTS } from '../../textures';
import { Timeline as TL } from '../Timeline';

let _seq = 0;
function nextId(): string {
  return `cinematic-qafail-${++_seq}`;
}

/**
 * qaFailed factory.
 * @param ticketId   Hero ticket id.
 * @param floorIndex Floor this project is on (0 for v1).
 * @param emitter    Scene emitter for choreo.retry-incremented.
 */
export function qaFailedTimeline(
  ticketId: string,
  floorIndex: number,
  emitter: { emit: (event: string, payload?: unknown) => void },
): Timeline {
  const oy = floorOriginY(floorIndex);
  const corridorY = oy + CORRIDOR_WALK_Y;

  const qaSlots = roomSlotAnchors('qa');
  const qaOutput = qaSlots.find((s) => s.id === 'qa.output');
  const qaOutputInterior = qaOutput?.interiorAnchor ?? { x: 856, y: 136 };
  const qaOutputExterior = qaOutput?.exteriorAnchor ?? { x: 856, y: 96 };
  const qaOutputQueueX = qaOutput?.queueAnchor?.x ?? 856;

  const scrollSpriteId = `verdict-scroll-${ticketId}`;

  const steps: Intent[] = [
    // 1. Spawn verdict scroll at QA output interior
    {
      id: 'spawnVerdictScroll',
      target: { kind: 'ticket', id: ticketId },
      params: {
        worldX: qaOutputInterior.x,
        worldY: oy + qaOutputInterior.y,
        spriteId: scrollSpriteId,
      },
      lane: 'critical',
      ttlMs: 200,
    },
    // 2. Scroll transits out through qa.output slot (600ms)
    {
      id: 'slotTransit',
      target: { kind: 'slot', id: scrollSpriteId },
      params: {
        anchors: [
          { x: qaOutputInterior.x, y: oy + qaOutputInterior.y },
          { x: qaOutputExterior.x, y: oy + qaOutputExterior.y },
          { x: qaOutputQueueX, y: corridorY },
        ],
        durationMs: TIMING.slotTransit3AnchorMs,
      },
      lane: 'critical',
      ttlMs: TIMING.slotTransit3AnchorMs + 200,
    },
    // 3. Corridor pulse east-to-west + wall dim (parallel, 1000ms)
    TL.parallel(
      [
        {
          id: 'corridorPulse',
          target: { kind: 'scene', id: `qa-pulse-${ticketId}` },
          params: {
            fromWorldX: qaOutputQueueX,
            toWorldX: 36,
            worldY: corridorY,
            durationMs: TIMING.corridorPulseMs,
            color: CINEMATIC_TINTS.pulseFail,
            effectId: `qa-pulse-${ticketId}`,
          },
          lane: 'critical',
          ttlMs: TIMING.corridorPulseMs + 200,
        },
        {
          id: 'swapWallTint',
          target: { kind: 'room', id: 'review' },
          params: { alpha: 0.2, floorIndex },
          lane: 'critical',
          ttlMs: 200,
        },
      ],
      'critical',
    ),
    // 4. Ticket walks west back to dev room (1200ms)
    {
      id: 'walkToRoom',
      target: { kind: 'ticket', id: ticketId },
      params: { destRoomId: 'dev', deskSlot: 0 },
      lane: 'critical',
      ttlMs: TIMING.walkCorridorMs + 500,
    },
    // 5. Ticket indicator → bang
    {
      id: 'swapIndicator',
      target: { kind: 'ticket', id: ticketId },
      params: { glyph: 'bang' },
      lane: 'critical',
      ttlMs: 500,
    },
    // 6. Restore wall tint
    {
      id: 'swapWallTint',
      target: { kind: 'room', id: 'review' },
      params: { alpha: 0, floorIndex, restoreOnComplete: true },
      lane: 'critical',
      ttlMs: 200,
    },
  ];

  return {
    id: nextId(),
    lane: 'critical',
    ticketId,
    source: 'event',
    steps,
    onComplete: () => {
      emitter.emit('choreo.retry-incremented', { ticketId });
    },
    onAbort: () => {
      // onAbort is called on TTL abort only (not preemption).
      // Wall tint and camera are reset by the player's abort path.
    },
  };
}
