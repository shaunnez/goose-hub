// Procedural pixel-art texture generator for the Office view.
//
// Why procedural rather than PNGs in /public? Two reasons:
//   1. The repo ships with zero binary assets — runtime-generated textures
//      mean the Office tab works in fresh checkouts without an asset-build step.
//   2. PixelLab generation runs offline (`pnpm gen:office-assets`) and writes
//      to `/public/office/`; the loader (see `loadOfficeAssets`) prefers PNGs
//      from disk when present and falls back to procedural otherwise.
//
// The textures are intentionally chunky 16×16 / 24×24 — readable at the small
// camera zoom used in the Office view.

import type Phaser from 'phaser';
import type { IndicatorKind } from '../lib/state-indicators';

// §4.0 Board 06 canonical palette (8 base + 3 derived shades + 2 derived blends = 13)
export const PALETTE = {
  wall: 0x2b2d42,
  floor: 0x3a3d5c,
  desk: 0x6b4f3b,
  cyan: 0x6fe7ff,
  amber: 0xf2cc8f,
  fail: 0xff6b6b,
  success: 0x8bd17c,
  purple: 0xd68fd6,
  floorAlt: 0x42466a,
  wallTop: 0x3b3d55,
  deskTop: 0x85694f,
  qaWall: 0x3f6b80,
  reviewWall: 0x473a55,
} as const;

// §5.3 Per-role runtime tint applied via setTint() to spriteBase
export const ROLE_TINTS: Record<string, number> = {
  triager: 0xa78bfa,
  griller: 0xf2cc8f,
  'prd-writer': 0xf59e0b,
  decomposer: 0x8bd17c,
  researcher: 0x6fe7ff,
  investigator: 0x7dd3fc,
  developer: 0x34d399,
  'dev-reviewer': 0xa7f3d0,
  qa: 0xff6b6b,
  reviewer: 0xd68fd6,
  retrospector: 0xc084fc,
  auditor: 0xfbbf24,
};

// §5.4 Named bindings for choreography intent colours (all reuse canonical hues)
export const CINEMATIC_TINTS = {
  pulseFail: 0xff6b6b,
  pulseSuccess: 0x8bd17c,
  glowRingDefault: 0x8bd17c,
  glowRingFail: 0xff6b6b,
  glowRingWave: 0x6fe7ff,
  particleBurstDefault: 0x8bd17c,
  verdictScrollFail: 0xff6b6b,
  scoutEnvelopeSeal: 0x6fe7ff,
} as const;

// §5.6 Brass + warm-light family — used by the Phase 6 stone-wall, pendant
// lamp, brass-frame sign, and ornate door visuals. Exposed so consumers
// (RoomLayer) can import these instead of inlining hex literals.
export const BRASS_TINTS = {
  brass: 0x9c6e2a,
  brassLight: 0xd29a3a,
  brassDark: 0x5e3f15,
  brassEdge: 0xc59a4c,
  brassPlateBg: 0x1a140a,
  bulbCore: 0xfde58a,
  bulbHot: 0xfff4c2,
  wood: 0x4a3622,
  woodLight: 0x6b4f30,
  woodDark: 0x2a1d12,
  stoneLight: 0xb0a89a,
  stoneMid: 0x8a8378,
  stoneShade: 0x5a544c,
  mortar: 0x231f1a,
  chain: 0x3a3530,
} as const;

// §5.5 Named bindings for HUD elements (5 opaque CSS + 1 Phaser number + 2 alpha CSS = 8)
export const HUD_TINTS = {
  hudBadgeText: '#F2CC8F',
  hudCounterText: '#D68FD6',
  hudCameraStateText: '#6FE7FF',
  hudSpotlight: 0x6fe7ff as number,
  hudFeedLineText: '#F2CC8F',
  hudPanelBgDark: '#2B2D4299',
  hudPanelBgDarker: '#2B2D42EE',
  hudShadowOverlay: '#00000066',
} as const;

export const TEXTURE_KEYS = {
  floorTile: 'office:floor-tile',
  floorTileAlt: 'office:floor-tile-alt',
  floorRoomWarm: 'office:floor-room-warm',
  corridorWarm: 'office:corridor-warm',
  wallTile: 'office:wall-tile',
  stoneWall: 'office:stone-wall',
  darkWall: 'office:dark-wall',
  ceilingPipes: 'office:ceiling-pipes',
  pendantLamp: 'office:pendant-lamp',
  doorFrame: 'office:door-frame',
  desk: 'office:desk',
  stairs: 'office:stairs',
  spriteBase: 'office:sprite',
  indicatorSpeech: 'office:indicator-speech',
  indicatorThought: 'office:indicator-thought',
  indicatorQuestion: 'office:indicator-question',
  indicatorCoffee: 'office:indicator-coffee',
  indicatorBang: 'office:indicator-bang',
  indicatorCheck: 'office:indicator-check',
  ticket: 'office:ticket',
  queueStackMany: 'office:queue-stack-many',
  ticketGlow: 'office:ticket-glow',
  ticketScroll: 'office:ticket-scroll',
  ticketEnvelope: 'office:ticket-envelope',
  wallFrostedBlue: 'office:wall-frosted-blue',
  wallFrostedGrey: 'office:wall-frosted-grey',
  scoutDesk: 'office:scout-desk',
} as const;

interface TextureDisplaySize {
  width: number;
  height: number;
}

const OFFICE_TEXTURE_DISPLAY_SIZES: Record<string, TextureDisplaySize> = {
  [TEXTURE_KEYS.floorTile]: { width: 16, height: 16 },
  [TEXTURE_KEYS.floorTileAlt]: { width: 16, height: 16 },
  [TEXTURE_KEYS.floorRoomWarm]: { width: 16, height: 16 },
  [TEXTURE_KEYS.corridorWarm]: { width: 64, height: 64 },
  [TEXTURE_KEYS.wallTile]: { width: 16, height: 16 },
  [TEXTURE_KEYS.stoneWall]: { width: 16, height: 16 },
  [TEXTURE_KEYS.darkWall]: { width: 16, height: 16 },
  [TEXTURE_KEYS.ceilingPipes]: { width: 16, height: 16 },
  [TEXTURE_KEYS.pendantLamp]: { width: 18, height: 28 },
  [TEXTURE_KEYS.doorFrame]: { width: 36, height: 32 },
  [TEXTURE_KEYS.desk]: { width: 48, height: 36 },
  // Per-room desk PNGs — uniform 48×36 (was 32×24) so desks read at the
  // fit-width camera zoom without disappearing into the floor.
  'office:desk_dev_dual': { width: 48, height: 36 },
  'office:desk_dev_single': { width: 48, height: 36 },
  'office:qa_station': { width: 48, height: 36 },
  'office:review_table': { width: 64, height: 40 },
  'office:done_shelf': { width: 48, height: 36 },
  'office:archive_shelf': { width: 48, height: 36 },
  'office:desk_triage': { width: 48, height: 36 },
  'office:desk_investigation': { width: 48, height: 36 },
  'office:library_terminal': { width: 48, height: 36 },
  'office:coffee_machine': { width: 48, height: 40 },
  // Ticket variant PNGs — same display size as the procedural ticket so
  // ticket positions remain pixel-equivalent regardless of variant.
  'office:ticket_normal': { width: 14, height: 10 },
  'office:ticket_hero': { width: 14, height: 10 },
  'office:ticket_failed': { width: 14, height: 10 },
  'office:ticket_done': { width: 14, height: 10 },
  'office:ticket_retry': { width: 14, height: 10 },
  // Ambient — pendant lamps
  'office:lamp_glow_warm': { width: 24, height: 24 },
  'office:lamp_glow_soft': { width: 24, height: 24 },
  'office:glow_soft': { width: 48, height: 48 },
  // Back-wall props — mounted on the top 2 tile rows of each room.
  // Display sizes picked to read at fit-width camera zoom while staying
  // within the 32-px-tall back-wall band.
  'office:intake_board': { width: 36, height: 28 },
  'office:investigation_map_board': { width: 56, height: 28 },
  'office:bookshelf_large': { width: 64, height: 28 },
  'office:bookshelf_small': { width: 28, height: 28 },
  'office:qa_warning_light': { width: 14, height: 18 },
  'office:archive_drawer': { width: 36, height: 28 },
  'office:merge_trophy_small': { width: 18, height: 22 },
  'office:paperwork_stack': { width: 22, height: 20 },
  'office:goose_coffee_sign': { width: 56, height: 28 },
  'office:quality_score_gauge': { width: 32, height: 28 },
  'office:dev_monitor_dual': { width: 36, height: 24 },
  // Wall textures
  'office:wall_dark_01': { width: 16, height: 16 },
  'office:wall_dark_02': { width: 16, height: 16 },
  'office:frosted_glass_wall': { width: 16, height: 16 },
  'office:sealed_wall_green': { width: 16, height: 16 },
  'office:sealed_wall_blue': { width: 16, height: 16 },
  [TEXTURE_KEYS.stairs]: { width: 32, height: 32 },
  [TEXTURE_KEYS.indicatorSpeech]: { width: 14, height: 16 },
  [TEXTURE_KEYS.indicatorThought]: { width: 14, height: 16 },
  [TEXTURE_KEYS.indicatorQuestion]: { width: 14, height: 16 },
  [TEXTURE_KEYS.indicatorCoffee]: { width: 14, height: 14 },
  [TEXTURE_KEYS.indicatorBang]: { width: 14, height: 14 },
  [TEXTURE_KEYS.indicatorCheck]: { width: 14, height: 14 },
  [TEXTURE_KEYS.spriteBase]: { width: 12, height: 16 },
  // Goose sprite PNGs at 40×40 — slight upscale from 32 native so they
  // remain readable next to the new larger desks under fit-width camera.
  'office:goose_idle': { width: 40, height: 40 },
  'office:goose_triage': { width: 40, height: 40 },
  'office:goose_investigator': { width: 40, height: 40 },
  'office:goose_dev': { width: 40, height: 40 },
  'office:goose_qa': { width: 40, height: 40 },
  'office:goose_reviewer': { width: 40, height: 40 },
  'office:goose_scout': { width: 40, height: 40 },
  'office:goose_ops': { width: 40, height: 40 },
  [TEXTURE_KEYS.ticket]: { width: 14, height: 10 },
  [TEXTURE_KEYS.ticketScroll]: { width: 10, height: 16 },
  [TEXTURE_KEYS.ticketEnvelope]: { width: 14, height: 10 },
  [TEXTURE_KEYS.queueStackMany]: { width: 20, height: 16 },
  [TEXTURE_KEYS.ticketGlow]: { width: 20, height: 16 },
};

export function applyOfficeTextureDisplaySize(
  image: Phaser.GameObjects.Image,
  textureKey: string,
): Phaser.GameObjects.Image {
  const size = OFFICE_TEXTURE_DISPLAY_SIZES[textureKey];
  if (size != null) {
    image.setDisplaySize(size.width, size.height);
  }
  return image;
}

export function indicatorTextureKey(kind: IndicatorKind): string {
  switch (kind) {
    case 'speech':
      return TEXTURE_KEYS.indicatorSpeech;
    case 'thought':
      return TEXTURE_KEYS.indicatorThought;
    case 'question':
      return TEXTURE_KEYS.indicatorQuestion;
    case 'coffee':
      return TEXTURE_KEYS.indicatorCoffee;
    case 'bang':
      return TEXTURE_KEYS.indicatorBang;
    case 'check':
      return TEXTURE_KEYS.indicatorCheck;
  }
}

/** Returns the ticket PNG texture key for a given placement, or null if no
 * suitable PNG is loaded (caller falls back to the procedural ticket). */
export function ticketTextureKeyFor(
  position: string,
  priority: string,
  scene?: Phaser.Scene,
): string | null {
  const candidates: string[] = [];
  if (position === 'shelf') candidates.push('office:ticket_done');
  if (priority === 'critical' || priority === 'high') candidates.push('office:ticket_hero');
  candidates.push('office:ticket_normal');
  for (const key of candidates) {
    if (scene?.textures.exists(key)) return key;
  }
  return null;
}

// Per-room desk PNG mapping. drawDesks uses this to pick a thematic
// PNG (e.g. dev → dual builder desk, qa → QA station, library → terminal)
// instead of the generic procedural desk. All entries display at 32x24
// regardless of source PNG dimensions so the desk row stays uniform.
export const ROOM_DESK_KEYS: Record<string, string> = {
  dev: 'office:desk_dev_dual',
  qa: 'office:qa_station',
  review: 'office:review_table',
  retro: 'office:desk_dev_single', // no dedicated retro asset
  done: 'office:done_shelf',
  archive: 'office:archive_shelf',
  backlog: 'office:desk_triage', // backlog reuses triage desk
  triage: 'office:desk_triage',
  investigation: 'office:desk_investigation',
  library: 'office:library_terminal',
  coffee: 'office:coffee_machine',
};

export function roomDeskTextureKey(roomId: string, scene?: Phaser.Scene): string {
  const candidate = ROOM_DESK_KEYS[roomId];
  if (candidate != null && scene?.textures.exists(candidate)) return candidate;
  return TEXTURE_KEYS.desk;
}

// Per-role goose PNG mapping. Roles without a matching PNG fall back to
// goose_idle (white goose). Callers should SKIP setTint() when the returned
// key starts with 'office:goose_' — the PNGs are pre-coloured.
const ROLE_GOOSE_KEYS: Record<string, string> = {
  triager: 'office:goose_triage',
  griller: 'office:goose_idle',
  'prd-writer': 'office:goose_idle',
  decomposer: 'office:goose_idle',
  researcher: 'office:goose_scout',
  investigator: 'office:goose_investigator',
  developer: 'office:goose_dev',
  'dev-reviewer': 'office:goose_dev',
  qa: 'office:goose_qa',
  reviewer: 'office:goose_reviewer',
  retrospector: 'office:goose_idle',
  auditor: 'office:goose_ops',
};

/**
 * Returns the sprite texture key for a given role. Prefers a goose PNG when
 * one is loaded; falls back to the procedural spriteBase. Role tint is only
 * applied when the returned key is the procedural sprite — goose PNGs are
 * pre-coloured.
 */
export function spriteTextureKeyForRole(role: string, scene?: Phaser.Scene): string {
  const candidate = ROLE_GOOSE_KEYS[role] ?? 'office:goose_idle';
  if (scene?.textures.exists(candidate)) return candidate;
  return TEXTURE_KEYS.spriteBase;
}

/** True when the texture key refers to a pre-coloured goose PNG (skip tint). */
export function isGooseTextureKey(key: string): boolean {
  return key.startsWith('office:goose_');
}

/**
 * Generates all procedural textures into the scene's texture manager. Skips
 * keys that already loaded from /public/office/<key>.png so the same scene
 * supports either source.
 */
export function ensureOfficeTextures(scene: Phaser.Scene): void {
  generateFloorTile(scene, TEXTURE_KEYS.floorTile, PALETTE.floor);
  generateFloorTile(scene, TEXTURE_KEYS.floorTileAlt, PALETTE.floorAlt);
  generateWarmRoomFloor(scene);
  generateCorridorTile(scene);
  generateWallTile(scene);
  generateStoneWallTile(scene);
  generateDarkWallTile(scene);
  generateCeilingPipesTile(scene);
  generatePendantLamp(scene);
  generateDoorFrame(scene);
  generateDesk(scene);
  generateStairs(scene);
  generateSprite(scene);
  generateTicket(scene);
  generateTicketScroll(scene);
  generateTicketEnvelope(scene);
  generateQueueStackMany(scene);
  generateTicketGlow(scene);
  generateSpeechBubble(scene);
  generateThoughtBubble(scene);
  generateQuestionBubble(scene);
  generateCoffeeIcon(scene);
  generateBangIcon(scene);
  generateCheckIcon(scene);
  generateWallFrostedBlue(scene);
  generateWallFrostedGrey(scene);
  generateScoutDesk(scene);
}

function generateFloorTile(scene: Phaser.Scene, key: string, color: number): void {
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  g.fillStyle(color, 1);
  g.fillRect(0, 0, 16, 16);
  g.fillStyle(color === PALETTE.floor ? PALETTE.floorAlt : PALETTE.floor, 0.15);
  g.fillRect(0, 0, 1, 1);
  g.fillRect(15, 15, 1, 1);
  g.generateTexture(key, 16, 16);
  g.destroy();
}

/** 64x64 corridor tile — dark navy floor with a yellow dashed centerline
 * (one dash visible per tile, breaks on the seam to read as a long dash
 * pattern when tiled). Matches the canonical target image's corridor. */
function generateCorridorTile(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.corridorWarm;
  if (scene.textures.exists(key)) return;
  const baseDark = 0x1f2233;
  const baseLight = 0x252a3e;
  const dashYellow = 0xf2cc8f;
  const g = scene.add.graphics({ x: 0, y: 0 });
  // Base dark navy with subtle horizontal noise band
  g.fillStyle(baseDark, 1);
  g.fillRect(0, 0, 64, 64);
  g.fillStyle(baseLight, 1);
  g.fillRect(0, 28, 64, 8);
  // Yellow dashed centerline: 32px dash centered, 32px gap to next tile
  g.fillStyle(dashYellow, 1);
  g.fillRect(16, 30, 32, 4);
  g.generateTexture(key, 64, 64);
  g.destroy();
}

/** 16x16 dark-brick room floor — simple repeating horizontal brick pattern
 * with running-bond offset. Replaces the warm-tan parquet (which fought
 * the brick walls). Charcoal base reads as a dim ops bunker. */
function generateWarmRoomFloor(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.floorRoomWarm;
  if (scene.textures.exists(key)) return;
  const base = 0x1c1828; // dark slate
  const brickFace = 0x231e30; // slight lift on brick face
  const brickHi = 0x2a2438; // top-edge highlight
  const mortar = 0x0e0c14; // near-black mortar
  const g = scene.add.graphics({ x: 0, y: 0 });
  // Mortar background
  g.fillStyle(mortar, 1);
  g.fillRect(0, 0, 16, 16);
  // Row 0 (top half): two 8-wide bricks flush
  g.fillStyle(brickFace, 1);
  g.fillRect(0, 1, 7, 6);
  g.fillRect(8, 1, 7, 6);
  g.fillStyle(brickHi, 1);
  g.fillRect(0, 1, 7, 1);
  g.fillRect(8, 1, 7, 1);
  // Row 1 (bottom half): three bricks offset by 4 so the seams stagger
  g.fillStyle(brickFace, 1);
  g.fillRect(0, 9, 3, 6);
  g.fillRect(4, 9, 7, 6);
  g.fillRect(12, 9, 4, 6);
  g.fillStyle(brickHi, 1);
  g.fillRect(0, 9, 3, 1);
  g.fillRect(4, 9, 7, 1);
  g.fillRect(12, 9, 4, 1);
  // Anti-flat hint of base where mortar meets bricks
  g.fillStyle(base, 0.3);
  g.fillRect(0, 7, 16, 1);
  g.fillRect(0, 15, 16, 1);
  g.generateTexture(key, 16, 16);
  g.destroy();
}

function generateWallTile(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.wallTile;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  g.fillStyle(PALETTE.wall, 1);
  g.fillRect(0, 0, 16, 16);
  g.fillStyle(PALETTE.wall, 0.5);
  g.fillRect(0, 14, 16, 2);
  g.generateTexture(key, 16, 16);
  g.destroy();
}

/** 16x16 stone-block wall tile — light grey blocks with brass-amber edge
 * highlight on the top and a dark mortar line. Replaces the cool dark
 * brick that read as "blue and odd" against the dim floor. */
function generateStoneWallTile(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.stoneWall;
  if (scene.textures.exists(key)) return;
  const { stoneLight, stoneMid, stoneShade, mortar, brassEdge } = BRASS_TINTS;
  const g = scene.add.graphics({ x: 0, y: 0 });
  // Mortar bg
  g.fillStyle(mortar, 1);
  g.fillRect(0, 0, 16, 16);
  // Two side-by-side blocks per row, two rows. Inset 1px on each side
  // for the mortar gap.
  const drawBlock = (x: number, y: number, w: number, h: number) => {
    g.fillStyle(stoneMid, 1);
    g.fillRect(x, y, w, h);
    g.fillStyle(stoneLight, 1);
    g.fillRect(x, y, w, Math.max(1, Math.floor(h * 0.55)));
    g.fillStyle(stoneShade, 1);
    g.fillRect(x, y + h - 1, w, 1);
    g.fillStyle(brassEdge, 0.8);
    g.fillRect(x, y, w, 1);
  };
  // Row 0: two flush blocks
  drawBlock(1, 1, 6, 6);
  drawBlock(9, 1, 6, 6);
  // Row 1: offset (running bond) — half block at each end + one center
  drawBlock(1, 9, 2, 6);
  drawBlock(5, 9, 6, 6);
  drawBlock(13, 9, 2, 6);
  g.generateTexture(key, 16, 16);
  g.destroy();
}

/** Smooth dark stone wall — used as the back-wall fill behind the
 * single brick "lintel" row. No visible per-block seams: just a uniform
 * dark stone surface for mounting signs/lamps/props against. */
function generateDarkWallTile(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.darkWall;
  if (scene.textures.exists(key)) return;
  const base = 0x1f1d24;
  const grain = 0x26242c;
  const shadow = 0x141218;
  const g = scene.add.graphics({ x: 0, y: 0 });
  g.fillStyle(base, 1);
  g.fillRect(0, 0, 16, 16);
  // Subtle vertical grain — single 1-px stripes at irregular intervals
  g.fillStyle(grain, 1);
  g.fillRect(3, 0, 1, 16);
  g.fillRect(11, 0, 1, 16);
  // Faint horizontal grout (very subtle so it doesn't read as bricks)
  g.fillStyle(shadow, 1);
  g.fillRect(0, 7, 16, 1);
  g.fillRect(0, 15, 16, 1);
  g.generateTexture(key, 16, 16);
  g.destroy();
}

/** 16x16 ceiling-pipe tile — the architectural detail that runs along
 * the very top of each room's back wall (under the brick lintel).
 * Brass horizontal pipe + small junction box every other tile. */
function generateCeilingPipesTile(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.ceilingPipes;
  if (scene.textures.exists(key)) return;
  const base = 0x1a1820;
  const { brass, brassDark, brassLight } = BRASS_TINTS;
  const g = scene.add.graphics({ x: 0, y: 0 });
  // Dark base
  g.fillStyle(base, 1);
  g.fillRect(0, 0, 16, 16);
  // Horizontal pipe — 3 px tall band running the full width
  g.fillStyle(brassDark, 1);
  g.fillRect(0, 6, 16, 4);
  g.fillStyle(brass, 1);
  g.fillRect(0, 7, 16, 2);
  g.fillStyle(brassLight, 1);
  g.fillRect(0, 7, 16, 1);
  // Small drop / drip valve every tile
  g.fillStyle(brassDark, 1);
  g.fillRect(7, 10, 2, 2);
  g.fillStyle(brass, 1);
  g.fillRect(7, 10, 2, 1);
  g.generateTexture(key, 16, 16);
  g.destroy();
}

/** Pendant lamp sprite — chain from ceiling, brass hood, glowing bulb at
 * bottom. 18x28 so it reads at fit-width zoom (the old PNG was a tiny
 * indistinct blob). Origin (0.5, 0) — anchor at top of chain. */
function generatePendantLamp(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.pendantLamp;
  if (scene.textures.exists(key)) return;
  const { chain, brass, brassLight, brassDark, bulbCore, bulbHot } = BRASS_TINTS;
  const g = scene.add.graphics({ x: 0, y: 0 });
  // Chain (8 px tall, 2 px wide centred)
  g.fillStyle(chain, 1);
  g.fillRect(8, 0, 2, 8);
  // Brass cap atop the hood
  g.fillStyle(brassDark, 1);
  g.fillRect(7, 8, 4, 2);
  g.fillStyle(brass, 1);
  g.fillRect(6, 10, 6, 2);
  g.fillStyle(brassLight, 1);
  g.fillRect(7, 10, 4, 1);
  // Hood (trapezoid-ish, 5 rows tapering wider)
  g.fillStyle(brassDark, 1);
  g.fillRect(5, 12, 8, 2);
  g.fillStyle(brass, 1);
  g.fillRect(4, 14, 10, 2);
  g.fillStyle(brassDark, 1);
  g.fillRect(3, 16, 12, 2);
  g.fillStyle(brass, 1);
  g.fillRect(3, 18, 12, 2);
  // Hood lower lip
  g.fillStyle(brassLight, 1);
  g.fillRect(3, 19, 12, 1);
  // Glowing bulb (rounded rectangle at bottom)
  g.fillStyle(bulbCore, 1);
  g.fillRect(5, 21, 8, 5);
  g.fillStyle(bulbHot, 1);
  g.fillRect(6, 22, 6, 3);
  // Tiny bottom highlight
  g.fillStyle(bulbCore, 0.7);
  g.fillRect(7, 26, 4, 1);
  g.generateTexture(key, 18, 28);
  g.destroy();
}

/** Door frame sprite — ornate brass-trimmed door for top-band rooms,
 * sits in the door gap on the south wall. 36x32. Origin (0.5, 1) — feet
 * planted on the corridor edge. */
function generateDoorFrame(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.doorFrame;
  if (scene.textures.exists(key)) return;
  const { wood, woodLight, woodDark, brass, brassLight } = BRASS_TINTS;
  const handle = BRASS_TINTS.bulbCore;
  const g = scene.add.graphics({ x: 0, y: 0 });
  // Outer brass frame
  g.fillStyle(brass, 1);
  g.fillRect(0, 0, 36, 32);
  // Inner door cavity (inset by 3 px)
  g.fillStyle(woodDark, 1);
  g.fillRect(3, 3, 30, 29);
  // Door panel
  g.fillStyle(wood, 1);
  g.fillRect(5, 5, 26, 27);
  // Top decorative panel
  g.fillStyle(woodLight, 1);
  g.fillRect(7, 7, 22, 5);
  g.fillStyle(woodDark, 1);
  g.fillRect(7, 7, 22, 1);
  // Centre raised panel
  g.fillStyle(woodLight, 1);
  g.fillRect(9, 14, 18, 14);
  g.fillStyle(woodDark, 1);
  g.fillRect(9, 14, 18, 1);
  g.fillRect(9, 14, 1, 14);
  // Door handle
  g.fillStyle(brassLight, 1);
  g.fillRect(24, 21, 3, 2);
  g.fillStyle(handle, 1);
  g.fillRect(25, 21, 1, 1);
  // Brass frame highlights (top + left)
  g.fillStyle(brassLight, 1);
  g.fillRect(0, 0, 36, 1);
  g.fillRect(0, 0, 1, 32);
  g.generateTexture(key, 36, 32);
  g.destroy();
}

function generateDesk(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.desk;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  g.fillStyle(PALETTE.desk, 1);
  g.fillRect(0, 14, 32, 10);
  g.fillStyle(PALETTE.deskTop, 1);
  g.fillRect(0, 12, 32, 4);
  g.fillStyle(PALETTE.wall, 1);
  g.fillRect(8, 2, 16, 11);
  g.fillStyle(PALETTE.cyan, 1);
  g.fillRect(10, 4, 12, 7);
  g.fillStyle(PALETTE.desk, 1);
  g.fillRect(14, 13, 4, 2);
  g.generateTexture(key, 32, 24);
  g.destroy();
}

function generateStairs(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.stairs;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  g.fillStyle(PALETTE.deskTop, 1);
  g.fillRect(0, 0, 32, 32);
  g.lineStyle(1, PALETTE.desk, 1);
  for (let i = 4; i < 32; i += 4) {
    g.beginPath();
    g.moveTo(0, i);
    g.lineTo(32, i);
    g.strokePath();
  }
  g.generateTexture(key, 32, 32);
  g.destroy();
}

function generateSprite(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.spriteBase;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  // Body — role tint applied at runtime via body.setTint(ROLE_TINTS[role])
  g.fillStyle(PALETTE.wallTop, 1);
  g.fillRect(2, 9, 8, 7);
  // Head
  g.fillStyle(PALETTE.deskTop, 1);
  g.fillRect(3, 2, 6, 7);
  // Hair
  g.fillStyle(PALETTE.wall, 1);
  g.fillRect(3, 1, 6, 2);
  // Eyes
  g.fillStyle(PALETTE.wall, 1);
  g.fillRect(4, 5, 1, 1);
  g.fillRect(7, 5, 1, 1);
  // Arms
  g.fillStyle(PALETTE.wallTop, 1);
  g.fillRect(1, 9, 1, 5);
  g.fillRect(10, 9, 1, 5);
  g.generateTexture(key, 12, 16);
  g.destroy();
}

function makeBubbleBg(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(PALETTE.amber, 1);
  g.fillRoundedRect(0, 0, 14, 12, 3);
  g.lineStyle(1, PALETTE.wall, 1);
  g.strokeRoundedRect(0, 0, 14, 12, 3);
  g.fillStyle(PALETTE.amber, 1);
  g.fillTriangle(4, 12, 8, 12, 5, 15);
  g.lineStyle(1, PALETTE.wall, 1);
  g.beginPath();
  g.moveTo(4, 12);
  g.lineTo(5, 15);
  g.moveTo(8, 12);
  g.lineTo(5, 15);
  g.strokePath();
}

function generateSpeechBubble(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.indicatorSpeech;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  makeBubbleBg(g);
  g.fillStyle(PALETTE.wall, 1);
  g.fillRect(4, 5, 1, 1);
  g.fillRect(7, 5, 1, 1);
  g.fillRect(10, 5, 1, 1);
  g.generateTexture(key, 14, 16);
  g.destroy();
}

function generateThoughtBubble(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.indicatorThought;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  g.fillStyle(PALETTE.amber, 1);
  g.fillCircle(4, 5, 4);
  g.fillCircle(9, 4, 4);
  g.fillCircle(7, 8, 4);
  g.lineStyle(1, PALETTE.wall, 1);
  g.strokeCircle(4, 5, 4);
  g.strokeCircle(9, 4, 4);
  g.strokeCircle(7, 8, 4);
  g.fillStyle(PALETTE.amber, 1);
  g.fillCircle(5, 13, 1.5);
  g.lineStyle(1, PALETTE.wall, 1);
  g.strokeCircle(5, 13, 1.5);
  g.generateTexture(key, 14, 16);
  g.destroy();
}

function generateQuestionBubble(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.indicatorQuestion;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  makeBubbleBg(g);
  g.fillStyle(PALETTE.wall, 1);
  g.fillRect(5, 3, 4, 1);
  g.fillRect(8, 4, 1, 2);
  g.fillRect(6, 6, 2, 1);
  g.fillRect(6, 7, 1, 2);
  g.fillRect(6, 10, 1, 1);
  g.generateTexture(key, 14, 16);
  g.destroy();
}

function generateCoffeeIcon(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.indicatorCoffee;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  g.fillStyle(PALETTE.amber, 1);
  g.fillRect(2, 5, 8, 7);
  g.fillStyle(PALETTE.desk, 1);
  g.fillRect(3, 6, 6, 5);
  g.lineStyle(1, PALETTE.amber, 1);
  g.strokeRect(10, 6, 2, 4);
  g.fillStyle(PALETTE.wallTop, 0.7);
  g.fillRect(4, 1, 1, 3);
  g.fillRect(7, 1, 1, 3);
  g.generateTexture(key, 14, 14);
  g.destroy();
}

function generateBangIcon(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.indicatorBang;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  g.fillStyle(PALETTE.fail, 1);
  g.fillTriangle(7, 1, 13, 13, 1, 13);
  g.lineStyle(1, PALETTE.wall, 1);
  g.strokeTriangle(7, 1, 13, 13, 1, 13);
  g.fillStyle(PALETTE.amber, 1);
  g.fillRect(6, 5, 2, 4);
  g.fillRect(6, 10, 2, 2);
  g.generateTexture(key, 14, 14);
  g.destroy();
}

function generateCheckIcon(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.indicatorCheck;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  g.fillStyle(PALETTE.success, 1);
  g.fillCircle(7, 7, 7);
  g.lineStyle(1, PALETTE.wall, 1);
  g.strokeCircle(7, 7, 7);
  g.lineStyle(2, PALETTE.amber, 1);
  g.beginPath();
  g.moveTo(3, 7);
  g.lineTo(6, 10);
  g.lineTo(11, 4);
  g.strokePath();
  g.generateTexture(key, 14, 14);
  g.destroy();
}

function generateTicket(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.ticket;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  g.fillStyle(PALETTE.amber, 1);
  g.fillRoundedRect(0, 0, 14, 10, 2);
  g.lineStyle(1, PALETTE.deskTop, 1);
  g.strokeRoundedRect(0, 0, 14, 10, 2);
  g.fillStyle(PALETTE.reviewWall, 1);
  g.fillRect(0, 0, 14, 2);
  g.fillStyle(PALETTE.wall, 0.5);
  g.fillRect(2, 4, 8, 1);
  g.fillRect(2, 6, 6, 1);
  g.generateTexture(key, 14, 10);
  g.destroy();
}

function generateTicketScroll(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.ticketScroll;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  g.fillStyle(PALETTE.amber, 1);
  g.fillRoundedRect(0, 0, 10, 16, 1);
  g.lineStyle(1, PALETTE.deskTop, 1);
  g.strokeRoundedRect(0, 0, 10, 16, 1);
  g.fillStyle(PALETTE.desk, 0.8);
  g.fillRect(0, 0, 10, 2);
  g.fillRect(0, 14, 10, 2);
  g.fillStyle(PALETTE.wall, 0.4);
  g.fillRect(2, 4, 6, 1);
  g.fillRect(2, 7, 5, 1);
  g.fillRect(2, 10, 6, 1);
  g.generateTexture(key, 10, 16);
  g.destroy();
}

function generateTicketEnvelope(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.ticketEnvelope;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  g.fillStyle(PALETTE.amber, 1);
  g.fillRect(0, 0, 14, 10);
  g.lineStyle(1, PALETTE.deskTop, 1);
  g.strokeRect(0, 0, 14, 10);
  g.lineStyle(1, PALETTE.deskTop, 0.6);
  g.lineBetween(0, 0, 7, 5);
  g.lineBetween(14, 0, 7, 5);
  // Seal dot: scout envelope seal colour per CINEMATIC_TINTS
  g.fillStyle(PALETTE.cyan, 1);
  g.fillCircle(7, 5, 2);
  g.generateTexture(key, 14, 10);
  g.destroy();
}

function generateQueueStackMany(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.queueStackMany;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  for (let i = 3; i >= 0; i--) {
    const ox = i * 2;
    const oy = i * 2;
    g.fillStyle(PALETTE.amber, 1);
    g.fillRoundedRect(ox, oy, 14, 10, 2);
    g.lineStyle(1, PALETTE.deskTop, 1);
    g.strokeRoundedRect(ox, oy, 14, 10, 2);
  }
  g.generateTexture(key, 14 + 6, 10 + 6);
  g.destroy();
}

function generateTicketGlow(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.ticketGlow;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  g.fillStyle(PALETTE.amber, 0.25);
  g.fillRoundedRect(0, 0, 20, 16, 4);
  g.lineStyle(1, PALETTE.amber, 0.6);
  g.strokeRoundedRect(0, 0, 20, 16, 4);
  g.generateTexture(key, 20, 16);
  g.destroy();
}

function generateWallFrostedBlue(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.wallFrostedBlue;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  g.fillStyle(PALETTE.qaWall, 1);
  g.fillRect(0, 0, 16, 16);
  g.fillStyle(PALETTE.cyan, 0.2);
  g.fillRect(0, 0, 16, 16);
  g.generateTexture(key, 16, 16);
  g.destroy();
}

function generateWallFrostedGrey(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.wallFrostedGrey;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  g.fillStyle(PALETTE.wallTop, 1);
  g.fillRect(0, 0, 16, 16);
  g.fillStyle(PALETTE.wall, 0.3);
  g.fillRect(0, 14, 16, 2);
  g.generateTexture(key, 16, 16);
  g.destroy();
}

function generateScoutDesk(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.scoutDesk;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  g.fillStyle(PALETTE.desk, 1);
  g.fillRect(0, 14, 32, 10);
  g.fillStyle(PALETTE.deskTop, 1);
  g.fillRect(0, 12, 32, 4);
  g.fillStyle(PALETTE.wall, 1);
  g.fillRect(8, 2, 16, 11);
  g.fillStyle(PALETTE.cyan, 1);
  g.fillRect(10, 4, 12, 7);
  // Report on desk surface
  g.fillStyle(PALETTE.amber, 1);
  g.fillRect(2, 14, 5, 3);
  g.generateTexture(key, 32, 24);
  g.destroy();
}
