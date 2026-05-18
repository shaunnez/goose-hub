// Static floor + walls + doors + per-room "backboard" baked into a single
// Canvas2D texture. Ported from the Claude Design "Office Floor" handoff
// (HTML/CSS/JS prototype) and adapted to the existing rooms.ts coordinate
// system (1280×544 floor, 6-tile-tall back walls). Run once at scene init
// via `generateOfficeFloorTexture(scene)`; RoomLayer.buildFloor blits this
// texture as a single Image per project floor.
//
// What lives here (matches the design's brief):
//   • Brick floor — same staggered tile across rooms + corridor (cool dark
//     grey), with a soft warm light wash near the room bands.
//   • Walls — same brick pattern in a warmer/lighter palette, with top
//     highlight and bottom shadow stripes.
//   • Doors — recessed perspective archway + recessed wood panel with a
//     coloured glass insert per room; threshold light pool at the door.
//   • Per-room ambient — coloured air-light wash over each room area.
//   • Per-room "backboard" — kanban / gauge / poster / bookshelf / etc.
//     drawn onto each room's back wall band.
//
// Dynamic effects (pressure tint, door open/close anim, wall tint overlay,
// click zones, labels, desks, lamps) remain in RoomLayer.

import type Phaser from 'phaser';
import {
  BOTTOM_BAND_ROOMS,
  BOTTOM_BAND_Y,
  BOTTOM_INTER_ROOM_WALL_X,
  CORRIDOR_Y,
  FLOOR_WORLD,
  ROOM_IDS,
  type RoomId,
  TOP_BAND_ROOMS,
  TOP_BAND_Y,
  TOP_INTER_ROOM_WALL_X,
  roomBounds,
  roomDoor,
} from '../lib/rooms';

export const STATIC_FLOOR_TEXTURE_KEY = 'office:static-floor';

// Each room's back-wall band height (in pixels). Keeps the existing
// 6-tile back wall (96 px) so wall-anchored prop positions don't shift.
const BACK_WALL_HEIGHT = 96;

// Brick tile dimensions — design defaults.
const BRICK_W = 20;
const BRICK_H = 10;

// Outer-wall thickness (matches existing TILE_SIZE).
const WALL_THICKNESS = 16;

// Door gap is 2 tiles wide; half-width used for centering.
const DOOR_HALF_WIDTH = 16;

interface BrickTones {
  base: string;
  hi: string;
  lo: string;
  grout: string;
  spec: string;
}

const FLOOR_TONES: BrickTones = {
  base: '#2c2a2e',
  hi: '#36343a',
  lo: '#1e1c20',
  grout: '#0e0c10',
  spec: 'rgba(255,255,255,0.025)',
};

const WALL_TONES: BrickTones = {
  base: '#5e564a',
  hi: '#6c6354',
  lo: '#4a4338',
  grout: '#2e2820',
  spec: 'rgba(255,235,200,0.04)',
};

/**
 * Generates (or refreshes) the static floor texture under the scene's
 * texture manager. Idempotent — safe to call multiple times. The texture
 * is `FLOOR_WORLD.width × FLOOR_WORLD.height`.
 */
export function generateOfficeFloorTexture(scene: Phaser.Scene): void {
  const W = FLOOR_WORLD.width;
  const H = FLOOR_WORLD.height;
  const tex = scene.textures.exists(STATIC_FLOOR_TEXTURE_KEY)
    ? (scene.textures.get(STATIC_FLOOR_TEXTURE_KEY) as Phaser.Textures.CanvasTexture)
    : scene.textures.createCanvas(STATIC_FLOOR_TEXTURE_KEY, W, H);
  if (tex == null) return;
  const ctx = tex.context;
  ctx.imageSmoothingEnabled = false;

  // 1) page-void background
  fill(ctx, 0, 0, W, H, '#050309');

  // 2) Brick floor across the three bands (rooms + corridor share the tile).
  drawBrickArea(ctx, 0, TOP_BAND_Y.y1, W, bandH(TOP_BAND_Y), FLOOR_TONES);
  drawBrickArea(ctx, 0, CORRIDOR_Y.y1, W, bandH(CORRIDOR_Y), FLOOR_TONES);
  drawBrickArea(ctx, 0, BOTTOM_BAND_Y.y1, W, bandH(BOTTOM_BAND_Y), FLOOR_TONES);

  // 3) Soft warm floor-light wash at the top of each band — implies the
  // pendant lamps spilling light onto the floor near the back wall.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const y of [TOP_BAND_Y.y1, BOTTOM_BAND_Y.y1]) {
    const grad = ctx.createLinearGradient(0, y, 0, y + 176);
    grad.addColorStop(0, 'rgba(255, 200, 120, 0)');
    grad.addColorStop(0.55, 'rgba(255, 200, 120, 0.05)');
    grad.addColorStop(1, 'rgba(255, 200, 120, 0.10)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, y, W, 176);
  }
  ctx.restore();

  // 4) Per-room ambient — coloured air-light wash over each room.
  for (const id of ROOM_IDS) {
    const tint = roomAmbient(id);
    if (tint == null) continue;
    const b = roomBounds(id);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = tint;
    ctx.fillRect(b.x1, b.y1, b.x2 - b.x1 + 1, b.y2 - b.y1 + 1);
    ctx.restore();
  }

  // 5) Per-room back walls — brick band at the top of each room, with the
  // thematic "backboard" content mounted on top.
  for (const id of ROOM_IDS) {
    const b = roomBounds(id);
    const w = b.x2 - b.x1 + 1;
    drawRoomBackWall(ctx, b.x1, b.y1, w, BACK_WALL_HEIGHT);
    drawWallObjects(ctx, id, b.x1, b.y1, w, BACK_WALL_HEIGHT);
  }

  // 6) Outer perimeter + inter-room + band walls — same brick, but using
  // the warmer wall palette.
  drawAllWalls(ctx, W);

  // 7) Doors — recessed perspective archway with a thematic door panel.
  drawAllDoors(ctx);

  tex.refresh();
}

// ─── primitives ────────────────────────────────────────────────────────────

function fill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
}

function px(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  w?: number,
  h?: number,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x | 0, y | 0, (w ?? 1) | 0, (h ?? 1) | 0);
}

function bandH(b: { y1: number; y2: number }): number {
  return b.y2 - b.y1 + 1;
}

// ─── brick tile fill ───────────────────────────────────────────────────────

/** Staggered brick tile fill — drives both the floor and the walls. */
function drawBrickArea(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tones: BrickTones,
): void {
  fill(ctx, x, y, w, h, tones.base);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  let row = 0;
  for (let by = y; by < y + h; by += BRICK_H) {
    const off = row & 1 ? BRICK_W / 2 : 0;
    for (let bx = x - BRICK_W + off; bx < x + w + BRICK_W; bx += BRICK_W) {
      const tone = ((bx + row * 7) >> 5) & 1 ? tones.hi : tones.lo;
      fill(ctx, bx + 1, by + 1, BRICK_W - 2, BRICK_H - 2, tone);
      fill(ctx, bx + 1, by + 1, BRICK_W - 2, 1, tones.spec);
    }
    row++;
  }
  // Very soft grout — alpha-blended seams, not heavy stripes.
  ctx.globalAlpha = 0.45;
  for (let by = y; by < y + h; by += BRICK_H) {
    fill(ctx, x, by, w, 1, tones.grout);
    const off = (((by - y) / BRICK_H) | 0) & 1 ? BRICK_W / 2 : 0;
    for (let bx = x - BRICK_W + off; bx < x + w + BRICK_W; bx += BRICK_W) {
      fill(ctx, bx, by, 1, BRICK_H, tones.grout);
    }
  }
  ctx.restore();
}

function drawBrickWall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  drawBrickArea(ctx, x, y, w, h, WALL_TONES);
  fill(ctx, x, y, w, 1, '#7c7268');
  fill(ctx, x, y + h - 1, w, 1, '#1a1410');
}

// ─── per-room ambient + back wall ──────────────────────────────────────────

function roomAmbient(id: RoomId): string | null {
  switch (id) {
    case 'dev':
      return 'rgba(255, 200, 120, 0.10)';
    case 'qa':
      return 'rgba(80, 180, 220, 0.18)';
    case 'review':
      return 'rgba(180, 120, 220, 0.16)';
    case 'retro':
      return 'rgba(214, 143, 214, 0.08)';
    case 'done':
      return 'rgba(160, 220, 140, 0.10)';
    case 'archive':
      return 'rgba(255, 180, 100, 0.08)';
    case 'backlog':
      return 'rgba(255, 200, 120, 0.08)';
    case 'triage':
      return 'rgba(120, 200, 255, 0.06)';
    case 'investigation':
      return 'rgba(255, 200, 120, 0.08)';
    case 'library':
      return 'rgba(80, 220, 180, 0.16)';
    case 'coffee':
      return 'rgba(255, 180, 100, 0.12)';
  }
}

/** Lighter-brick back wall + ceiling shadow + wall-to-floor seam shadow. */
function drawRoomBackWall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  wallH: number,
): void {
  drawBrickArea(ctx, x, y, w, wallH, WALL_TONES);
  // Top ceiling shadow — gradient at the very top of the wall.
  ctx.save();
  const cg = ctx.createLinearGradient(0, y, 0, y + 14);
  cg.addColorStop(0, 'rgba(0,0,0,0.55)');
  cg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = cg;
  ctx.fillRect(x, y, w, 14);
  ctx.restore();
  // Wall-to-floor seam shadow.
  fill(ctx, x, y + wallH - 1, w, 1, '#1a1410');
  fill(ctx, x, y + wallH, w, 2, 'rgba(0,0,0,0.55)');
  fill(ctx, x, y + wallH + 2, w, 1, 'rgba(0,0,0,0.30)');
  fill(ctx, x, y + wallH + 3, w, 1, 'rgba(0,0,0,0.15)');
}

// ─── outer + interior walls ────────────────────────────────────────────────

function drawAllWalls(ctx: CanvasRenderingContext2D, W: number): void {
  const topRowY = TOP_BAND_Y.y1 - WALL_THICKNESS; // outer top
  const bottomRowY = BOTTOM_BAND_Y.y2 + 1; // outer bottom
  // Outer top + bottom (only the bottom is visible in the existing
  // 1280×544 frame — the top is at y=64..79 which is partially in-frame).
  if (topRowY >= 0) drawBrickWall(ctx, 0, topRowY, W, WALL_THICKNESS);
  drawBrickWall(ctx, 0, bottomRowY, W, WALL_THICKNESS);

  // Top-band south wall + bottom-band north wall — segmented around door
  // gaps so the corridor reads through.
  drawWallRowWithDoors(ctx, TOP_BAND_Y.y2 + 1, W, topBandDoorXs());
  drawWallRowWithDoors(ctx, BOTTOM_BAND_Y.y1 - WALL_THICKNESS, W, bottomBandDoorXs());

  // Vertical inter-room walls — span the whole band including back wall.
  const topWallH = TOP_BAND_Y.y2 - TOP_BAND_Y.y1 + 1 + WALL_THICKNESS;
  for (const wx of TOP_INTER_ROOM_WALL_X) {
    drawBrickWall(ctx, wx, TOP_BAND_Y.y1, WALL_THICKNESS, topWallH);
  }
  const botWallH = BOTTOM_BAND_Y.y2 - BOTTOM_BAND_Y.y1 + 1 + WALL_THICKNESS;
  for (const wx of BOTTOM_INTER_ROOM_WALL_X) {
    drawBrickWall(ctx, wx, BOTTOM_BAND_Y.y1 - WALL_THICKNESS, WALL_THICKNESS, botWallH);
  }

  // Outer side walls — enclose the leftmost/rightmost rooms.
  const sideY = TOP_BAND_Y.y1;
  const sideH = BOTTOM_BAND_Y.y2 - TOP_BAND_Y.y1 + 1 + WALL_THICKNESS;
  drawBrickWall(ctx, 0, sideY, WALL_THICKNESS, sideH);
  drawBrickWall(ctx, W - WALL_THICKNESS, sideY, WALL_THICKNESS, sideH);
}

function drawWallRowWithDoors(
  ctx: CanvasRenderingContext2D,
  y: number,
  W: number,
  doorXs: number[],
): void {
  let cursor = 0;
  const sorted = doorXs.slice().sort((a, b) => a - b);
  for (const dx of sorted) {
    const gapStart = dx - DOOR_HALF_WIDTH;
    const gapEnd = dx + DOOR_HALF_WIDTH;
    if (cursor < gapStart) drawBrickWall(ctx, cursor, y, gapStart - cursor, WALL_THICKNESS);
    cursor = gapEnd;
  }
  if (cursor < W) drawBrickWall(ctx, cursor, y, W - cursor, WALL_THICKNESS);
}

function topBandDoorXs(): number[] {
  return TOP_BAND_ROOMS.map((id) => roomDoor(id)?.x).filter((x): x is number => x != null);
}
function bottomBandDoorXs(): number[] {
  return BOTTOM_BAND_ROOMS.map((id) => roomDoor(id)?.x).filter((x): x is number => x != null);
}

// ─── doors (perspective archway + recessed panel) ──────────────────────────

function drawAllDoors(ctx: CanvasRenderingContext2D): void {
  for (const id of TOP_BAND_ROOMS) {
    const door = roomDoor(id);
    if (door == null) continue;
    drawDoor(ctx, door.x, TOP_BAND_Y.y2 + 1, id, 'south');
  }
  for (const id of BOTTOM_BAND_ROOMS) {
    const door = roomDoor(id);
    if (door == null) continue;
    drawDoor(ctx, door.x, BOTTOM_BAND_Y.y1 - WALL_THICKNESS, id, 'north');
  }
}

/**
 * Draws a single doorway: dark recessed outer frame, perspective archway
 * (trapezoidal jambs converging upward), a wood door panel inset at the
 * bottom with a coloured glass insert that brands the room, a header
 * lintel highlight, and a threshold light pool on the corridor side.
 */
function drawDoor(
  ctx: CanvasRenderingContext2D,
  cx: number,
  wallY: number,
  id: RoomId,
  side: 'south' | 'north',
): void {
  const w = 36;
  const innerW = 28;
  const wallH = WALL_THICKNESS;
  const h = 44; // doorway extends above the wall row into the back-wall area
  const x = cx - w / 2;
  const top = side === 'south' ? wallY - (h - wallH) : wallY;
  const bottom = top + h;

  // Outer dark frame (recessed shadow)
  fill(ctx, x - 2, top - 2, w + 4, h + 4, '#06030a');

  // Doorway interior with perspective
  drawDoorwayPerspective(ctx, x, top, w, h);

  // Door panel sits at the BOTTOM of the doorway
  const panelH = 28;
  const panelTop = bottom - panelH - 2;
  drawDoorPanel(ctx, cx - innerW / 2, panelTop, innerW, panelH, id);

  // Header lintel / arch top
  fill(ctx, x - 1, top, w + 2, 3, '#5a5258');
  fill(ctx, x, top + 3, w, 2, '#3a3538');
  fill(ctx, x + 2, top + 5, w - 4, 1, '#241f22');

  // Threshold light pool — radial pool of warm light at the corridor side.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const baseY = side === 'south' ? bottom : top;
  const g = ctx.createRadialGradient(cx, baseY, 0, cx, baseY, 22);
  g.addColorStop(0, 'rgba(255, 214, 140, 0.35)');
  g.addColorStop(1, 'rgba(255, 214, 140, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, baseY, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawDoorwayPerspective(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const inset = 3;
  const tx = x + inset;
  const tw = w - inset * 2;
  // Floor of the recess
  fill(ctx, x, y, w, h, '#1a1620');
  // Back face — slightly lighter so depth reads
  fill(ctx, tx, y + 4, tw, h - 8, '#2a2330');
  // Side + top jambs as converging trapezoids
  ctx.save();
  ctx.fillStyle = '#0a0610';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(tx, y + 4);
  ctx.lineTo(tx, y + h - 4);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + w, y);
  ctx.lineTo(tx + tw, y + 4);
  ctx.lineTo(tx + tw, y + h - 4);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(tx + tw, y + 4);
  ctx.lineTo(tx, y + 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // Highlight on the near edge of the lintel
  fill(ctx, x, y, w, 1, '#5e565a');
  // Shadow drop on near edges of side jambs
  fill(ctx, x, y, 1, h, '#0a0610');
  fill(ctx, x + w - 1, y, 1, h, '#0a0610');
}

function drawDoorPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  id: RoomId,
): void {
  fill(ctx, x, y, w, h, '#3a2618');
  fill(ctx, x + 1, y + 1, w - 2, h - 2, '#4e3a22');
  // Two recessed inner panels
  fill(ctx, x + 3, y + 3, w - 6, 8, '#2a1a08');
  fill(ctx, x + 3, y + 13, w - 6, h - 16, '#2a1a08');
  fill(ctx, x + 4, y + 4, w - 8, 6, '#7a5a38');
  fill(ctx, x + 4, y + 14, w - 8, h - 18, '#7a5a38');

  // Coloured glass insert at the top — brands the room.
  const t = doorGlassTone(id);
  fill(ctx, x + 4, y + 4, w - 8, 4, t[1]);
  fill(ctx, x + 4, y + 4, w - 8, 2, t[0]);
  px(ctx, x + 6, y + 5, 'rgba(255,255,255,0.4)', 6, 1);

  // Brass handle
  px(ctx, x + w - 6, y + (h >> 1), '#d4a85a', 2, 3);
  px(ctx, x + w - 5, y + (h >> 1) + 1, '#fff7d0', 1, 1);

  // Bottom kick-plate
  fill(ctx, x + 1, y + h - 3, w - 2, 2, '#1a0e08');
}

function doorGlassTone(id: RoomId): [string, string] {
  switch (id) {
    case 'qa':
    case 'triage':
      return ['#6fe7ff', '#3a8a9e'];
    case 'review':
    case 'retro':
      return ['#d68fd6', '#6a3a8a'];
    case 'done':
      return ['#8bd17c', '#3a6a32'];
    case 'library':
      return ['#6fe7d4', '#2a6a5a'];
    default:
      return ['#f2cc8f', '#8a6a3a'];
  }
}

// ─── per-room "backboards" ─────────────────────────────────────────────────

function drawWallObjects(
  ctx: CanvasRenderingContext2D,
  id: RoomId,
  x: number,
  y: number,
  w: number,
  wallH: number,
): void {
  switch (id) {
    case 'dev':
      wallDev(ctx, x, y, w, wallH);
      return;
    case 'qa':
      wallQA(ctx, x, y, w, wallH);
      return;
    case 'review':
      wallReview(ctx, x, y, w, wallH);
      return;
    case 'retro':
      wallRetro(ctx, x, y, w, wallH);
      return;
    case 'done':
      wallDone(ctx, x, y, w, wallH);
      return;
    case 'archive':
      wallArchive(ctx, x, y, w, wallH);
      return;
    case 'backlog':
      wallBacklog(ctx, x, y, w, wallH);
      return;
    case 'triage':
      wallTriage(ctx, x, y, w, wallH);
      return;
    case 'investigation':
      wallInvestigation(ctx, x, y, w, wallH);
      return;
    case 'library':
      wallLibrary(ctx, x, y, w, wallH);
      return;
    case 'coffee':
      wallCoffee(ctx, x, y, w, wallH);
      return;
  }
}

// ─── shared widgets ────────────────────────────────────────────────────────

interface TaskBoardOpts {
  board?: string;
  header?: string;
  cols?: string[];
  stickyColors?: string[];
  perCol?: number[];
}

function taskBoard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: TaskBoardOpts = {},
): void {
  const board = opts.board ?? '#ece6d0';
  const headerBg = opts.header ?? '#3a2a18';
  const cols = opts.cols ?? ['TODO', 'DOING', 'DONE'];
  const colors = opts.stickyColors ?? [
    '#f2cc8f',
    '#8bd17c',
    '#6fe7ff',
    '#d68fd6',
    '#ff6b6b',
    '#f59e0b',
  ];
  const perCol = opts.perCol;

  fill(ctx, x - 2, y - 2, w + 4, h + 4, '#1a0e08');
  fill(ctx, x - 1, y - 1, w + 2, h + 2, '#5a3a22');
  fill(ctx, x, y, w, h, board);
  fill(ctx, x, y, w, 1, '#fff7d8');
  fill(ctx, x, y + h - 1, w, 1, '#b8a880');
  fill(ctx, x, y, w, 8, headerBg);
  fill(ctx, x, y + 8, w, 1, 'rgba(0,0,0,0.55)');
  for (let i = 0; i < cols.length; i++) {
    const cw = Math.floor(w / cols.length);
    const cxs = x + i * cw + 3;
    for (let k = 0; k < cols[i].length && k < 6; k++) {
      px(ctx, cxs + k * 2, y + 3, '#f0e6c8', 1, 3);
    }
  }
  for (let i = 1; i < cols.length; i++) {
    const cw = Math.floor(w / cols.length);
    fill(ctx, x + i * cw, y + 9, 1, h - 10, 'rgba(0,0,0,0.3)');
  }
  for (let c = 0; c < cols.length; c++) {
    const cw = Math.floor(w / cols.length);
    const colX = x + c * cw + 2;
    const colW = cw - 4;
    const slots = Math.floor((h - 14) / 7);
    const count = Math.max(1, Math.min(slots, perCol ? perCol[c] : 3));
    for (let s = 0; s < count; s++) {
      const sx = colX + (s & 1) * 3;
      const sy = y + 11 + s * 7;
      const sw = Math.min(colW - 2, 12);
      const c2 = colors[(c * 3 + s) % colors.length];
      fill(ctx, sx, sy, sw, 5, c2);
      fill(ctx, sx, sy, sw, 1, 'rgba(255,255,255,0.5)');
      fill(ctx, sx, sy + 4, sw, 1, 'rgba(0,0,0,0.25)');
      fill(ctx, sx + 1, sy + 2, sw - 3, 1, 'rgba(0,0,0,0.25)');
    }
  }
}

function framedPoster(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  c1: string,
  c2: string,
): void {
  fill(ctx, x - 1, y - 1, w + 2, h + 2, '#0e0608');
  fill(ctx, x, y, w, h, '#1a1018');
  fill(ctx, x + 1, y + 1, w - 2, h - 2, c1);
  fill(ctx, x + 3, y + 3, w - 6, Math.max(1, h - 6), c2);
}

function pipeRun(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  color = '#5a4a36',
): void {
  fill(ctx, x, y, w, 3, color);
  fill(ctx, x, y, w, 1, 'rgba(255,255,255,0.25)');
  fill(ctx, x, y + 2, w, 1, 'rgba(0,0,0,0.5)');
}

function bookshelf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  fill(ctx, x - 1, y - 1, w + 2, h + 2, '#1a0e08');
  fill(ctx, x, y, w, h, '#3a2418');
  const shelfCount = Math.max(3, Math.floor(h / 14));
  const shelfH = Math.floor(h / shelfCount);
  for (let s = 0; s < shelfCount; s++) {
    const sy = y + s * shelfH + 2;
    const innerH = shelfH - 4;
    fill(ctx, x + 1, sy + innerH, w - 2, 2, '#5a3624');
    const palette = [
      '#6a3a52',
      '#3a6a8a',
      '#8a4a3a',
      '#3a8a6a',
      '#8a8a4a',
      '#5a3a8a',
      '#3a3a8a',
      '#8a4a4a',
      '#9a6a32',
    ];
    let bx = x + 2;
    let k = 0;
    while (bx < x + w - 2) {
      const bw = 2 + ((bx * (s + 1)) % 3);
      const bh = innerH - 1 - ((bx + s) % 3);
      const c = palette[(k + s) % palette.length];
      fill(ctx, bx, sy + 1 + (innerH - bh), bw, bh, c);
      px(ctx, bx, sy + 1 + (innerH - bh), 'rgba(255,255,255,0.25)', bw, 1);
      bx += bw + 1;
      k++;
    }
  }
}

// ─── per-room renderers ────────────────────────────────────────────────────

function wallDev(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, wallH: number) {
  pipeRun(ctx, x + 4, y + 6, w - 8);
  const bw = Math.min(w - 60, 200);
  const bh = wallH - 26;
  const bx = x + Math.floor((w - bw) / 2);
  const by = y + 14;
  taskBoard(ctx, bx, by, bw, bh, {
    cols: ['BACKLOG', 'DOING', 'REVIEW', 'DONE'],
    perCol: [4, 3, 2, 5],
    stickyColors: ['#6fe7ff', '#f2cc8f', '#8bd17c', '#d68fd6', '#ff6b6b', '#f59e0b'],
  });
  // CRT mounted left
  framedPoster(ctx, x + 12, y + 18, 34, 22, '#0a1a22', '#3a7a8a');
  fill(ctx, x + 14, y + 22, 6, 1, '#6fe7ff');
  fill(ctx, x + 14, y + 26, 14, 1, '#6fe7ff');
  fill(ctx, x + 14, y + 30, 10, 1, '#6fe7ff');
  fill(ctx, x + 14, y + 34, 8, 1, '#6fe7ff');
  // Build-clock right
  framedPoster(ctx, x + w - 46, y + 18, 34, 22, '#1a1018', '#3a2218');
  fill(ctx, x + w - 42, y + 22, 26, 4, '#8bd17c');
  fill(ctx, x + w - 42, y + 28, 18, 2, '#f2cc8f');
  fill(ctx, x + w - 42, y + 32, 22, 2, '#6fe7ff');
}

function wallQA(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, wallH: number) {
  pipeRun(ctx, x + 4, y + 6, w - 8, '#3a4a52');
  const gw = w - 36;
  const gh = wallH - 26;
  const gx = x + 18;
  const gy = y + 14;
  fill(ctx, gx - 2, gy - 2, gw + 4, gh + 4, '#0a1820');
  fill(ctx, gx, gy, gw, gh, '#1f3f4a');
  ctx.save();
  const grd = ctx.createLinearGradient(0, gy, 0, gy + gh);
  grd.addColorStop(0, 'rgba(170, 240, 255, 0.55)');
  grd.addColorStop(0.5, 'rgba(120, 200, 220, 0.30)');
  grd.addColorStop(1, 'rgba(60, 120, 140, 0.20)');
  ctx.fillStyle = grd;
  ctx.fillRect(gx, gy, gw, gh);
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#ffffff';
  for (let i = -gh; i < gw; i += 16) {
    ctx.beginPath();
    ctx.moveTo(gx + i, gy);
    ctx.lineTo(gx + i + gh, gy + gh);
    ctx.lineTo(gx + i + gh + 3, gy + gh);
    ctx.lineTo(gx + i + 3, gy);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  for (let i = 1; i < 3; i++) fill(ctx, gx + Math.floor(gw / 3) * i, gy, 1, gh, '#0a1820');
  fill(ctx, gx, gy + Math.floor(gh / 2), gw, 1, '#0a1820');
  // Failure beacon top-right
  fill(ctx, x + w - 14, y + 4, 6, 6, '#ff6b6b');
  px(ctx, x + w - 13, y + 5, '#ffaa6f', 4, 4);
}

function wallReview(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, wallH: number) {
  pipeRun(ctx, x + 4, y + 6, w - 8, '#3a2a3a');
  const pw = Math.floor((w - 24) * 0.55);
  const ph = wallH - 26;
  const pxs = x + 12;
  const pys = y + 14;
  fill(ctx, pxs - 2, pys - 2, pw + 4, ph + 4, '#1a1018');
  fill(ctx, pxs, pys, pw, ph, '#241a32');
  ctx.save();
  const grd = ctx.createLinearGradient(0, pys, 0, pys + ph);
  grd.addColorStop(0, 'rgba(214, 143, 214, 0.55)');
  grd.addColorStop(0.5, 'rgba(160, 100, 200, 0.32)');
  grd.addColorStop(1, 'rgba(80, 50, 130, 0.18)');
  ctx.fillStyle = grd;
  ctx.fillRect(pxs, pys, pw, ph);
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#ffffff';
  for (let i = -ph; i < pw; i += 18) {
    ctx.beginPath();
    ctx.moveTo(pxs + i, pys);
    ctx.lineTo(pxs + i + ph, pys + ph);
    ctx.lineTo(pxs + i + ph + 3, pys + ph);
    ctx.lineTo(pxs + i + 3, pys);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  fill(ctx, pxs + Math.floor(pw / 2), pys, 1, ph, '#1a1018');
  fill(ctx, pxs, pys + Math.floor(ph / 2), pw, 1, '#1a1018');

  // Speed gauge
  const gx = pxs + pw + 8;
  const gy = pys + 4;
  const gw = w - (gx - x) - 12;
  fill(ctx, gx - 2, gy - 2, gw + 4, ph - 4, '#0e0608');
  fill(ctx, gx, gy, gw, ph - 8, '#1a1018');
  const cxs = gx + gw / 2;
  const cy = gy + (ph - 8) / 2 + 2;
  const rad = Math.min(gw, ph - 8) / 2 - 6;
  ctx.save();
  ctx.fillStyle = '#ece6d0';
  ctx.beginPath();
  ctx.arc(cxs, cy, rad, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1a1018';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cxs, cy, rad, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 4;
  const arcs: Array<{ from: number; to: number; color: string }> = [
    { from: Math.PI, to: Math.PI + Math.PI / 3, color: '#ff6b6b' },
    { from: Math.PI + Math.PI / 3, to: Math.PI + (Math.PI * 2) / 3, color: '#f2cc8f' },
    { from: Math.PI + (Math.PI * 2) / 3, to: Math.PI * 2, color: '#8bd17c' },
  ];
  for (const a of arcs) {
    ctx.strokeStyle = a.color;
    ctx.beginPath();
    ctx.arc(cxs, cy, rad - 4, a.from, a.to);
    ctx.stroke();
  }
  ctx.strokeStyle = '#1a1018';
  ctx.lineWidth = 1;
  for (let t = 0; t <= 6; t++) {
    const ang = Math.PI + (Math.PI * t) / 6;
    const r1 = rad - 8;
    const r2 = rad - 2;
    ctx.beginPath();
    ctx.moveTo(cxs + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
    ctx.lineTo(cxs + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
    ctx.stroke();
  }
  const needle = Math.PI + Math.PI * 0.82;
  ctx.strokeStyle = '#d04a3a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cxs, cy);
  ctx.lineTo(cxs + Math.cos(needle) * (rad - 6), cy + Math.sin(needle) * (rad - 6));
  ctx.stroke();
  ctx.fillStyle = '#1a1018';
  ctx.beginPath();
  ctx.arc(cxs, cy, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function wallRetro(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, wallH: number) {
  pipeRun(ctx, x + 4, y + 6, w - 8);
  const bw = w - 24;
  const bh = wallH - 26;
  const bx = x + 12;
  const by = y + 14;
  fill(ctx, bx - 2, by - 2, bw + 4, bh + 4, '#1a0e08');
  fill(ctx, bx, by, bw, bh, '#5a4232');
  // Cork noise
  for (let py = by + 2; py < by + bh - 2; py += 2) {
    for (let pxs = bx + 2; pxs < bx + bw - 2; pxs += 3) {
      if (((pxs + py) >> 1) & 1) px(ctx, pxs, py, '#6f5238', 1, 1);
    }
  }
  const cols = ['+ WENT WELL', '- DIDNT', '! ACTIONS'];
  const cw = Math.floor(bw / 3);
  const colColors = [
    ['#8bd17c', '#c5e0a8', '#5a9a4a'],
    ['#ff6b6b', '#ffa088', '#d04a3a'],
    ['#f2cc8f', '#fbdfb3', '#d4a85a'],
  ];
  for (let c = 0; c < 3; c++) {
    const colX = bx + c * cw + 2;
    ctx.save();
    ctx.fillStyle = '#1a1018';
    ctx.font = '700 6px "Press Start 2P", monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(cols[c], colX + 1, by + 2);
    ctx.restore();
    let sy = by + 12;
    for (let i = 0; i < 5; i++) {
      const sw = cw - 6 - (i & 1) * 2;
      const sh = 6 + ((i + c) & 1);
      const sx = colX + (i & 1 ? 1 : 3);
      const cc = colColors[c][i % colColors[c].length];
      fill(ctx, sx, sy, sw, sh, cc);
      fill(ctx, sx, sy, sw, 1, 'rgba(255,255,255,0.5)');
      fill(ctx, sx, sy + sh - 1, sw, 1, 'rgba(0,0,0,0.25)');
      fill(ctx, sx + 2, sy + 2, sw - 5, 1, 'rgba(0,0,0,0.38)');
      fill(ctx, sx + 2, sy + 4, sw - 8, 1, 'rgba(0,0,0,0.38)');
      px(ctx, sx + (sw >> 1), sy - 1, '#d04a3a', 2, 2);
      sy += sh + 2;
    }
  }
}

function wallDone(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, _wallH: number) {
  pipeRun(ctx, x + 4, y + 6, w - 8, '#3a4a32');
  for (let s = 0; s < 3; s++) {
    const sy = y + 16 + s * 14;
    fill(ctx, x + 8, sy, w - 16, 2, '#a07a52');
    fill(ctx, x + 8, sy + 2, w - 16, 1, '#5a3a22');
    fill(ctx, x + 8, sy + 3, w - 16, 1, 'rgba(0,0,0,0.5)');
    for (let i = 0; i < 4; i++) {
      const bx = x + 12 + i * Math.floor((w - 24) / 4);
      const c = ['#f2cc8f', '#8bd17c', '#6fe7ff', '#d68fd6'][i % 4];
      fill(ctx, bx + 2, sy - 6, 8, 6, c);
      fill(ctx, bx + 3, sy - 7, 6, 2, 'rgba(255,255,255,0.4)');
      fill(ctx, bx + 3, sy, 2, 3, c);
      fill(ctx, bx + 7, sy, 2, 3, c);
    }
  }
}

function wallArchive(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  wallH: number,
) {
  pipeRun(ctx, x + 4, y + 6, w - 8);
  const bw = w - 28;
  const bh = wallH - 22;
  const bx = x + 12;
  const by = y + 12;
  bookshelf(ctx, bx, by, bw, bh);
  // Rolling ladder on the right
  const lx = bx + bw - 14;
  const ly = by + 2;
  const lh = bh + 6;
  fill(ctx, lx, ly, 2, lh, '#5a3a22');
  fill(ctx, lx + 8, ly, 2, lh, '#5a3a22');
  for (let r = 0; r < 6; r++) {
    fill(ctx, lx + 1, ly + 4 + r * Math.floor(lh / 6), 8, 2, '#3a2418');
  }
  fill(ctx, lx, ly - 2, 10, 2, '#4a2e1a');
  ctx.save();
  ctx.fillStyle = '#1a1018';
  ctx.beginPath();
  ctx.arc(lx + 5, ly + lh + 2, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5a3a22';
  ctx.beginPath();
  ctx.arc(lx + 5, ly + lh + 2, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function wallBacklog(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  wallH: number,
) {
  pipeRun(ctx, x + 4, y + 6, w - 8);
  const bw = w - 24;
  const bh = wallH - 26;
  const bx = x + 12;
  const by = y + 14;
  taskBoard(ctx, bx, by, bw, bh, {
    cols: ['NEW', 'TRIAGE', 'READY', 'BLOCKED'],
    perCol: [8, 5, 4, 2],
    stickyColors: ['#f2cc8f', '#fff7d0', '#fbdfb3', '#f59e0b', '#d4a85a'],
  });
}

function wallTriage(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, wallH: number) {
  pipeRun(ctx, x + 4, y + 6, w - 8);
  const pw = Math.min(w - 24, 120);
  const ph = wallH - 22;
  const pxs = x + 12;
  const pys = y + 14;
  framedPoster(ctx, pxs, pys, pw, ph, '#ece6d0', '#1a1018');
  const labels = ['P0', 'P1', 'P2', 'P3'];
  const colors = ['#ff6b6b', '#f2cc8f', '#6fe7ff', '#8bd17c'];
  for (let i = 0; i < 4; i++) {
    const ry = pys + 6 + i * Math.floor((ph - 12) / 4);
    fill(ctx, pxs + 4, ry, 12, 8, colors[i]);
    px(ctx, pxs + 4, ry, 'rgba(255,255,255,0.4)', 12, 1);
    ctx.save();
    ctx.fillStyle = '#1a1018';
    ctx.font = '700 6px "Press Start 2P", monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(labels[i], pxs + 20, ry + 4);
    ctx.fillRect(pxs + 38, ry + 3, pw - 44, 1);
    ctx.fillRect(pxs + 38, ry + 6, pw - 50, 1);
    ctx.restore();
  }
  // Tag rack right
  const rx = pxs + pw + 8;
  const rw = w - (rx - x) - 12;
  fill(ctx, rx, y + 14, rw, ph, '#3a2418');
  for (let i = 0; i < 5; i++) {
    const ix = rx + 4 + i * Math.floor((rw - 8) / 5);
    fill(ctx, ix, y + 18, 1, 8, '#5a3a22');
    fill(ctx, ix - 4, y + 26, 9, 8, ['#ff6b6b', '#f2cc8f', '#6fe7ff', '#8bd17c', '#d68fd6'][i]);
    fill(ctx, ix - 4, y + 26, 9, 1, 'rgba(255,255,255,0.4)');
  }
}

function wallInvestigation(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  wallH: number,
) {
  pipeRun(ctx, x + 4, y + 6, w - 8);
  const bw = Math.min(w - 24, 200);
  const bh = wallH - 22;
  const bx = x + Math.floor((w - bw) / 2);
  const by = y + 12;
  fill(ctx, bx - 2, by - 2, bw + 4, bh + 4, '#1a0e08');
  fill(ctx, bx, by, bw, bh, '#5a4232');
  for (let py = by + 2; py < by + bh - 2; py += 2) {
    for (let pxs = bx + 2; pxs < bx + bw - 2; pxs += 3) {
      if (((pxs + py) >> 1) & 1) px(ctx, pxs, py, '#6f5238', 1, 1);
    }
  }
  const photos = [
    { px: bx + 14, py: by + 10, w: 22, h: 14 },
    { px: bx + 60, py: by + 6, w: 22, h: 16 },
    { px: bx + 108, py: by + 14, w: 22, h: 14 },
    { px: bx + 156, py: by + 8, w: 22, h: 14 },
    { px: bx + 30, py: by + 36, w: 22, h: 14 },
    { px: bx + 86, py: by + 40, w: 22, h: 14 },
    { px: bx + 140, py: by + 38, w: 22, h: 16 },
  ];
  ctx.save();
  ctx.strokeStyle = '#d04a3a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < photos.length - 1; i++) {
    ctx.moveTo(photos[i].px + photos[i].w / 2, photos[i].py + photos[i].h / 2);
    ctx.lineTo(photos[i + 1].px + photos[i + 1].w / 2, photos[i + 1].py + photos[i + 1].h / 2);
  }
  ctx.stroke();
  ctx.restore();
  for (const p of photos) {
    fill(ctx, p.px - 1, p.py - 1, p.w + 2, p.h + 2, '#1a1018');
    fill(ctx, p.px, p.py, p.w, p.h, '#ece6d0');
    fill(ctx, p.px + 1, p.py + 1, p.w - 2, 1, '#5a4a32');
    fill(ctx, p.px + 2, p.py + 4, p.w - 4, p.h - 6, '#3a2a18');
    fill(ctx, p.px + Math.floor(p.w / 2) - 3, p.py + 5, 6, 5, '#8a6a4a');
    px(ctx, p.px + Math.floor(p.w / 2) - 3, p.py + p.h - 4, '#5a3a22', 6, 2);
    px(ctx, p.px + 2, p.py - 1, '#d04a3a', 2, 2);
  }
}

function wallLibrary(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  wallH: number,
) {
  pipeRun(ctx, x + 4, y + 6, w - 8, '#3a4a3a');
  const pw = w - 28;
  const ph = wallH - 22;
  const pxs = x + 14;
  const pys = y + 12;
  fill(ctx, pxs - 2, pys - 2, pw + 4, ph + 4, '#08181a');
  fill(ctx, pxs, pys, pw, ph, '#143028');
  ctx.save();
  const grd = ctx.createLinearGradient(0, pys, 0, pys + ph);
  grd.addColorStop(0, 'rgba(80, 200, 170, 0.30)');
  grd.addColorStop(0.5, 'rgba(40, 140, 120, 0.15)');
  grd.addColorStop(1, 'rgba(10, 60, 50, 0.30)');
  ctx.fillStyle = grd;
  ctx.fillRect(pxs, pys, pw, ph);
  ctx.restore();
  const cxs = pxs + pw / 2;
  const cy = pys + ph / 2;
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    const r = Math.min(pw, ph) / 2 - 8;
    const rx = cxs + Math.cos(ang) * r;
    const ry = cy + Math.sin(ang) * r;
    fill(ctx, rx - 2, ry - 2, 4, 4, '#6fe7d4');
    px(ctx, rx, ry, 'rgba(255,255,255,0.5)', 1, 1);
  }
  fill(ctx, cxs - 8, cy - 8, 16, 2, '#6fe7d4');
  fill(ctx, cxs - 8, cy + 6, 16, 2, '#6fe7d4');
  fill(ctx, cxs - 8, cy - 8, 2, 16, '#6fe7d4');
  fill(ctx, cxs + 6, cy - 8, 2, 16, '#6fe7d4');
  px(ctx, cxs - 2, cy - 2, '#fff7d0', 4, 4);
}

function wallCoffee(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, wallH: number) {
  pipeRun(ctx, x + 4, y + 6, w - 8);
  const split = x + Math.floor(w * 0.62);
  // Left: chalkboard menu
  framedPoster(ctx, x + 12, y + 12, split - x - 20, wallH - 22, '#1a1018', '#3a2418');
  fill(ctx, x + 16, y + 16, split - x - 28, wallH - 30, '#1a261c');
  ctx.save();
  ctx.fillStyle = '#f2cc8f';
  ctx.font = '700 8px "Press Start 2P", monospace';
  ctx.textBaseline = 'top';
  ctx.fillText('MENU', x + 22, y + 22);
  ctx.fillStyle = '#ece6d0';
  ctx.font = '600 7px monospace';
  const items: Array<[string, string]> = [
    ['ESPRESSO', '2g'],
    ['LATTE', '4g'],
    ['DRIP', '3g'],
    ['COLD BREW', '5g'],
  ];
  for (let i = 0; i < items.length; i++) {
    ctx.fillText(items[i][0], x + 22, y + 32 + i * 8);
    ctx.fillText(items[i][1], split - x - 20, y + 32 + i * 8);
  }
  ctx.restore();
  // Right: stairwell opening (perspective steps going up)
  const sx = split + 4;
  const sw = x + w - sx - 12;
  const sy = y + 12;
  const sh = wallH - 18;
  fill(ctx, sx - 2, sy - 2, sw + 4, sh + 4, '#0a0608');
  fill(ctx, sx, sy, sw, sh, '#1a0e0a');
  for (let i = 0; i < 6; i++) {
    const stepY = sy + sh - 4 - i * Math.floor((sh - 8) / 6);
    const stepX1 = sx + Math.floor((i * (sw - 12)) / 6);
    const stepW = sw - 4 - stepX1 + sx;
    if (stepW < 4) break;
    fill(ctx, stepX1, stepY, stepW, 4, '#3a2418');
    fill(ctx, stepX1, stepY, stepW, 1, '#5a3a22');
    fill(ctx, stepX1, stepY + 3, stepW, 1, '#0a0608');
  }
  fill(ctx, sx + 2, sy + 4, 2, sh - 8, '#5a3a22');
  for (let p = 0; p < 4; p++) {
    fill(ctx, sx + 2, sy + 8 + p * Math.floor((sh - 12) / 4), 2, 1, '#3a2418');
  }
  // Stairwell light pool at the top step
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(sx + sw - 6, sy + 4, 0, sx + sw - 6, sy + 4, 16);
  g.addColorStop(0, 'rgba(255, 214, 140, 0.55)');
  g.addColorStop(1, 'rgba(255, 214, 140, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(sx + sw - 6, sy + 4, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
