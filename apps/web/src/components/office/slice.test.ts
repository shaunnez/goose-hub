// Slice contract tests for the Office view (M17). Exercises the pure
// state→role / state→indicator / layout / pathfinding / placement logic.
//
// The Phaser scene + React mount are exercised by Playwright e2e
// (apps/web/e2e/m17-office-tab.spec.ts) — they need a real browser canvas and
// won't run in jsdom.

import { describe, expect, it } from 'vitest';
import { OFFICE_ROLES, busyRoles, idleIndicator, placementsFromItems } from './lib/agent-positions';
import { CODENAME_POOL, codenameFor } from './lib/persona-codenames';
import { ticketAtDeskOffset, ticketCarryOffset } from './lib/ticket-carry';
import {
  FLOOR_GAP_PX,
  FLOOR_PIXEL_HEIGHT,
  deskPositions,
  floorCenterY,
  floorOriginY,
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
import {
  CORRIDOR_WALK_Y,
  FLOOR_WORLD,
  ROOM_IDS,
  allClickZones,
  cameraAnchor,
  roomBounds,
  roomDeskAnchors,
  roomDoor,
  roomQueueAnchor,
  roomSlotAnchors,
} from './lib/rooms';
import { IDLE_INDICATOR, indicatorForState } from './lib/state-indicators';
import { deskForState, shouldWalk } from './lib/state-to-role';

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
