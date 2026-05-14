// Pure layout math for the Office view: floor positions, desk positions,
// stairwell positions. No Phaser imports — easy to unit-test.

import { OFFICE_ROLES, type OfficeRole } from './state-to-role';

export const TILE_SIZE = 16;
export const FLOOR_TILES_WIDE = 80; // v1 canonical floor: 80 tiles × 16 px = 1280 px
export const FLOOR_TILES_TALL = 24; // v1 canonical floor: 24 tiles × 16 px = 384 px
export const FLOOR_PIXEL_WIDTH = TILE_SIZE * FLOOR_TILES_WIDE; // 1280
export const FLOOR_PIXEL_HEIGHT = TILE_SIZE * FLOOR_TILES_TALL; // 384
export const FLOOR_GAP_PX = TILE_SIZE * 2;

export interface CameraBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloorOverviewCameraLayout {
  zoom: number;
  bounds: CameraBounds;
}

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
 * @deprecated v1 — use room desk anchors from `lib/rooms.ts` instead.
 * Kept for SpriteLayer backward-compat during Phase 2 transition.
 * Returns one desk per role evenly spaced across the floor.
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

/**
 * Phaser's RESIZE scale mode resizes the canvas, not the world. Keep the
 * canonical 1280x384 floor geometry, then zoom the camera up to the largest
 * size that still keeps a focused floor visible.
 */
export function floorOverviewZoomForViewport(
  viewportWidth: number,
  viewportHeight: number,
): number {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  return Math.max(1, Math.min(width / FLOOR_PIXEL_WIDTH, height / FLOOR_PIXEL_HEIGHT));
}

/**
 * Camera bounds need padding whenever the visible world is larger than a floor;
 * otherwise Phaser clamps the camera to x=0/y=0 and wide viewports show the
 * office glued to the left edge.
 */
export function floorOverviewCameraLayout(
  viewportWidth: number,
  viewportHeight: number,
  floorCount: number,
): FloorOverviewCameraLayout {
  const zoom = floorOverviewZoomForViewport(viewportWidth, viewportHeight);
  const visibleWorldWidth = Math.max(1, viewportWidth) / zoom;
  const visibleWorldHeight = Math.max(1, viewportHeight) / zoom;
  const horizontalPad = Math.max(0, (visibleWorldWidth - FLOOR_PIXEL_WIDTH) / 2);
  const verticalPad = Math.max(0, (visibleWorldHeight - FLOOR_PIXEL_HEIGHT) / 2);
  const worldHeight = totalWorldHeight(floorCount);

  return {
    zoom,
    bounds: {
      x: horizontalPad > 0 ? -horizontalPad : 0,
      y: verticalPad > 0 ? -verticalPad : 0,
      width: FLOOR_PIXEL_WIDTH + horizontalPad * 2,
      height: worldHeight + verticalPad * 2,
    },
  };
}
