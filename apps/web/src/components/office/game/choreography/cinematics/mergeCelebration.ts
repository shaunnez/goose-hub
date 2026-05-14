// Cinematic factory: mergeCelebration
// Trigger: pr.merged (hero ticket). Lane: primary.
// Total ≤ 1.6s per Board 02 §14.1.
//
// Sequence:
//   1. walkToRoom — ticket descends from done door to shelf slot 3.
//   2. shelfLand — settle on shelf with neighbour shift.
//   3. glowRing — green pulse at shelf slot 3.
//   4. particleBurst — 8-particle burst at same anchor.
//   5. Emit choreo.merge-celebrated (Phase 6 draws the counter badge).
//   6. Hero release after step 4 (camera return handled by player).
//
// Invariants:
//   - Pure factory; does not mutate scene state.
//   - All timings from lib/cinematic-timings.ts.
//   - All coordinates from lib/rooms.ts.

import type { Intent, Timeline } from '../../../lib/choreography';
import { TIMING } from '../../../lib/cinematic-timings';
import { floorOriginY } from '../../../lib/layout';
import { CORRIDOR_WALK_Y, roomDeskAnchors, roomDoor } from '../../../lib/rooms';
import { Timeline as TL } from '../Timeline';
import { CINEMATIC_TINTS } from '../../textures';

let _seq = 0;
function nextId(): string {
  return `cinematic-merge-${++_seq}`;
}

/**
 * Hero merge celebration (primary lane).
 * @param ticketId   The hero ticket's full id.
 * @param floorIndex The floor this project is on (0 for v1 single-project).
 * @param emitter    Scene emitter — used to fire choreo.merge-celebrated.
 */
export function mergeCelebrationTimeline(
  ticketId: string,
  floorIndex: number,
  emitter: { emit: (event: string, payload?: unknown) => void },
): Timeline {
  const oy = floorOriginY(floorIndex);
  const doneDoor = roomDoor('done') ?? { x: 1192, y: 112 };
  const shelfAnchors = roomDeskAnchors('done');
  const shelfSlot = shelfAnchors[2] ?? shelfAnchors[0]; // slot 3 (index 2)

  const corridorY = oy + CORRIDOR_WALK_Y;
  const doorWorldY = oy + doneDoor.y;
  const shelfWorldX = shelfSlot.x;
  const shelfWorldY = oy + shelfSlot.y - 4;

  const steps: Intent[] = [
    // Step 1: walk ticket from done door corridor position down to shelf
    {
      id: 'slotTransit',
      target: { kind: 'ticket', id: ticketId },
      params: {
        anchors: [
          { x: doneDoor.x, y: corridorY },
          { x: doneDoor.x, y: doorWorldY },
          { x: shelfWorldX, y: shelfWorldY },
        ],
        durationMs: TIMING.walkRoomMs,
      },
      lane: 'primary',
      ttlMs: TIMING.walkRoomMs + 200,
    },
    // Step 2: shelfLand with neighbour shift
    {
      id: 'shelfLand',
      target: { kind: 'ticket', id: ticketId },
      params: { slotIndex: 2, durationMs: TIMING.shelfLandHeroMs },
      lane: 'primary',
      ttlMs: TIMING.shelfLandHeroMs + 200,
    },
    // Steps 3+4: glow ring + particle burst in parallel
    TL.parallel(
      [
        {
          id: 'glowRing',
          target: { kind: 'scene', id: `merge-glow-${ticketId}` },
          params: {
            worldX: shelfWorldX,
            worldY: shelfWorldY,
            durationMs: TIMING.glowRingMs,
            color: CINEMATIC_TINTS.pulseSuccess,
            effectId: `merge-glow-${ticketId}`,
          },
          lane: 'primary',
          ttlMs: TIMING.glowRingMs + 200,
        },
        {
          id: 'particleBurst',
          target: { kind: 'scene', id: `merge-burst-${ticketId}` },
          params: {
            worldX: shelfWorldX,
            worldY: shelfWorldY,
            durationMs: TIMING.particleBurstMs,
            color: CINEMATIC_TINTS.particleBurstDefault,
            effectId: `merge-burst-${ticketId}`,
          },
          lane: 'primary',
          ttlMs: TIMING.particleBurstMs + 200,
        },
      ],
      'primary',
    ),
  ];

  return {
    id: nextId(),
    lane: 'primary',
    ticketId,
    source: 'event',
    steps,
    onComplete: () => {
      emitter.emit('choreo.merge-celebrated', { ticketId });
    },
    onAbort: () => {
      // No spawned sprites to clean up; effects self-destruct.
    },
  };
}

/**
 * Non-hero merge ambient timeline.
 * Faster, no glow, no camera move.
 */
export function mergeCelebrationAmbientTimeline(ticketId: string, floorIndex: number): Timeline {
  const oy = floorOriginY(floorIndex);
  const shelfAnchors = roomDeskAnchors('done');
  const shelfSlot = shelfAnchors[2] ?? shelfAnchors[0];
  const shelfWorldX = shelfSlot.x;
  const shelfWorldY = oy + shelfSlot.y - 4;

  const steps: Intent[] = [
    {
      id: 'shelfLand',
      target: { kind: 'ticket', id: ticketId },
      params: { slotIndex: 2, durationMs: TIMING.shelfLandAmbientMs },
      lane: 'ambient',
      ttlMs: TIMING.shelfLandAmbientMs + 200,
    },
    {
      id: 'particleBurst',
      target: { kind: 'scene', id: `merge-burst-ambient-${ticketId}` },
      params: {
        worldX: shelfWorldX,
        worldY: shelfWorldY,
        durationMs: TIMING.particleBurstMs,
        color: CINEMATIC_TINTS.particleBurstDefault,
        effectId: `merge-burst-ambient-${ticketId}`,
      },
      lane: 'ambient',
      ttlMs: TIMING.particleBurstMs + 200,
    },
  ];

  return {
    id: `${nextId()}-ambient`,
    lane: 'ambient',
    ticketId,
    source: 'event',
    steps,
  };
}
