// Pure layout math for the Office view: floor positions, desk positions,
// stairwell positions. No Phaser imports — easy to unit-test.

import { OFFICE_ROLES, type OfficeRole } from './state-to-role';

export const TILE_SIZE = 16;
export const FLOOR_TILES_WIDE = 30;
export const FLOOR_TILES_TALL = 12;
export const FLOOR_PIXEL_WIDTH = TILE_SIZE * FLOOR_TILES_WIDE;
export const FLOOR_PIXEL_HEIGHT = TILE_SIZE * FLOOR_TILES_TALL;
export const FLOOR_GAP_PX = TILE_SIZE * 2;

/**
 * Y origin (top edge) of a floor in world coordinates. Floor 0 sits at y=0;
 * each subsequent floor is stacked vertically below the previous one.
 */
export function floorOriginY(floorIndex: number): number {
  if (floorIndex < 0) throw new RangeError('floorIndex must be >= 0');
  return floorIndex * (FLOOR_PIXEL_HEIGHT + FLOOR_GAP_PX);
}

/**
 * Y center of a floor — useful for camera pans.
 */
export function floorCenterY(floorIndex: number): number {
  return floorOriginY(floorIndex) + FLOOR_PIXEL_HEIGHT / 2;
}

export interface DeskPosition {
  role: OfficeRole;
  /** Center of the desk in world coordinates. */
  x: number;
  y: number;
}

/**
 * Returns one desk per role, evenly spaced across the floor. Roles are placed
 * left-to-right in the canonical `OFFICE_ROLES` order.
 *
 * The desks sit at ~70% of the floor height (lower section), leaving the top
 * for the project banner.
 */
export function deskPositions(floorIndex: number): DeskPosition[] {
  const originY = floorOriginY(floorIndex);
  const deskRowY = originY + Math.floor(FLOOR_PIXEL_HEIGHT * 0.66);
  const slotWidth = FLOOR_PIXEL_WIDTH / OFFICE_ROLES.length;
  return OFFICE_ROLES.map((role, i) => ({
    role,
    x: Math.round(slotWidth * (i + 0.5)),
    y: deskRowY,
  }));
}

/**
 * X position of the staircase / elevator on a floor: just inside the right wall.
 */
export function stairsPosition(floorIndex: number): { x: number; y: number } {
  return {
    x: FLOOR_PIXEL_WIDTH - TILE_SIZE * 2,
    y: floorOriginY(floorIndex) + TILE_SIZE * 2,
  };
}

/**
 * Total world height for `n` floors, accounting for inter-floor gaps. Used to
 * size the Phaser camera bounds.
 */
export function totalWorldHeight(floorCount: number): number {
  if (floorCount <= 0) return 0;
  return floorCount * FLOOR_PIXEL_HEIGHT + Math.max(0, floorCount - 1) * FLOOR_GAP_PX;
}
