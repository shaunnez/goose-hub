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
  wallTile: 'office:wall-tile',
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
  [TEXTURE_KEYS.wallTile]: { width: 16, height: 16 },
  [TEXTURE_KEYS.desk]: { width: 32, height: 24 },
  [TEXTURE_KEYS.stairs]: { width: 32, height: 32 },
  [TEXTURE_KEYS.indicatorSpeech]: { width: 14, height: 16 },
  [TEXTURE_KEYS.indicatorThought]: { width: 14, height: 16 },
  [TEXTURE_KEYS.indicatorQuestion]: { width: 14, height: 16 },
  [TEXTURE_KEYS.indicatorCoffee]: { width: 14, height: 14 },
  [TEXTURE_KEYS.indicatorBang]: { width: 14, height: 14 },
  [TEXTURE_KEYS.indicatorCheck]: { width: 14, height: 14 },
  [TEXTURE_KEYS.spriteBase]: { width: 12, height: 16 },
  // Goose sprite PNGs render at native 32x32 — twice the world tile size,
  // 2x area vs the procedural spriteBase, crispest pixel art (no scaling).
  // Earlier 24x24 still read as "tiny" at default camera zoom.
  'office:goose_idle': { width: 32, height: 32 },
  'office:goose_triage': { width: 32, height: 32 },
  'office:goose_investigator': { width: 32, height: 32 },
  'office:goose_dev': { width: 32, height: 32 },
  'office:goose_qa': { width: 32, height: 32 },
  'office:goose_reviewer': { width: 32, height: 32 },
  'office:goose_scout': { width: 32, height: 32 },
  'office:goose_ops': { width: 32, height: 32 },
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
  generateWallTile(scene);
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
