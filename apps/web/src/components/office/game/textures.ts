// Procedural pixel-art texture generator for the Office view.
//
// Why procedural rather than PNGs in /public? Two reasons:
//   1. The repo ships with zero binary assets — runtime-generated textures
//      mean the Office tab works in fresh checkouts without an asset-build
//      step.
//   2. PixelLab generation runs offline (`pnpm gen:office-assets`) and writes
//      to `/public/office/`; the loader (see `loadOfficeAssets`) prefers PNGs
//      from disk when present and falls back to procedural otherwise.
//
// The textures are intentionally chunky 16×16 / 24×24 — readable at the small
// camera zoom used in the Office view.

import type Phaser from 'phaser';
import type { IndicatorKind } from '../lib/state-indicators';

const PALETTE = {
  floor: 0x2a2333,
  floorAlt: 0x312a3d,
  wall: 0x4a3a5e,
  desk: 0x6b4a2e,
  deskTop: 0x8a6541,
  monitor: 0x101820,
  monitorOn: 0x4ea1ff,
  stairs: 0x8a7355,
  stairsRail: 0x5c4a30,
  bannerBg: 0x1a1622,
  bannerFg: 0xc7b8ff,
  // Sprite colors per role (so it's glanceable at low resolution)
  spriteBody: 0xe6c285,
  spriteHead: 0xf5d9a8,
  spriteTriager: 0xa78bfa,
  spriteGriller: 0xf97316,
  spritePrdWriter: 0xeab308,
  spriteDecomposer: 0x84cc16,
  spriteResearcher: 0x06b6d4,
  spriteInvestigator: 0x3b82f6,
  spriteDeveloper: 0x10b981,
  spriteQa: 0xec4899,
  spriteReviewer: 0xf59e0b,
  spriteRetrospector: 0x8b5cf6,
} as const;

export const TEXTURE_KEYS = {
  floorTile: 'office:floor-tile',
  floorTileAlt: 'office:floor-tile-alt',
  wallTile: 'office:wall-tile',
  desk: 'office:desk',
  stairs: 'office:stairs',
  spriteBase: 'office:sprite',
  // Indicator keys mirror the IndicatorKind values
  indicatorSpeech: 'office:indicator-speech',
  indicatorThought: 'office:indicator-thought',
  indicatorQuestion: 'office:indicator-question',
  indicatorCoffee: 'office:indicator-coffee',
  indicatorBang: 'office:indicator-bang',
  indicatorCheck: 'office:indicator-check',
  // Phase-3 ticket and queue-stack textures
  ticket: 'office:ticket',
  queueStack1: 'office:queue-stack-1',
  queueStack2: 'office:queue-stack-2',
  queueStack3: 'office:queue-stack-3',
  queueStackMany: 'office:queue-stack-many',
  ticketGlow: 'office:ticket-glow',
  // Phase-5 cinematic texture variants
  ticketScroll: 'office:ticket-scroll',
  ticketEnvelope: 'office:ticket-envelope',
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

const ROLE_COLOR: Record<string, number> = {
  triager: PALETTE.spriteTriager,
  griller: PALETTE.spriteGriller,
  'prd-writer': PALETTE.spritePrdWriter,
  decomposer: PALETTE.spriteDecomposer,
  researcher: PALETTE.spriteResearcher,
  investigator: PALETTE.spriteInvestigator,
  developer: PALETTE.spriteDeveloper,
  qa: PALETTE.spriteQa,
  reviewer: PALETTE.spriteReviewer,
  retrospector: PALETTE.spriteRetrospector,
};

export function spriteTextureKeyForRole(role: string): string {
  return `${TEXTURE_KEYS.spriteBase}-${role}`;
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
  for (const role of Object.keys(ROLE_COLOR)) {
    generateSprite(scene, role, ROLE_COLOR[role]);
  }
  generateTicket(scene);
  generateTicketScroll(scene);
  generateTicketEnvelope(scene);
  generateQueueStacks(scene);
  generateTicketGlow(scene);
  generateSpeechBubble(scene);
  generateThoughtBubble(scene);
  generateQuestionBubble(scene);
  generateCoffeeIcon(scene);
  generateBangIcon(scene);
  generateCheckIcon(scene);
}

function generateFloorTile(scene: Phaser.Scene, key: string, color: number): void {
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  g.fillStyle(color, 1);
  g.fillRect(0, 0, 16, 16);
  // Subtle scuff in the corners for a "tiled" feel
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
  g.fillStyle(0x000000, 0.25);
  g.fillRect(0, 14, 16, 2);
  g.generateTexture(key, 16, 16);
  g.destroy();
}

function generateDesk(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.desk;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  // Desk base
  g.fillStyle(PALETTE.desk, 1);
  g.fillRect(0, 14, 32, 10);
  // Desktop
  g.fillStyle(PALETTE.deskTop, 1);
  g.fillRect(0, 12, 32, 4);
  // Monitor
  g.fillStyle(PALETTE.monitor, 1);
  g.fillRect(8, 2, 16, 11);
  g.fillStyle(PALETTE.monitorOn, 1);
  g.fillRect(10, 4, 12, 7);
  // Monitor stand
  g.fillStyle(PALETTE.desk, 1);
  g.fillRect(14, 13, 4, 2);
  g.generateTexture(key, 32, 24);
  g.destroy();
}

function generateStairs(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.stairs;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  g.fillStyle(PALETTE.stairs, 1);
  g.fillRect(0, 0, 32, 32);
  // Stair lines
  g.lineStyle(1, PALETTE.stairsRail, 1);
  for (let i = 4; i < 32; i += 4) {
    g.beginPath();
    g.moveTo(0, i);
    g.lineTo(32, i);
    g.strokePath();
  }
  g.generateTexture(key, 32, 32);
  g.destroy();
}

function generateSprite(scene: Phaser.Scene, role: string, accent: number): void {
  const key = spriteTextureKeyForRole(role);
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  // Body (shirt) — accent color identifies the role
  g.fillStyle(accent, 1);
  g.fillRect(2, 9, 8, 7);
  // Head
  g.fillStyle(PALETTE.spriteHead, 1);
  g.fillRect(3, 2, 6, 7);
  // Hair top
  g.fillStyle(0x1f1726, 1);
  g.fillRect(3, 1, 6, 2);
  // Eyes (single dark pixel each)
  g.fillStyle(0x101010, 1);
  g.fillRect(4, 5, 1, 1);
  g.fillRect(7, 5, 1, 1);
  // Arms / legs hint
  g.fillStyle(accent, 1);
  g.fillRect(1, 9, 1, 5);
  g.fillRect(10, 9, 1, 5);
  g.generateTexture(key, 12, 16);
  g.destroy();
}

function makeBubbleBg(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(0xffffff, 1);
  g.fillRoundedRect(0, 0, 14, 12, 3);
  g.lineStyle(1, 0x1a1622, 1);
  g.strokeRoundedRect(0, 0, 14, 12, 3);
  // Tail
  g.fillStyle(0xffffff, 1);
  g.fillTriangle(4, 12, 8, 12, 5, 15);
  g.lineStyle(1, 0x1a1622, 1);
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
  g.fillStyle(0x1a1622, 1);
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
  // Cloud-shaped bubble
  g.fillStyle(0xffffff, 1);
  g.fillCircle(4, 5, 4);
  g.fillCircle(9, 4, 4);
  g.fillCircle(7, 8, 4);
  g.lineStyle(1, 0x1a1622, 1);
  g.strokeCircle(4, 5, 4);
  g.strokeCircle(9, 4, 4);
  g.strokeCircle(7, 8, 4);
  // Trailing dots
  g.fillStyle(0xffffff, 1);
  g.fillCircle(5, 13, 1.5);
  g.lineStyle(1, 0x1a1622, 1);
  g.strokeCircle(5, 13, 1.5);
  g.generateTexture(key, 14, 16);
  g.destroy();
}

function generateQuestionBubble(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.indicatorQuestion;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  makeBubbleBg(g);
  // ?
  g.fillStyle(0x1a1622, 1);
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
  // Mug
  g.fillStyle(0xffffff, 1);
  g.fillRect(2, 5, 8, 7);
  g.fillStyle(0x6b4a2e, 1);
  g.fillRect(3, 6, 6, 5);
  // Handle
  g.lineStyle(1, 0xffffff, 1);
  g.strokeRect(10, 6, 2, 4);
  // Steam
  g.fillStyle(0xb8b8b8, 0.7);
  g.fillRect(4, 1, 1, 3);
  g.fillRect(7, 1, 1, 3);
  g.generateTexture(key, 14, 14);
  g.destroy();
}

function generateBangIcon(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.indicatorBang;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  // Red triangle
  g.fillStyle(0xef4444, 1);
  g.fillTriangle(7, 1, 13, 13, 1, 13);
  g.lineStyle(1, 0x1a1622, 1);
  g.strokeTriangle(7, 1, 13, 13, 1, 13);
  // !
  g.fillStyle(0xffffff, 1);
  g.fillRect(6, 5, 2, 4);
  g.fillRect(6, 10, 2, 2);
  g.generateTexture(key, 14, 14);
  g.destroy();
}

function generateCheckIcon(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.indicatorCheck;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  // Green circle
  g.fillStyle(0x22c55e, 1);
  g.fillCircle(7, 7, 7);
  g.lineStyle(1, 0x1a1622, 1);
  g.strokeCircle(7, 7, 7);
  // Tick
  g.lineStyle(2, 0xffffff, 1);
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
  // Card body
  g.fillStyle(0xf5f0e8, 1);
  g.fillRoundedRect(0, 0, 14, 10, 2);
  g.lineStyle(1, 0x8a7355, 1);
  g.strokeRoundedRect(0, 0, 14, 10, 2);
  // Priority tint strip at top
  g.fillStyle(0x6b4a8e, 1);
  g.fillRect(0, 0, 14, 2);
  // Text lines
  g.fillStyle(0x4a3a5e, 0.5);
  g.fillRect(2, 4, 8, 1);
  g.fillRect(2, 6, 6, 1);
  g.generateTexture(key, 14, 10);
  g.destroy();
}

function generateTicketScroll(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.ticketScroll;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  // Scroll body — taller, parchment colour
  g.fillStyle(0xf5e8c8, 1);
  g.fillRoundedRect(0, 0, 10, 16, 1);
  g.lineStyle(1, 0xb88a3a, 1);
  g.strokeRoundedRect(0, 0, 10, 16, 1);
  // Rolled-up ends (dark band)
  g.fillStyle(0x8a6020, 0.8);
  g.fillRect(0, 0, 10, 2);
  g.fillRect(0, 14, 10, 2);
  // Text lines
  g.fillStyle(0x4a3020, 0.4);
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
  // Envelope body
  g.fillStyle(0xf0eadc, 1);
  g.fillRect(0, 0, 14, 10);
  g.lineStyle(1, 0x8a7355, 1);
  g.strokeRect(0, 0, 14, 10);
  // V-flap line
  g.lineStyle(1, 0x8a7355, 0.6);
  g.lineBetween(0, 0, 7, 5);
  g.lineBetween(14, 0, 7, 5);
  // Seal dot
  g.fillStyle(0x6b4a8e, 1);
  g.fillCircle(7, 5, 2);
  g.generateTexture(key, 14, 10);
  g.destroy();
}

function generateQueueStacks(scene: Phaser.Scene): void {
  const configs = [
    { key: TEXTURE_KEYS.queueStack1, count: 1 },
    { key: TEXTURE_KEYS.queueStack2, count: 2 },
    { key: TEXTURE_KEYS.queueStack3, count: 3 },
    { key: TEXTURE_KEYS.queueStackMany, count: 4 },
  ];
  for (const { key, count } of configs) {
    if (scene.textures.exists(key)) continue;
    const g = scene.add.graphics({ x: 0, y: 0 });
    for (let i = count - 1; i >= 0; i--) {
      const ox = i * 2;
      const oy = i * 2;
      g.fillStyle(0xf5f0e8, 1);
      g.fillRoundedRect(ox, oy, 14, 10, 2);
      g.lineStyle(1, 0x8a7355, 1);
      g.strokeRoundedRect(ox, oy, 14, 10, 2);
    }
    g.generateTexture(key, 14 + 6, 10 + 6);
    g.destroy();
  }
}

function generateTicketGlow(scene: Phaser.Scene): void {
  const key = TEXTURE_KEYS.ticketGlow;
  if (scene.textures.exists(key)) return;
  const g = scene.add.graphics({ x: 0, y: 0 });
  g.fillStyle(0xffd700, 0.25);
  g.fillRoundedRect(0, 0, 20, 16, 4);
  g.lineStyle(1, 0xffd700, 0.6);
  g.strokeRoundedRect(0, 0, 20, 16, 4);
  g.generateTexture(key, 20, 16);
  g.destroy();
}
