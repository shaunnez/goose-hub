// Cinematic factory: investigationWave
// Trigger: swarm.wave-started / swarm.scout-completed / swarm.wave-completed
// Lane: primary (incremental continuation pattern — see phase-5 §3.1.1).
//
// Part 1 (swarm.wave-started): steps 1–6
//   - cameraTo hero-ticket-follow
//   - attachToDesk lead investigator
//   - swapIndicator lead → thought
//   - parallel spawnScoutEnvelope ×3 at Library scout desks
// Part 2 (swarm.scout-completed per scout): slotTransit for that scout's envelope
// Part 3 (swarm.wave-completed): glowRing at lead desk + swapIndicator ticket → check
//
// Invariants:
//   - Pure factory; all timings from lib/cinematic-timings.ts.
//   - All coordinates from lib/rooms.ts.
//   - investigationWaveTtlMs cap ≤ 8s applied to the await step in part 1.

import type { Intent, LaneId, Timeline } from '../../../lib/choreography';
import { TIMING } from '../../../lib/cinematic-timings';
import { floorOriginY } from '../../../lib/layout';
import { CORRIDOR_WALK_Y, roomDeskAnchors, roomSlotAnchors } from '../../../lib/rooms';
import { Timeline as TL } from '../Timeline';
import { CINEMATIC_TINTS } from '../../textures';

let _seq = 0;
function nextId(suffix: string): string {
  return `cinematic-wave-${suffix}-${++_seq}`;
}

const LANE: LaneId = 'primary';

/**
 * Part 1: swarm.wave-started — fan-out (steps 1–6).
 */
export function investigationWavePart1Timeline(
  ticketId: string,
  leadPersonaId: string,
  floorIndex: number,
): Timeline {
  const oy = floorOriginY(floorIndex);
  const investigationDesks = roomDeskAnchors('investigation');
  // Desks 0,1,2 are scout desks; desk 3 is lead investigator.
  const scoutDesks = investigationDesks.slice(0, 3);

  // Library envelope-out slot interior anchor (where envelopes appear)
  const librarySlots = roomSlotAnchors('investigation');
  const envelopeSlot = librarySlots.find((s) => s.id === 'library.envelope-out');
  const envelopeInterior = envelopeSlot?.interiorAnchor ?? { x: 288, y: 224 };

  const spawnSteps: Intent[] = scoutDesks.map((desk, i) => ({
    id: 'spawnScoutEnvelope' as const,
    target: { kind: 'slot' as const, id: `envelope-scout-${i}` },
    params: {
      spriteId: `envelope-scout-${i}`,
      worldX: desk.x,
      worldY: oy + desk.y,
    },
    lane: LANE,
    ttlMs: TIMING.scoutEnvelopeSpawnMs + 50,
  }));

  const steps: Intent[] = [
    // 1. Camera to hero-ticket-follow
    {
      id: 'cameraTo',
      target: { kind: 'camera', id: 'hero-ticket-follow' },
      params: { durationMs: TIMING.cameraEase, ticketId },
      lane: LANE,
      ttlMs: TIMING.cameraEase + 200,
    },
    // 2. Lead investigator walks to/seats at desk
    {
      id: 'attachToDesk',
      target: { kind: 'persona', id: leadPersonaId },
      params: { deskSlot: 3 },
      lane: LANE,
      ttlMs: TIMING.walkRoomMs + 200,
    },
    // 3. Lead indicator → thought
    {
      id: 'swapIndicator',
      target: { kind: 'persona', id: leadPersonaId },
      params: { glyph: 'thought' },
      lane: LANE,
      ttlMs: 500,
    },
    // 4–6. Spawn 3 scout envelopes in parallel at Library scout slots
    TL.parallel(spawnSteps, LANE),
    // 7–9 (indicators) can be added here if desired; omitted for v1 brevity
    // Step 10 TTL guard — the main wave-started timeline ends here.
    // The player will naturally queue part-2 timelines as scout-completed
    // events arrive. The investigationWaveTtlMs is the overall cap.
    {
      id: 'delay',
      target: { kind: 'scene', id: 'wave-await' },
      params: { ms: 0 }, // resolved immediately; serves as a structural separator
      lane: LANE,
      ttlMs: TIMING.investigationWaveTtlMs,
    },
  ];

  // suppress lint warning for unused var
  void envelopeInterior;
  void CORRIDOR_WALK_Y;

  return {
    id: nextId('part1'),
    lane: LANE,
    ticketId,
    source: 'event',
    steps,
    onAbort: () => {
      // Envelopes stay; next applyPlacements clears them naturally.
    },
  };
}

/**
 * Part 2: swarm.scout-completed — per-scout envelope transit south.
 * @param scoutIndex 0..2
 */
export function investigationWavePart2Timeline(
  ticketId: string,
  scoutIndex: number,
  floorIndex: number,
): Timeline {
  const oy = floorOriginY(floorIndex);
  const librarySlots = roomSlotAnchors('investigation');
  const envelopeSlot = librarySlots.find((s) => s.id === 'library.envelope-out');
  const exterior = envelopeSlot?.exteriorAnchor ?? { x: 288, y: 200 };
  const interior = envelopeSlot?.interiorAnchor ?? { x: 288, y: 224 };

  const investigationDesks = roomDeskAnchors('investigation');
  const leadDesk = investigationDesks[3] ?? investigationDesks[0];

  const steps: Intent[] = [
    {
      id: 'slotTransit',
      target: { kind: 'slot', id: `envelope-scout-${scoutIndex}` },
      params: {
        anchors: [
          { x: exterior.x, y: oy + exterior.y },
          { x: interior.x, y: oy + interior.y },
          { x: leadDesk.x, y: oy + leadDesk.y },
        ],
        durationMs: TIMING.slotTransit3AnchorMs,
      },
      lane: LANE,
      ttlMs: TIMING.slotTransit3AnchorMs + 200,
    },
  ];

  return {
    id: nextId(`part2-scout${scoutIndex}`),
    lane: LANE,
    ticketId,
    source: 'event',
    steps,
  };
}

/**
 * Part 3: swarm.wave-completed — convergence glow + ticket check.
 */
export function investigationWavePart3Timeline(ticketId: string, floorIndex: number): Timeline {
  const oy = floorOriginY(floorIndex);
  const investigationDesks = roomDeskAnchors('investigation');
  const leadDesk = investigationDesks[3] ?? investigationDesks[0];
  const glowX = leadDesk.x;
  const glowY = oy + leadDesk.y;

  const steps: Intent[] = [
    {
      id: 'glowRing',
      target: { kind: 'scene', id: `wave-glow-${ticketId}` },
      params: {
        worldX: glowX,
        worldY: glowY,
        durationMs: TIMING.glowRingMs,
        color: CINEMATIC_TINTS.glowRingWave,
        effectId: `wave-glow-${ticketId}`,
      },
      lane: LANE,
      ttlMs: TIMING.glowRingMs + 200,
    },
    {
      id: 'swapIndicator',
      target: { kind: 'ticket', id: ticketId },
      params: { glyph: 'check' },
      lane: LANE,
      ttlMs: 500,
    },
  ];

  return {
    id: nextId('part3'),
    lane: LANE,
    ticketId,
    source: 'event',
    steps,
  };
}
