// Cinematic factory: reviewConverged
// Trigger: review.converged (hero ticket). Lane: primary.
// Total ~1.2s per Board 02 §14.1.
//
// Sequence:
//   1. doorState open  (200ms)
//   2. delay hold      (800ms)
//   3. slotTransit through review.door slot (600ms)
//   4. walkToRoom to done corridor anchor   (~1000ms, leads into mergeCelebration)
//   5. doorState close (200ms)
//
// Invariants:
//   - Pure factory; all timings from lib/cinematic-timings.ts.
//   - All coordinates from lib/rooms.ts.

import type { Intent, Timeline } from '../../../lib/choreography';
import { TIMING } from '../../../lib/cinematic-timings';
import { floorOriginY } from '../../../lib/layout';
import { CORRIDOR_WALK_Y, roomSlotAnchors } from '../../../lib/rooms';

let _seq = 0;
function nextId(): string {
  return `cinematic-review-${++_seq}`;
}

/**
 * reviewConverged factory.
 * @param ticketId   Hero ticket id.
 * @param floorIndex Floor this project is on (0 for v1).
 */
export function reviewConvergedTimeline(ticketId: string, floorIndex: number): Timeline {
  const oy = floorOriginY(floorIndex);
  const corridorY = oy + CORRIDOR_WALK_Y;

  const reviewSlots = roomSlotAnchors('review');
  const reviewDoorSlot = reviewSlots.find((s) => s.id === 'review.door');
  const reviewDoorExterior = reviewDoorSlot?.exteriorAnchor ?? { x: 1016, y: 96 };
  const reviewDoorInterior = reviewDoorSlot?.interiorAnchor ?? { x: 1016, y: 136 };
  const reviewDoorQueueX = reviewDoorSlot?.queueAnchor?.x ?? 1016;

  const steps: Intent[] = [
    // 1. Open Review door (200ms)
    {
      id: 'doorState',
      target: { kind: 'door', id: 'review' },
      params: { targetState: 'open', durationMs: TIMING.doorOpenMs, floorIndex },
      lane: 'primary',
      ttlMs: TIMING.doorOpenMs + 100,
    },
    // 2. Hold door open (800ms)
    {
      id: 'delay',
      target: { kind: 'scene', id: 'review-door-hold' },
      params: { ms: TIMING.doorHoldMs },
      lane: 'primary',
      ttlMs: TIMING.doorHoldMs + 100,
    },
    // 3. Ticket transits through door slot (interior → exterior → queue level)
    {
      id: 'slotTransit',
      target: { kind: 'ticket', id: ticketId },
      params: {
        anchors: [
          { x: reviewDoorInterior.x, y: oy + reviewDoorInterior.y },
          { x: reviewDoorExterior.x, y: oy + reviewDoorExterior.y },
          { x: reviewDoorQueueX, y: corridorY },
        ],
        durationMs: TIMING.slotTransit3AnchorMs,
      },
      lane: 'primary',
      ttlMs: TIMING.slotTransit3AnchorMs + 200,
    },
    // 4. Walk east in corridor to done room
    {
      id: 'walkToRoom',
      target: { kind: 'ticket', id: ticketId },
      params: { destRoomId: 'done', deskSlot: 0 },
      lane: 'primary',
      ttlMs: TIMING.walkCorridorMs + 500,
    },
    // 5. Close door
    {
      id: 'doorState',
      target: { kind: 'door', id: 'review' },
      params: { targetState: 'close', durationMs: TIMING.doorCloseMs, floorIndex },
      lane: 'primary',
      ttlMs: TIMING.doorCloseMs + 100,
    },
  ];

  return {
    id: nextId(),
    lane: 'primary',
    ticketId,
    source: 'event',
    steps,
  };
}
