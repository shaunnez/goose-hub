// Pure path math for sprite movement between desks.
//
// Office floors are open-plan (no walls between desks within a floor); the
// "path" between two same-floor desks is just a polyline that goes:
//   1. up to a corridor row (avoids walking through other desks),
//   2. horizontally to the destination column,
//   3. down to the destination desk.
//
// Cross-floor paths route via the floor's stairwell at one end and the other.
//
// All math is integer-pixel. Returns world-coordinate waypoints suitable for
// feeding into Phaser tweens.

import { TILE_SIZE, floorOriginY, stairsPosition } from './layout';

export interface Point {
  x: number;
  y: number;
}

export interface PathSegment {
  /** True when this segment goes via the staircase between floors. */
  viaStairs: boolean;
  waypoints: Point[];
}

/**
 * Y coordinate of the corridor walking lane on a given floor (py=88 for floor 0).
 * Returns the center of the corridor band (ty=4..6): floorOriginY + TILE_SIZE*5 + TILE_SIZE/2.
 * Matches CORRIDOR_WALK_Y in lib/rooms.ts.
 */
export function corridorY(floorIndex: number): number {
  return floorOriginY(floorIndex) + TILE_SIZE * 5 + TILE_SIZE / 2;
}

/**
 * Same-floor path: from-desk → up to corridor → across → down to to-desk.
 */
export function sameFloorPath(from: Point, to: Point, floorIndex: number): Point[] {
  const corridor = corridorY(floorIndex);
  // Already same column: straight vertical line.
  if (from.x === to.x) return [from, to];
  return [from, { x: from.x, y: corridor }, { x: to.x, y: corridor }, to];
}

/**
 * Cross-floor path: from-desk → corridor → stairs (origin floor) → stairs
 * (destination floor) → corridor → to-desk.
 *
 * The vertical segment between the two stair points is rendered as a single
 * "ride the stairs" tween by the scene; we still emit the waypoints so the
 * tween chain stays uniform.
 */
export function crossFloorPath(
  from: Point,
  fromFloor: number,
  to: Point,
  toFloor: number,
): Point[] {
  if (fromFloor === toFloor) return sameFloorPath(from, to, fromFloor);
  const stairsFrom = stairsPosition(fromFloor);
  const stairsTo = stairsPosition(toFloor);
  return [
    from,
    { x: from.x, y: corridorY(fromFloor) },
    { x: stairsFrom.x, y: corridorY(fromFloor) },
    stairsFrom,
    stairsTo,
    { x: stairsTo.x, y: corridorY(toFloor) },
    { x: to.x, y: corridorY(toFloor) },
    to,
  ];
}

/**
 * Returns the full waypoint list for a desk-to-desk walk. Picks the same-floor
 * vs cross-floor path based on the floor indices.
 */
export function planWalk(from: Point, fromFloor: number, to: Point, toFloor: number): PathSegment {
  if (fromFloor === toFloor) {
    return { viaStairs: false, waypoints: sameFloorPath(from, to, fromFloor) };
  }
  return { viaStairs: true, waypoints: crossFloorPath(from, fromFloor, to, toFloor) };
}

/**
 * Total Manhattan distance walked along a polyline. Used to scale tween
 * durations so a long walk takes proportionally longer than a short one.
 */
export function pathLength(waypoints: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    total += Math.abs(waypoints[i].x - waypoints[i - 1].x);
    total += Math.abs(waypoints[i].y - waypoints[i - 1].y);
  }
  return total;
}

/**
 * Returns the cardinal facing direction implied by moving from `a` to `b`.
 * Used to pick the sprite's walking-direction frame.
 */
export function facingFromMovement(a: Point, b: Point): 'left' | 'right' | 'up' | 'down' {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}
