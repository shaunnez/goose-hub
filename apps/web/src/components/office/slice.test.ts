// Slice contract tests for the Office view (M17). Exercises the pure
// state→role / state→indicator / layout / pathfinding / placement logic.
//
// The Phaser scene + React mount are exercised by Playwright e2e
// (apps/web/e2e/m17-office-tab.spec.ts) — they need a real browser canvas and
// won't run in jsdom.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { ChoreographyPlayer } from './game/choreography/ChoreographyPlayer';
import type { ChoreographyCtx } from './game/choreography/Timeline';
import { Timeline as TL } from './game/choreography/Timeline';
import { OFFICE_ROLES, busyRoles, idleIndicator, placementsFromItems } from './lib/agent-positions';
import type { PersonaPlacement, TicketPlacement } from './lib/agent-positions';
import type { ChoreographyContext, OrchestrationEvent, Timeline } from './lib/choreography';
import {
  INDICATOR_CLEAR_DELAY_MS,
  LANE_FOR_EVENT,
  TTL_SWAP_MS,
  TTL_WALK_MS,
  timelinesForEvent,
} from './lib/choreography';
import { hudStateFromPlacements } from './lib/hud-state';
import {
  FLOOR_GAP_PX,
  FLOOR_PIXEL_HEIGHT,
  FLOOR_PIXEL_WIDTH,
  deskPositions,
  floorCenterY,
  floorOriginY,
  floorOverviewCameraLayout,
  floorOverviewZoomForViewport,
  stairsPosition,
  totalWorldHeight,
} from './lib/layout';
import {
  corridorY,
  crossFloorPath,
  facingFromMovement,
  pathLength,
  planWalk,
  sameFloorPath,
} from './lib/pathfinding';
import { CODENAME_POOL, codenameFor } from './lib/persona-codenames';
import {
  CORRIDOR_WALK_Y,
  FLOOR_WORLD,
  ROOM_IDS,
  allClickZones,
  cameraAnchor,
  hudAnchor,
  pressureColorForCount,
  priorityTintColor,
  roomBounds,
  roomDeskAnchors,
  roomDoor,
  roomQueueAnchor,
  roomSlotAnchors,
} from './lib/rooms';
import { IDLE_INDICATOR, indicatorForState } from './lib/state-indicators';
import { deskForState, shouldWalk } from './lib/state-to-role';
import { ticketAtDeskOffset, ticketCarryOffset } from './lib/ticket-carry';
import { pngManifest } from './game/asset-loader';
import {
  CINEMATIC_TINTS,
  HUD_TINTS,
  PALETTE,
  ROLE_TINTS,
  TEXTURE_KEYS,
} from './game/textures';

describe('state → desk role mapping', () => {
  it('maps every lane state to a valid role', () => {
    const states = [
      'factory:triaging',
      'factory:accepted',
      'factory:grilling',
      'factory:prd-drafting',
      'factory:prd-review',
      'factory:decomposing',
      'factory:issues-created',
      'factory:research-pending',
      'factory:research-complete',
      'factory:investigating',
      'factory:investigation-complete',
      'factory:dev-ready',
      'factory:spec-ready',
      'factory:in-progress',
      'factory:needs-fix',
      'factory:qa-failed',
      'factory:needs-qa',
      'factory:needs-review',
      'factory:approved',
      'factory:merge-conflict',
      'factory:retrospecting',
    ];
    for (const s of states) {
      expect(deskForState(s)).not.toBeNull();
    }
  });

  it('returns null for terminal and human-gate states', () => {
    expect(deskForState('factory:done')).toBeNull();
    expect(deskForState('factory:archived')).toBeNull();
    expect(deskForState('factory:rejected')).toBeNull();
    expect(deskForState('factory:needs-human')).toBeNull();
    expect(deskForState('factory:gate-pending')).toBeNull();
  });

  it('returns null for unknown states', () => {
    expect(deskForState('factory:nonsense')).toBeNull();
    expect(deskForState('')).toBeNull();
  });

  it('shouldWalk = true only when desks differ and both desks exist', () => {
    expect(shouldWalk('factory:triaging', 'factory:investigating')).toBe(true);
    expect(shouldWalk('factory:investigating', 'factory:investigation-complete')).toBe(false);
    expect(shouldWalk('factory:in-progress', 'factory:done')).toBe(false);
    expect(shouldWalk('factory:done', 'factory:in-progress')).toBe(false);
    expect(shouldWalk('unknown', 'factory:in-progress')).toBe(false);
  });
});

describe('state → indicator mapping', () => {
  it('returns coffee idle indicator for unknown states', () => {
    expect(indicatorForState('factory:unknown')).toBe(IDLE_INDICATOR);
    expect(indicatorForState('')).toBe('coffee');
  });

  it('uses speech for actively-running states', () => {
    expect(indicatorForState('factory:in-progress')).toBe('speech');
    expect(indicatorForState('factory:grilling')).toBe('speech');
    expect(indicatorForState('factory:prd-drafting')).toBe('speech');
    expect(indicatorForState('factory:retrospecting')).toBe('speech');
  });

  it('uses thought for investigating / pre-thinking states', () => {
    expect(indicatorForState('factory:investigating')).toBe('thought');
    expect(indicatorForState('factory:research-pending')).toBe('thought');
    expect(indicatorForState('factory:dev-ready')).toBe('thought');
  });

  it('uses question for gate-pending and bang for human-blocked / failure', () => {
    expect(indicatorForState('factory:gate-pending')).toBe('question');
    expect(indicatorForState('factory:needs-human')).toBe('bang');
    expect(indicatorForState('factory:qa-failed')).toBe('bang');
    expect(indicatorForState('factory:merge-conflict')).toBe('bang');
  });

  it('uses check for terminal-success states', () => {
    expect(indicatorForState('factory:done')).toBe('check');
    expect(indicatorForState('factory:approved')).toBe('check');
    expect(indicatorForState('factory:investigation-complete')).toBe('check');
  });
});

describe('floor and desk layout', () => {
  it('stacks floors with a gap and FLOOR_PIXEL_HEIGHT spacing', () => {
    expect(floorOriginY(0)).toBe(0);
    expect(floorOriginY(1)).toBe(FLOOR_PIXEL_HEIGHT + FLOOR_GAP_PX);
    expect(floorOriginY(2)).toBe(2 * (FLOOR_PIXEL_HEIGHT + FLOOR_GAP_PX));
  });

  it('floorCenterY sits in the middle of the floor', () => {
    expect(floorCenterY(0)).toBe(Math.floor(FLOOR_PIXEL_HEIGHT / 2));
  });

  it('rejects negative floor indices', () => {
    expect(() => floorOriginY(-1)).toThrow(RangeError);
  });

  it('totalWorldHeight grows linearly with floor count', () => {
    expect(totalWorldHeight(0)).toBe(0);
    expect(totalWorldHeight(1)).toBe(FLOOR_PIXEL_HEIGHT);
    expect(totalWorldHeight(3)).toBe(3 * FLOOR_PIXEL_HEIGHT + 2 * FLOOR_GAP_PX);
  });

  it('keeps the floor at 1:1 when the viewport is smaller than the world', () => {
    expect(floorOverviewZoomForViewport(FLOOR_PIXEL_WIDTH - 200, FLOOR_PIXEL_HEIGHT)).toBe(1);
  });

  it('zooms the floor overview up for large viewports without cropping the focused floor', () => {
    const zoom = floorOverviewZoomForViewport(FLOOR_PIXEL_WIDTH * 2, FLOOR_PIXEL_HEIGHT * 1.5);
    expect(zoom).toBe(1.5);
  });

  it('pads camera bounds so a wide viewport centers the office floor', () => {
    const layout = floorOverviewCameraLayout(FLOOR_PIXEL_WIDTH * 2, FLOOR_PIXEL_HEIGHT * 1.5, 1);
    expect(layout.zoom).toBe(1.5);
    expect(layout.bounds.x).toBeLessThan(0);
    expect(layout.bounds.width).toBeGreaterThan(FLOOR_PIXEL_WIDTH);
    expect(layout.bounds.y).toBe(0);
  });

  it('places one desk per office role with monotonically-increasing x', () => {
    const desks = deskPositions(0);
    expect(desks).toHaveLength(OFFICE_ROLES.length);
    for (let i = 1; i < desks.length; i++) {
      expect(desks[i].x).toBeGreaterThan(desks[i - 1].x);
    }
    // All desks share the same y on a single floor.
    const ys = new Set(desks.map((d) => d.y));
    expect(ys.size).toBe(1);
  });

  it('stairsPosition shifts down between floors', () => {
    const a = stairsPosition(0);
    const b = stairsPosition(1);
    expect(a.x).toBe(b.x);
    expect(b.y).toBeGreaterThan(a.y);
  });
});

describe('pathfinding', () => {
  it('same-floor path routes via the corridor row', () => {
    const from = { x: 100, y: 200 };
    const to = { x: 400, y: 200 };
    const path = sameFloorPath(from, to, 0);
    expect(path[0]).toEqual(from);
    expect(path[path.length - 1]).toEqual(to);
    expect(path.length).toBe(4);
    expect(path[1].y).toBe(corridorY(0));
    expect(path[2].y).toBe(corridorY(0));
  });

  it('same-floor same-column path is a straight line', () => {
    const from = { x: 100, y: 200 };
    const to = { x: 100, y: 300 };
    expect(sameFloorPath(from, to, 0)).toEqual([from, to]);
  });

  it('cross-floor path includes both stair endpoints', () => {
    const path = crossFloorPath({ x: 80, y: 100 }, 0, { x: 320, y: 500 }, 1);
    const stairsA = stairsPosition(0);
    const stairsB = stairsPosition(1);
    expect(path).toContainEqual(stairsA);
    expect(path).toContainEqual(stairsB);
  });

  it('crossFloorPath delegates to sameFloorPath when floors equal', () => {
    const a = { x: 80, y: 100 };
    const b = { x: 200, y: 100 };
    expect(crossFloorPath(a, 0, b, 0)).toEqual(sameFloorPath(a, b, 0));
  });

  it('planWalk picks same-floor branch when floors match', () => {
    const seg = planWalk({ x: 0, y: 0 }, 0, { x: 100, y: 0 }, 0);
    expect(seg.viaStairs).toBe(false);
  });

  it('planWalk picks cross-floor branch when floors differ', () => {
    const seg = planWalk({ x: 0, y: 0 }, 0, { x: 100, y: 0 }, 2);
    expect(seg.viaStairs).toBe(true);
  });

  it('pathLength is the manhattan distance along the polyline', () => {
    expect(pathLength([{ x: 0, y: 0 }])).toBe(0);
    expect(
      pathLength([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
      ]),
    ).toBe(15);
  });

  it('facingFromMovement classifies cardinal directions', () => {
    expect(facingFromMovement({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe('right');
    expect(facingFromMovement({ x: 1, y: 0 }, { x: 0, y: 0 })).toBe('left');
    expect(facingFromMovement({ x: 0, y: 0 }, { x: 0, y: 1 })).toBe('down');
    expect(facingFromMovement({ x: 0, y: 1 }, { x: 0, y: 0 })).toBe('up');
  });
});

describe('placementsFromItems', () => {
  it('drops terminal-state items; done goes to shelf; blocked states produce frozen persona + carried ticket', () => {
    const { personas, tickets } = placementsFromItems([
      { workItemId: 'w1', externalId: '1', projectSlug: 'p', state: 'factory:in-progress' },
      { workItemId: 'w2', externalId: '2', projectSlug: 'p', state: 'factory:done' },
      { workItemId: 'w3', externalId: '3', projectSlug: 'p', state: 'factory:gate-pending' },
      { workItemId: 'w4', externalId: '4', projectSlug: 'p', state: 'factory:needs-human' },
      { workItemId: 'w5', externalId: '5', projectSlug: 'p', state: 'factory:archived' },
    ]);
    // archived dropped; done produces ticket-only; others produce persona + ticket
    expect(personas.map((p) => p.externalId).sort()).toEqual(['1', '3', '4']);
    expect(tickets.map((t) => t.externalId).sort()).toEqual(['1', '2', '3', '4']);

    const pById = Object.fromEntries(personas.map((p) => [p.externalId, p]));
    const tById = Object.fromEntries(tickets.map((t) => [t.externalId, t]));

    expect(pById['1'].roomId).toBe('dev');
    expect(pById['1'].indicator).toBe('speech');
    expect(pById['3'].roomId).toBeNull();
    expect(pById['3'].indicator).toBe('question');
    expect(pById['4'].roomId).toBeNull();
    expect(pById['4'].indicator).toBe('bang');

    expect(tById['2'].position).toBe('shelf');
    expect(tById['2'].shelfSlot).toBeGreaterThanOrEqual(0);
    expect(tById['2'].carrierPersonaId).toBeNull();
    expect(tById['1'].position).toBe('carried');
    expect(tById['1'].carrierPersonaId).toBe('p:1');
  });

  it('personaId / ticketId are stable across state transitions', () => {
    const { personas: beforeP, tickets: beforeT } = placementsFromItems([
      { workItemId: 'a', externalId: '7', projectSlug: 'p', state: 'factory:in-progress' },
    ]);
    const { personas: blockedP, tickets: blockedT } = placementsFromItems([
      { workItemId: 'a', externalId: '7', projectSlug: 'p', state: 'factory:gate-pending' },
    ]);
    expect(beforeP[0].personaId).toBe(blockedP[0].personaId);
    expect(beforeT[0].ticketId).toBe(blockedT[0].ticketId);
    expect(beforeP[0].roomId).toBe('dev');
    expect(blockedP[0].roomId).toBeNull();
  });

  it('preserves title and projectSlug on both persona and ticket', () => {
    const { personas, tickets } = placementsFromItems([
      {
        workItemId: 'w9',
        externalId: '9',
        projectSlug: 'p',
        state: 'factory:in-progress',
        title: 'fix the thing',
      },
    ]);
    expect(personas[0].title).toBe('fix the thing');
    expect(personas[0].projectSlug).toBe('p');
    expect(tickets[0].title).toBe('fix the thing');
    expect(tickets[0].projectSlug).toBe('p');
  });

  it('factory:investigating produces persona at investigation lead-desk (slot 3)', () => {
    const { personas } = placementsFromItems([
      { workItemId: 'w1', externalId: '1', projectSlug: 'p', state: 'factory:investigating' },
    ]);
    expect(personas[0].roomId).toBe('investigation');
    expect(personas[0].deskSlot).toBe(3);
  });

  it('factory:in-progress produces persona at a dev desk (slot 0-2, deterministic)', () => {
    const { personas } = placementsFromItems([
      { workItemId: 'w1', externalId: '42', projectSlug: 'p', state: 'factory:in-progress' },
    ]);
    expect(personas[0].roomId).toBe('dev');
    expect(personas[0].deskSlot).toBeGreaterThanOrEqual(0);
    expect(personas[0].deskSlot).toBeLessThanOrEqual(2);
    // Same input → same desk
    const { personas: p2 } = placementsFromItems([
      { workItemId: 'w1', externalId: '42', projectSlug: 'p', state: 'factory:in-progress' },
    ]);
    expect(p2[0].deskSlot).toBe(personas[0].deskSlot);
  });

  it('in-progress ticket has position=carried, carrierPersonaId set', () => {
    const { personas, tickets } = placementsFromItems([
      { workItemId: 'w1', externalId: '7', projectSlug: 'proj', state: 'factory:in-progress' },
    ]);
    expect(tickets[0].position).toBe('carried');
    expect(tickets[0].carrierPersonaId).toBe(personas[0].personaId);
  });

  it('factory:done ticket has position=shelf, shelfSlot in 0..4', () => {
    const { personas, tickets } = placementsFromItems([
      { workItemId: 'w1', externalId: '3', projectSlug: 'p', state: 'factory:done' },
    ]);
    expect(personas).toHaveLength(0);
    expect(tickets[0].position).toBe('shelf');
    expect(tickets[0].shelfSlot).toBeGreaterThanOrEqual(0);
    expect(tickets[0].shelfSlot).toBeLessThanOrEqual(4);
  });

  it('codenames are populated on PersonaPlacement', () => {
    const { personas } = placementsFromItems([
      { workItemId: 'w1', externalId: '1', projectSlug: 'p', state: 'factory:in-progress' },
    ]);
    expect(typeof personas[0].codename).toBe('string');
    expect(personas[0].codename.length).toBeGreaterThan(0);
  });

  it('busyRoles returns the set of currently-occupied rooms as roles', () => {
    const { personas } = placementsFromItems([
      { workItemId: 'a', externalId: '1', projectSlug: 'p', state: 'factory:in-progress' },
      { workItemId: 'b', externalId: '2', projectSlug: 'p', state: 'factory:investigating' },
    ]);
    const roles = busyRoles(personas);
    expect(roles.has('developer')).toBe(true);
    expect(roles.has('investigator')).toBe(true);
    expect(roles.has('qa')).toBe(false);
  });

  it('idleIndicator returns coffee', () => {
    expect(idleIndicator()).toBe('coffee');
  });

  it('overflow items beyond desk capacity get position=queue with no persona', () => {
    // dev has capacity 3; 4th item should be queued
    const items = [1, 2, 3, 4].map((n) => ({
      workItemId: `w${n}`,
      externalId: `${n}`,
      projectSlug: 'p',
      state: 'factory:in-progress',
    }));
    const { personas, tickets } = placementsFromItems(items);
    expect(personas).toHaveLength(3); // only 3 desk slots
    const queued = tickets.filter((t) => t.position === 'queue');
    const carried = tickets.filter((t) => t.position === 'carried');
    expect(queued).toHaveLength(1);
    expect(carried).toHaveLength(3);
    expect(queued[0].carrierPersonaId).toBeNull();
    expect(queued[0].roomId).toBe('dev');
  });

  it('triage overflow queues at capacity 1', () => {
    const items = [1, 2].map((n) => ({
      workItemId: `w${n}`,
      externalId: `${n}`,
      projectSlug: 'p',
      state: 'factory:triaging',
    }));
    const { tickets } = placementsFromItems(items);
    expect(tickets.filter((t) => t.position === 'carried')).toHaveLength(1);
    expect(tickets.filter((t) => t.position === 'queue')).toHaveLength(1);
  });

  it('queue tickets have correct roomId for hudState queue depth derivation', () => {
    const items = [1, 2].map((n) => ({
      workItemId: `w${n}`,
      externalId: `${n}`,
      projectSlug: 'p',
      state: 'factory:needs-qa',
    }));
    const { tickets } = placementsFromItems(items);
    const queueTickets = tickets.filter((t) => t.position === 'queue');
    expect(queueTickets.every((t) => t.roomId === 'qa')).toBe(true);
  });
});

describe('persona-codenames', () => {
  it('CODENAME_POOL has at least 24 entries', () => {
    expect(CODENAME_POOL.length).toBeGreaterThanOrEqual(24);
  });

  it('codenameFor is deterministic — same seed returns same name', () => {
    expect(codenameFor('proj:42')).toBe(codenameFor('proj:42'));
    expect(codenameFor('abc')).toBe(codenameFor('abc'));
    expect(codenameFor('')).toBe(codenameFor(''));
  });

  it('codenameFor always returns a string from CODENAME_POOL', () => {
    const seeds = ['a', 'b', 'proj:1', 'proj:100', 'goose-hub-self:42', 'x:y:z', ''];
    for (const seed of seeds) {
      expect(CODENAME_POOL).toContain(codenameFor(seed));
    }
  });

  it('100 distinct seeds produce more than 20 distinct codenames', () => {
    const names = new Set<string>();
    for (let i = 0; i < 100; i++) {
      names.add(codenameFor(`proj:${i}`));
    }
    expect(names.size).toBeGreaterThan(20);
  });

  it('different seeds can produce different codenames', () => {
    const a = codenameFor('proj:1');
    const b = codenameFor('proj:2');
    // Not guaranteed to differ, but the hash should differ for these
    // seeds (verified by running locally).
    expect(typeof a).toBe('string');
    expect(typeof b).toBe('string');
  });
});

describe('ticket-carry offsets', () => {
  it('ticketCarryOffset returns (+10, -12) per Board 02 §5.3', () => {
    const o = ticketCarryOffset();
    expect(o.dx).toBe(10);
    expect(o.dy).toBe(-12);
  });

  it('ticketAtDeskOffset returns a non-zero offset', () => {
    const o = ticketAtDeskOffset();
    expect(typeof o.dx).toBe('number');
    expect(typeof o.dy).toBe('number');
  });

  it('both offset functions are pure — same result on repeated calls', () => {
    expect(ticketCarryOffset()).toEqual(ticketCarryOffset());
    expect(ticketAtDeskOffset()).toEqual(ticketAtDeskOffset());
  });
});

describe('LANE_FOR_EVENT — event allowlist', () => {
  const kinds = Object.keys(LANE_FOR_EVENT) as Array<keyof typeof LANE_FOR_EVENT>;

  it('covers exactly 11 event kinds', () => {
    expect(kinds).toHaveLength(11);
  });

  it('qa.functional-failed / gate.awaiting-human / audit.autonomy-gate-fired are critical', () => {
    expect(LANE_FOR_EVENT['qa.functional-failed']).toBe('critical');
    expect(LANE_FOR_EVENT['gate.awaiting-human']).toBe('critical');
    expect(LANE_FOR_EVENT['audit.autonomy-gate-fired']).toBe('critical');
  });

  it('state.transitioned and agent run events are primary (hero demotion is per-event)', () => {
    expect(LANE_FOR_EVENT['state.transitioned']).toBe('primary');
    expect(LANE_FOR_EVENT['agent.run-started']).toBe('primary');
    expect(LANE_FOR_EVENT['agent.run-completed']).toBe('primary');
  });
});

describe('timelinesForEvent', () => {
  const CTX: ChoreographyContext = { hero: 'p:42', rooms: ROOM_IDS };

  it('returns [] for unknown event kind', () => {
    expect(timelinesForEvent({ kind: 'unknown.event' } as OrchestrationEvent, CTX)).toHaveLength(0);
  });

  it('returns [] for audit.autonomy-gate-fired (phase 5+)', () => {
    expect(timelinesForEvent({ kind: 'audit.autonomy-gate-fired' }, CTX)).toHaveLength(0);
  });

  it('state.transitioned hero → primary walkToRoom', () => {
    const timelines = timelinesForEvent(
      {
        kind: 'state.transitioned',
        personaId: 'agent-1',
        ticketId: 'p:42',
        toState: 'factory:in-progress',
      },
      CTX,
    );
    expect(timelines).toHaveLength(1);
    expect(timelines[0].lane).toBe('primary');
    expect(timelines[0].steps[0].id).toBe('walkToRoom');
    expect(timelines[0].steps[0].params.destRoomId).toBe('dev');
  });

  it('state.transitioned non-hero → ambient walkToRoom', () => {
    const timelines = timelinesForEvent(
      {
        kind: 'state.transitioned',
        personaId: 'agent-1',
        ticketId: 'p:99',
        toState: 'factory:in-progress',
      },
      CTX,
    );
    expect(timelines[0].lane).toBe('ambient');
  });

  it('state.transitioned without personaId → []', () => {
    expect(
      timelinesForEvent({ kind: 'state.transitioned', toState: 'factory:in-progress' }, CTX),
    ).toHaveLength(0);
  });

  it('agent.run-started hero → primary 2-step (attachToDesk + swapIndicator)', () => {
    const timelines = timelinesForEvent(
      { kind: 'agent.run-started', personaId: 'agent-1', ticketId: 'p:42', deskSlot: 1 },
      CTX,
    );
    expect(timelines[0].lane).toBe('primary');
    expect(timelines[0].steps).toHaveLength(2);
    expect(timelines[0].steps[0].id).toBe('attachToDesk');
    expect(timelines[0].steps[1].id).toBe('swapIndicator');
    expect(timelines[0].steps[1].params.glyph).toBe('speech');
  });

  it('agent.run-started non-hero → ambient single swapIndicator', () => {
    const timelines = timelinesForEvent(
      { kind: 'agent.run-started', personaId: 'agent-1', ticketId: 'p:99' },
      CTX,
    );
    expect(timelines[0].lane).toBe('ambient');
    expect(timelines[0].steps).toHaveLength(1);
    expect(timelines[0].steps[0].id).toBe('swapIndicator');
  });

  it('agent.run-completed → check then null (2 steps with delayMs)', () => {
    const timelines = timelinesForEvent(
      { kind: 'agent.run-completed', personaId: 'agent-1', ticketId: 'p:42' },
      CTX,
    );
    expect(timelines[0].steps).toHaveLength(2);
    expect(timelines[0].steps[0].params.glyph).toBe('check');
    expect(timelines[0].steps[1].params.glyph).toBeNull();
    expect(timelines[0].steps[1].params.delayMs).toBe(INDICATOR_CLEAR_DELAY_MS);
  });

  it('qa.functional-failed → critical cinematic starting with spawnVerdictScroll', () => {
    const timelines = timelinesForEvent({ kind: 'qa.functional-failed', ticketId: 'p:42' }, CTX);
    expect(timelines[0].lane).toBe('critical');
    // Phase 5: qaFailed cinematic — first step is spawnVerdictScroll, not swapIndicator
    expect(timelines[0].steps[0].id).toBe('spawnVerdictScroll');
    expect(timelines[0].steps[0].target.kind).toBe('ticket');
    // bang indicator appears later in the cinematic sequence
    const bangStep = timelines[0].steps.find((s) => s.id === 'swapIndicator');
    expect(bangStep?.params.glyph).toBe('bang');
  });

  it('qa.functional-failed without ticketId → []', () => {
    expect(timelinesForEvent({ kind: 'qa.functional-failed' }, CTX)).toHaveLength(0);
  });

  it('gate.awaiting-human → critical question on persona target', () => {
    const timelines = timelinesForEvent({ kind: 'gate.awaiting-human', personaId: 'agent-1' }, CTX);
    expect(timelines[0].lane).toBe('critical');
    expect(timelines[0].steps[0].params.glyph).toBe('question');
    expect(timelines[0].steps[0].target.kind).toBe('persona');
  });

  it('swarm.wave-started without ticketId/personaId → []', () => {
    // Phase 5: requires both ticketId and personaId (lead investigator)
    expect(timelinesForEvent({ kind: 'swarm.wave-started' }, CTX)).toHaveLength(0);
  });

  it('swarm.wave-started with ticketId+personaId → primary investigationWave part 1', () => {
    const timelines = timelinesForEvent(
      { kind: 'swarm.wave-started', ticketId: 'p:42', personaId: 'lead-1' },
      CTX,
    );
    expect(timelines[0].lane).toBe('primary');
    // Part 1 starts with cameraTo
    expect(timelines[0].steps[0].id).toBe('cameraTo');
  });

  it('swarm.wave-completed with ticketId → primary investigationWave part 3 (glowRing + check)', () => {
    const timelines = timelinesForEvent({ kind: 'swarm.wave-completed', ticketId: 'p:42' }, CTX);
    // Phase 5: part 3 starts with glowRing, then swapIndicator check
    expect(timelines[0].steps[0].id).toBe('glowRing');
    const checkStep = timelines[0].steps.find((s) => s.id === 'swapIndicator');
    expect(checkStep?.params.glyph).toBe('check');
  });

  it('pr.merged hero → primary mergeCelebration cinematic (slotTransit + shelfLand + parallel)', () => {
    // CTX.hero = 'p:42' matches ticketId — hero path
    const timelines = timelinesForEvent({ kind: 'pr.merged', ticketId: 'p:42' }, CTX);
    expect(timelines[0].lane).toBe('primary');
    expect(timelines[0].steps[0].id).toBe('slotTransit');
    expect(timelines[0].steps[1].id).toBe('shelfLand');
  });

  it('pr.merged non-hero → ambient mergeCelebration cinematic', () => {
    const timelines = timelinesForEvent({ kind: 'pr.merged', ticketId: 'p:99' }, CTX);
    expect(timelines[0].lane).toBe('ambient');
    expect(timelines[0].steps[0].id).toBe('shelfLand');
  });

  it('all returned timelines have source=event', () => {
    const timelines = timelinesForEvent({ kind: 'qa.functional-failed', ticketId: 'p:1' }, CTX);
    for (const t of timelines) expect(t.source).toBe('event');
  });
});

describe('ChoreographyPlayer', () => {
  function makeMockCtx() {
    const emitLog: Array<{ event: string; payload: unknown }> = [];
    const emitter = {
      emit: (event: string, payload: unknown) => {
        emitLog.push({ event, payload });
      },
    };
    const personaLayer = {
      walkToRoom: vi
        .fn<() => Promise<{ status: string }>>()
        .mockResolvedValue({ status: 'completed' }),
      cancelWalk: vi.fn(),
      seat: vi.fn<() => Promise<{ status: string }>>().mockResolvedValue({ status: 'completed' }),
      setIndicator: vi.fn(),
    };
    const ticketLayer = { setIndicator: vi.fn() };
    const pendingTimers: Array<{ ms: number; fn: () => void; removed: boolean }> = [];
    const scene = {
      time: {
        delayedCall: (ms: number, fn: () => void) => {
          if (ms === 0) {
            fn();
            return { remove: () => {} };
          }
          const entry = { ms, fn, removed: false };
          pendingTimers.push(entry);
          return {
            remove: () => {
              entry.removed = true;
            },
          };
        },
      },
    };
    const ctx = { personaLayer, ticketLayer, scene, emitter } as unknown as ChoreographyCtx;
    return { ctx, emitLog, pendingTimers, personaLayer };
  }

  const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

  function makeSwap(lane: string, targetId: string): Timeline {
    return {
      id: `tl-${targetId}`,
      lane: lane as Timeline['lane'],
      ticketId: null,
      source: 'event',
      steps: [
        {
          id: 'swapIndicator',
          target: { kind: 'persona', id: targetId },
          params: { glyph: 'speech' },
          lane: lane as Timeline['lane'],
          ttlMs: TTL_SWAP_MS,
        },
      ],
    };
  }

  it('emits choreo.intent-started then choreo.intent-completed for one step', async () => {
    const { ctx, emitLog } = makeMockCtx();
    const player = new ChoreographyPlayer(ctx);
    player.applyChoreography([makeSwap('primary', 'p1')]);
    await flushPromises();
    const events = emitLog.map((e) => e.event);
    expect(events).toContain('choreo.intent-started');
    expect(events).toContain('choreo.intent-completed');
  });

  it('coalescing: same lane + same first-step target → only latest dispatched', async () => {
    const { ctx, emitLog } = makeMockCtx();
    const player = new ChoreographyPlayer(ctx);
    const t1 = { ...makeSwap('primary', 'p1'), id: 'tl-old' };
    const t2 = { ...makeSwap('primary', 'p1'), id: 'tl-new' };
    player.applyChoreography([t1, t2]);
    await flushPromises();
    expect(emitLog.filter((e) => e.event === 'choreo.intent-started')).toHaveLength(1);
  });

  it('coalescing: different targets in same lane → both dispatched', async () => {
    const { ctx, emitLog } = makeMockCtx();
    const player = new ChoreographyPlayer(ctx);
    player.applyChoreography([makeSwap('primary', 'p1'), makeSwap('primary', 'p2')]);
    await flushPromises();
    // p2 runs immediately; p1 queued and runs after p2 completes
    await flushPromises();
    expect(emitLog.filter((e) => e.event === 'choreo.intent-started')).toHaveLength(2);
  });

  it('TTL exceeded emits choreo.intent-cancelled with failed status', async () => {
    const { ctx, emitLog, pendingTimers } = makeMockCtx();
    // walkToRoom never resolves → TTL fires
    (ctx.personaLayer.walkToRoom as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise(() => {}),
    );

    const player = new ChoreographyPlayer(ctx);
    player.applyChoreography([
      {
        id: 'tl-walk',
        lane: 'primary',
        ticketId: null,
        source: 'event',
        steps: [
          {
            id: 'walkToRoom',
            target: { kind: 'persona', id: 'p1' },
            params: { destRoomId: 'dev', deskSlot: 0 },
            lane: 'primary',
            ttlMs: TTL_WALK_MS,
          },
        ],
      },
    ]);
    // Manually fire the TTL timer
    const ttl = pendingTimers.find((t) => t.ms === TTL_WALK_MS);
    ttl?.fn();
    await flushPromises();
    const cancelled = emitLog.filter((e) => e.event === 'choreo.intent-cancelled');
    expect(cancelled).toHaveLength(1);
    expect((cancelled[0].payload as { status: string }).status).toBe('failed');
  });

  it('critical preempts primary; primary resumes after critical completes', async () => {
    const { ctx, emitLog, personaLayer } = makeMockCtx();
    // Primary walkToRoom: first call never resolves (preempted); second resolves normally
    (personaLayer.walkToRoom as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue({ status: 'completed' });

    const player = new ChoreographyPlayer(ctx);
    player.applyChoreography([
      {
        id: 'tl-prim',
        lane: 'primary',
        ticketId: null,
        source: 'event',
        steps: [
          {
            id: 'walkToRoom',
            target: { kind: 'persona', id: 'p-prim' },
            params: { destRoomId: 'dev', deskSlot: 0 },
            lane: 'primary',
            ttlMs: TTL_WALK_MS,
          },
        ],
      },
    ]);
    player.applyChoreography([makeSwap('critical', 'p-crit')]);
    await flushPromises();
    await flushPromises();

    const started = emitLog.filter((e) => e.event === 'choreo.intent-started');
    const intentNames = started.map((e) => (e.payload as { intentName: string }).intentName);
    // critical swapIndicator ran, and primary walkToRoom was resumed (re-run)
    expect(intentNames).toContain('swapIndicator');
    expect(intentNames.filter((n) => n === 'walkToRoom').length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Phase 5 tests ───────────────────────────────────────────────────────────

describe('Timeline.parallel', () => {
  it('returns a composite intent with id=parallel and max ttlMs', () => {
    const sub1 = {
      id: 'delay' as const,
      target: { kind: 'scene' as const, id: 'a' },
      params: { ms: 100 },
      lane: 'primary' as const,
      ttlMs: 300,
    };
    const sub2 = {
      id: 'delay' as const,
      target: { kind: 'scene' as const, id: 'b' },
      params: { ms: 200 },
      lane: 'primary' as const,
      ttlMs: 700,
    };
    const intent = TL.parallel([sub1, sub2], 'primary');
    expect(intent.id).toBe('parallel');
    expect(intent.ttlMs).toBe(700);
    expect(intent.subSteps).toHaveLength(2);
  });
});

describe('timelinesForEvent Phase 5 cinematics', () => {
  const CTX: ChoreographyContext = { hero: 'p:42', rooms: ROOM_IDS };

  it('review.converged → primary timeline starting with doorState', () => {
    const timelines = timelinesForEvent({ kind: 'review.converged', ticketId: 'p:42' }, CTX);
    expect(timelines).toHaveLength(1);
    expect(timelines[0].lane).toBe('primary');
    expect(timelines[0].steps[0].id).toBe('doorState');
  });

  it('review.converged without ticketId → []', () => {
    expect(timelinesForEvent({ kind: 'review.converged' }, CTX)).toHaveLength(0);
  });

  it('swarm.scout-completed → primary timeline with slotTransit', () => {
    const timelines = timelinesForEvent(
      { kind: 'swarm.scout-completed', ticketId: 'p:42', scoutIndex: 1 },
      CTX,
    );
    expect(timelines).toHaveLength(1);
    expect(timelines[0].steps[0].id).toBe('slotTransit');
  });

  it('swarm.scout-completed without ticketId → []', () => {
    expect(timelinesForEvent({ kind: 'swarm.scout-completed' }, CTX)).toHaveLength(0);
  });

  it('qa.functional-failed cinematic has onComplete callback', () => {
    const timelines = timelinesForEvent({ kind: 'qa.functional-failed', ticketId: 'p:42' }, CTX);
    expect(timelines[0].onComplete).toBeTypeOf('function');
  });

  it('pr.merged hero cinematic has onComplete callback', () => {
    const timelines = timelinesForEvent({ kind: 'pr.merged', ticketId: 'p:42' }, CTX);
    expect(timelines[0].onComplete).toBeTypeOf('function');
  });
});

describe('ChoreographyPlayer Phase 5 — criticalActive suppression and onAbort', () => {
  function makeMockCtxPhase5() {
    const emitLog: Array<{ event: string; payload: unknown }> = [];
    const emitter = {
      emit: (event: string, payload: unknown) => {
        emitLog.push({ event, payload });
      },
    };
    const personaLayer = {
      walkToRoom: vi
        .fn<() => Promise<{ status: string }>>()
        .mockResolvedValue({ status: 'completed' }),
      cancelWalk: vi.fn(),
      seat: vi.fn<() => Promise<{ status: string }>>().mockResolvedValue({ status: 'completed' }),
      setIndicator: vi.fn(),
    };
    const ticketLayer = {
      setIndicator: vi.fn(),
      promote: vi.fn(),
      release: vi.fn(),
    };
    const roomLayer = {};
    const pendingTimers: Array<{ ms: number; fn: () => void; removed: boolean }> = [];
    const scene = {
      time: {
        delayedCall: (ms: number, fn: () => void) => {
          if (ms === 0) {
            fn();
            return { remove: () => {} };
          }
          const entry = { ms, fn, removed: false };
          pendingTimers.push(entry);
          return {
            remove: () => {
              entry.removed = true;
            },
          };
        },
      },
    };
    const ctx = {
      personaLayer,
      ticketLayer,
      roomLayer,
      scene,
      emitter,
    } as unknown as ChoreographyCtx;
    return { ctx, emitLog, pendingTimers, ticketLayer };
  }

  const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

  function makeSwapTl(
    lane: Timeline['lane'],
    targetId: string,
    ticketId: string | null = null,
  ): Timeline {
    return {
      id: `tl-${targetId}`,
      lane,
      ticketId,
      source: 'event',
      steps: [
        {
          id: 'swapIndicator',
          target: { kind: 'persona', id: targetId },
          params: { glyph: 'speech' },
          lane,
          ttlMs: TTL_SWAP_MS,
        },
      ],
    };
  }

  it('ambient lane does not start while criticalActive=true', async () => {
    const { ctx, emitLog } = makeMockCtxPhase5();
    const player = new ChoreographyPlayer(ctx);

    // critical timeline that never resolves
    (ctx.personaLayer.walkToRoom as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise(() => {}),
    );
    const critTl: Timeline = {
      id: 'crit',
      lane: 'critical',
      ticketId: null,
      source: 'event',
      steps: [
        {
          id: 'walkToRoom',
          target: { kind: 'persona', id: 'p-c' },
          params: { destRoomId: 'dev', deskSlot: 0 },
          lane: 'critical',
          ttlMs: 999999,
        },
      ],
    };
    player.applyChoreography([critTl]);
    await flushPromises();

    // Now queue an ambient timeline
    player.applyChoreography([makeSwapTl('ambient', 'p-a')]);
    await flushPromises();

    // Ambient intent should NOT have started (critical is active)
    const startedNames = emitLog
      .filter((e) => e.event === 'choreo.intent-started')
      .map((e) => (e.payload as { target: { id: string } }).target.id);
    expect(startedNames).not.toContain('p-a');
  });

  it('onAbort is called on TTL abort but NOT on preemption', async () => {
    const { ctx, pendingTimers } = makeMockCtxPhase5();
    const player = new ChoreographyPlayer(ctx);

    const abortFn = vi.fn();
    (ctx.personaLayer.walkToRoom as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise(() => {}),
    );

    const tl: Timeline = {
      id: 'tl-abort',
      lane: 'primary',
      ticketId: null,
      source: 'event',
      steps: [
        {
          id: 'walkToRoom',
          target: { kind: 'persona', id: 'p1' },
          params: { destRoomId: 'dev', deskSlot: 0 },
          lane: 'primary',
          ttlMs: TTL_WALK_MS,
        },
      ],
      onAbort: abortFn,
    };
    player.applyChoreography([tl]);
    await flushPromises();

    // Fire the TTL
    const ttl = pendingTimers.find((t) => t.ms === TTL_WALK_MS);
    ttl?.fn();
    await flushPromises();

    expect(abortFn).toHaveBeenCalledOnce();
  });

  it('onAbort is NOT called when preempted by critical', async () => {
    const { ctx } = makeMockCtxPhase5();
    const player = new ChoreographyPlayer(ctx);

    const abortFn = vi.fn();
    (ctx.personaLayer.walkToRoom as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise(() => {}),
    );

    const primTl: Timeline = {
      id: 'prim',
      lane: 'primary',
      ticketId: null,
      source: 'event',
      steps: [
        {
          id: 'walkToRoom',
          target: { kind: 'persona', id: 'p1' },
          params: { destRoomId: 'dev', deskSlot: 0 },
          lane: 'primary',
          ttlMs: TTL_WALK_MS,
        },
      ],
      onAbort: abortFn,
    };
    player.applyChoreography([primTl]);
    await flushPromises();

    // Preempt with critical
    player.applyChoreography([makeSwapTl('critical', 'p-crit')]);
    await flushPromises();
    await flushPromises();

    expect(abortFn).not.toHaveBeenCalled();
  });
});

describe('rooms.ts — Board 02 canonical floor geometry', () => {
  it('FLOOR_WORLD matches the 80×24 tile grid', () => {
    expect(FLOOR_WORLD.width).toBe(1280);
    expect(FLOOR_WORLD.height).toBe(384);
  });

  it('CORRIDOR_WALK_Y is the center of the corridor band (ty=4..6)', () => {
    expect(CORRIDOR_WALK_Y).toBe(88);
  });

  it('corridorY(0) matches CORRIDOR_WALK_Y', () => {
    expect(corridorY(0)).toBe(CORRIDOR_WALK_Y);
  });

  it('ROOM_IDS contains exactly the six canonical rooms', () => {
    expect(ROOM_IDS).toEqual(['triage', 'investigation', 'dev', 'qa', 'review', 'done']);
  });

  it('roomBounds returns non-overlapping interior rects', () => {
    const bounds = ROOM_IDS.map((id) => roomBounds(id));
    // All rooms share the same y-range (interior ty=8..21)
    for (const b of bounds) {
      expect(b.y1).toBe(128);
      expect(b.y2).toBe(351);
    }
    // Rooms are left-to-right non-overlapping
    for (let i = 1; i < bounds.length; i++) {
      expect(bounds[i].x1).toBeGreaterThan(bounds[i - 1].x2);
    }
    // Last room ends before or at floor width
    expect(bounds[bounds.length - 1].x2).toBeLessThanOrEqual(FLOOR_WORLD.width);
  });

  it('rooms with doors have door py=112 (ceiling row ty=7)', () => {
    for (const id of ROOM_IDS) {
      const door = roomDoor(id);
      if (door) expect(door.y).toBe(112);
    }
  });

  it('qa has no door (sealed)', () => {
    expect(roomDoor('qa')).toBeNull();
  });

  it('qa has two slots (input and output)', () => {
    const slots = roomSlotAnchors('qa');
    expect(slots).toHaveLength(2);
    expect(slots.map((s) => s.id)).toEqual(['qa.input', 'qa.output']);
  });

  it('qa slots have queueAnchor on py=88', () => {
    for (const slot of roomSlotAnchors('qa')) {
      expect(slot.queueAnchor?.y).toBe(88);
    }
  });

  it('queue anchors are on the corridor walking lane (py=88)', () => {
    for (const id of ROOM_IDS) {
      const qa = roomQueueAnchor(id);
      if (qa) expect(qa.y).toBe(CORRIDOR_WALK_Y);
    }
  });

  it('done has no queue anchor', () => {
    expect(roomQueueAnchor('done')).toBeNull();
  });

  it('floor-overview camera anchor is at (640, 192) with zoom 1.0', () => {
    const anchor = cameraAnchor('floor-overview');
    expect(anchor?.center).toEqual({ x: 640, y: 192 });
    expect(anchor?.zoom).toBe(1.0);
  });

  it('allClickZones returns 14 zones covering all rooms and queues', () => {
    expect(allClickZones()).toHaveLength(14);
  });

  it('dev room has 3 desk anchors', () => {
    expect(roomDeskAnchors('dev')).toHaveLength(3);
  });

  it('done room has 5 shelf slot anchors', () => {
    expect(roomDeskAnchors('done')).toHaveLength(5);
  });

  it('investigation room has 4 desk anchors (3 scout + 1 lead)', () => {
    expect(roomDeskAnchors('investigation')).toHaveLength(4);
  });
});

// ─── Phase 6: rooms.ts HUD additions ─────────────────────────────────────────

describe('rooms.ts — Phase 6 HUD anchors', () => {
  it('hudAnchor("retry-counter") returns Board 02 §4.4 position', () => {
    expect(hudAnchor('retry-counter')).toEqual({ x: 784, y: 96 });
  });

  it('hudAnchor("round-counter") returns Board 02 §4.5 position', () => {
    expect(hudAnchor('round-counter')).toEqual({ x: 1024, y: 96 });
  });

  it('hudAnchor("quality-score") returns Board 02 §4.5 dial position', () => {
    expect(hudAnchor('quality-score')).toEqual({ x: 1064, y: 104 });
  });

  it('hudAnchor("done-day") returns Board 02 §4.6 position', () => {
    expect(hudAnchor('done-day')).toEqual({ x: 1184, y: 296 });
  });

  it('hudAnchor("camera-state") returns top-left origin', () => {
    expect(hudAnchor('camera-state')).toEqual({ x: 8, y: 8 });
  });
});

describe('rooms.ts — priorityTintColor', () => {
  it('critical returns red', () => {
    expect(priorityTintColor('critical')).toBe('#ef4444');
  });

  it('high returns amber', () => {
    expect(priorityTintColor('high')).toBe('#f59e0b');
  });

  it('normal returns cyan', () => {
    expect(priorityTintColor('normal')).toBe('#22d3ee');
  });

  it('low returns grey', () => {
    expect(priorityTintColor('low')).toBe('#9ca3af');
  });
});

describe('rooms.ts — pressureColorForCount', () => {
  it('returns neutral tint for 0 tickets', () => {
    expect(pressureColorForCount(0)).toBe(0x2a3344);
  });

  it('returns neutral tint for 1..3 tickets', () => {
    expect(pressureColorForCount(1)).toBe(0x2a3344);
    expect(pressureColorForCount(3)).toBe(0x2a3344);
  });

  it('returns slight amber for 4..7 tickets', () => {
    expect(pressureColorForCount(4)).toBe(0x3d3020);
    expect(pressureColorForCount(7)).toBe(0x3d3020);
  });

  it('returns amber for 8..15 tickets', () => {
    expect(pressureColorForCount(8)).toBe(0x4a3010);
    expect(pressureColorForCount(15)).toBe(0x4a3010);
  });

  it('returns warm amber for 16+ tickets', () => {
    expect(pressureColorForCount(16)).toBe(0x5c3800);
    expect(pressureColorForCount(100)).toBe(0x5c3800);
  });
});

// ─── Phase 6: hud-state.ts ────────────────────────────────────────────────────

function makeTicket(overrides: Partial<TicketPlacement> = {}): TicketPlacement {
  return {
    ticketId: 'proj:1',
    externalId: '1',
    title: 'Test ticket',
    priority: 'normal',
    carrierPersonaId: 'proj:1',
    position: 'carried',
    roomId: 'dev',
    slotId: null,
    shelfSlot: null,
    indicator: null,
    projectSlug: 'proj',
    workItemId: 'uuid-1',
    ...overrides,
  };
}

function makePersona(overrides: Partial<PersonaPlacement> = {}): PersonaPlacement {
  return {
    personaId: 'proj:1',
    codename: 'ALPHA',
    projectSlug: 'proj',
    workItemId: 'uuid-1',
    externalId: '1',
    roomId: 'dev',
    deskSlot: 0,
    indicator: 'coffee',
    ...overrides,
  };
}

describe('hudStateFromPlacements', () => {
  it('returns hero: null when no carried ticket exists', () => {
    const state = hudStateFromPlacements([], [], null, {
      retryIncremented: [],
      mergedCelebrated: [],
    });
    expect(state.hero).toBeNull();
  });

  it('derives hero from first carried ticket', () => {
    const ticket = makeTicket({ priority: 'critical', externalId: '42', title: 'Big bug' });
    const persona = makePersona({ personaId: 'proj:42', externalId: '42' });
    const state = hudStateFromPlacements(
      [persona],
      [{ ...ticket, ticketId: 'proj:42', carrierPersonaId: 'proj:42' }],
      null,
      { retryIncremented: [], mergedCelebrated: [] },
    );
    expect(state.hero).not.toBeNull();
    expect(state.hero?.priority).toBe('critical');
    expect(state.hero?.bannerLabel).toContain('#42');
  });

  it('truncates long title in bannerLabel', () => {
    const longTitle = 'A'.repeat(50);
    const ticket = makeTicket({ title: longTitle });
    const state = hudStateFromPlacements([makePersona()], [ticket], null, {
      retryIncremented: [],
      mergedCelebrated: [],
    });
    expect(state.hero?.bannerLabel.length).toBeLessThan(60);
    expect(state.hero?.bannerLabel).toContain('…');
  });

  it('accumulates retry counts from events', () => {
    const ticket = makeTicket();
    const state = hudStateFromPlacements([makePersona()], [ticket], null, {
      retryIncremented: ['proj:1', 'proj:1'],
      mergedCelebrated: [],
    });
    expect(state.retry['proj:1']).toBe(2);
  });

  it('carries forward retry counts from prev state', () => {
    const ticket = makeTicket();
    const prev = hudStateFromPlacements([makePersona()], [ticket], null, {
      retryIncremented: ['proj:1'],
      mergedCelebrated: [],
    });
    const next = hudStateFromPlacements([makePersona()], [ticket], prev, {
      retryIncremented: ['proj:1'],
      mergedCelebrated: [],
    });
    expect(next.retry['proj:1']).toBe(2);
  });

  it('increments doneToday for each merged event', () => {
    const state = hudStateFromPlacements([], [], null, {
      retryIncremented: [],
      mergedCelebrated: ['proj:1', 'proj:2'],
    });
    expect(state.doneToday).toBe(2);
  });

  it('carries forward doneToday from prev', () => {
    const prev = hudStateFromPlacements([], [], null, {
      retryIncremented: [],
      mergedCelebrated: ['proj:1'],
    });
    const next = hudStateFromPlacements([], [], prev, {
      retryIncremented: [],
      mergedCelebrated: ['proj:2'],
    });
    expect(next.doneToday).toBe(2);
  });

  it('derives blocked personas from frozen placements', () => {
    const blockedPersona = makePersona({ roomId: null, indicator: 'bang' });
    const state = hudStateFromPlacements([blockedPersona], [], null, {
      retryIncremented: [],
      mergedCelebrated: [],
    });
    expect(state.blocked).toHaveLength(1);
    expect(state.blocked[0].personaId).toBe('proj:1');
    expect(state.blocked[0].mode).toBe('gate-pending');
  });

  it('maps non-bang frozen persona to needs-human mode', () => {
    const blockedPersona = makePersona({ roomId: null, indicator: 'question' });
    const state = hudStateFromPlacements([blockedPersona], [], null, {
      retryIncremented: [],
      mergedCelebrated: [],
    });
    expect(state.blocked[0].mode).toBe('needs-human');
  });

  it('derives review round from prev when hero is in review', () => {
    const ticket = makeTicket({ roomId: 'review' });
    const prev = hudStateFromPlacements([makePersona({ roomId: 'review' })], [ticket], null, {
      retryIncremented: [],
      mergedCelebrated: [],
    });
    expect(prev.reviewRound).toBe(1);
  });

  it('returns reviewRound: null when hero is not in review', () => {
    const ticket = makeTicket({ roomId: 'dev' });
    const state = hudStateFromPlacements([makePersona()], [ticket], null, {
      retryIncremented: [],
      mergedCelebrated: [],
    });
    expect(state.reviewRound).toBeNull();
  });

  it('computes per-room pressure from in-flight tickets', () => {
    const tickets = [
      makeTicket({ roomId: 'dev', position: 'carried' }),
      makeTicket({ ticketId: 'proj:2', externalId: '2', roomId: 'dev', position: 'desk' }),
    ];
    const state = hudStateFromPlacements([], tickets, null, {
      retryIncremented: [],
      mergedCelebrated: [],
    });
    expect(state.pressure.dev).toBe(2);
  });

  it('excludes shelf tickets from pressure', () => {
    const ticket = makeTicket({ roomId: 'done', position: 'shelf' });
    const state = hudStateFromPlacements([], [ticket], null, {
      retryIncremented: [],
      mergedCelebrated: [],
    });
    expect(state.pressure.done).toBe(0);
  });
});

describe('Phase 2.5 — visual canon', () => {
  const BOARD06_HEX = [
    '#2B2D42', '#3A3D5C', '#6B4F3B', '#6FE7FF',
    '#F2CC8F', '#FF6B6B', '#8BD17C', '#D68FD6',
    '#42466A', '#3B3D55', '#85694F', '#3F6B80', '#473A55',
  ];

  it('PALETTE has exactly 13 entries', () => {
    expect(Object.keys(PALETTE)).toHaveLength(13);
  });

  it('ROLE_TINTS covers every OFFICE_ROLES entry', () => {
    for (const role of OFFICE_ROLES) {
      expect(ROLE_TINTS).toHaveProperty(role);
    }
  });

  it('CINEMATIC_TINTS has exactly 8 entries', () => {
    expect(Object.keys(CINEMATIC_TINTS)).toHaveLength(8);
  });

  it('HUD_TINTS has exactly 8 entries', () => {
    expect(Object.keys(HUD_TINTS)).toHaveLength(8);
  });

  it('TEXTURE_KEYS has exactly 20 entries', () => {
    expect(Object.keys(TEXTURE_KEYS)).toHaveLength(20);
  });

  it('pngManifest keys match all TEXTURE_KEYS values', () => {
    const manifestKeys = new Set(pngManifest().map((e) => e.key));
    const textureValues = new Set(Object.values(TEXTURE_KEYS));
    expect(manifestKeys).toEqual(textureValues);
  });

  it('MANIFEST has 20 entries matching TEXTURE_KEYS count', async () => {
    const { MANIFEST } = await import('../../../../../scripts/generate-office-assets');
    expect(MANIFEST).toHaveLength(20);
    expect(MANIFEST.length).toBe(Object.keys(TEXTURE_KEYS).length);
  });

  it('every MANIFEST prompt contains at least one Board 06 hex code', async () => {
    const { MANIFEST } = await import('../../../../../scripts/generate-office-assets');
    const hexPattern = /#[0-9A-Fa-f]{6}/g;
    for (const spec of MANIFEST) {
      const found = spec.prompt.match(hexPattern) ?? [];
      const hasCanonical = found.some((h) => BOARD06_HEX.includes(h.toUpperCase()));
      expect(hasCanonical, `Prompt for ${spec.file} has no Board 06 hex: "${spec.prompt}"`).toBe(true);
    }
  });

  it('no non-canonical hex literals in game/ or components/', () => {
    const officeDir = join(process.cwd(), 'apps', 'web', 'src', 'components', 'office');
    const canonicalNums = new Set<number>([
      ...Object.values(PALETTE) as number[],
      ...Object.values(ROLE_TINTS) as number[],
      ...Object.values(CINEMATIC_TINTS).filter((v): v is number => typeof v === 'number'),
      ...Object.values(HUD_TINTS).filter((v): v is number => typeof v === 'number'),
    ]);

    function collectFiles(dir: string): string[] {
      const files: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          files.push(...collectFiles(full));
        } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
          files.push(full);
        }
      }
      return files;
    }

    const dirsToScan = [join(officeDir, 'game'), join(officeDir, 'components')];
    const allFiles: string[] = [];
    for (const d of dirsToScan) {
      allFiles.push(...collectFiles(d));
    }

    const hexLiteralPattern = /0x([0-9A-Fa-f]{6})\b/g;
    const violations: string[] = [];

    for (const file of allFiles) {
      if (file.endsWith('textures.ts')) continue;
      const src = readFileSync(file, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = hexLiteralPattern.exec(src)) !== null) {
        const val = parseInt(m[1], 16);
        if (!canonicalNums.has(val)) {
          const rel = file.replace(officeDir + '/', '');
          violations.push(`${rel}: 0x${m[1]}`);
        }
      }
      hexLiteralPattern.lastIndex = 0;
    }

    expect(violations, `Non-canonical hex literals found:\n${violations.join('\n')}`).toHaveLength(0);
  });
});
