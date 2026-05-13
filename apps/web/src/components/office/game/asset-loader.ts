// Asset loader: prefers PNGs from /public/office/<key>.png when present,
// otherwise lets the procedural texture generator (textures.ts) take over.
//
// This lets `pnpm gen:office-assets` (which runs PixelLab) progressively
// upgrade the visual quality of the Office tab without any code changes.

import type Phaser from 'phaser';
import { TEXTURE_KEYS } from './textures';

const ASSET_BASE = '/office';

/**
 * Map of texture-key → relative URL under /public/office/. The loader fires a
 * HEAD-style preload for each; missing files fail silently and the procedural
 * generator fills the gap.
 */
function pngManifest(): Array<{ key: string; url: string }> {
  return [
    { key: TEXTURE_KEYS.floorTile, url: `${ASSET_BASE}/floor-tile.png` },
    { key: TEXTURE_KEYS.floorTileAlt, url: `${ASSET_BASE}/floor-tile-alt.png` },
    { key: TEXTURE_KEYS.wallTile, url: `${ASSET_BASE}/wall-tile.png` },
    { key: TEXTURE_KEYS.desk, url: `${ASSET_BASE}/desk.png` },
    { key: TEXTURE_KEYS.stairs, url: `${ASSET_BASE}/stairs.png` },
    { key: TEXTURE_KEYS.indicatorSpeech, url: `${ASSET_BASE}/indicator-speech.png` },
    { key: TEXTURE_KEYS.indicatorThought, url: `${ASSET_BASE}/indicator-thought.png` },
    { key: TEXTURE_KEYS.indicatorQuestion, url: `${ASSET_BASE}/indicator-question.png` },
    { key: TEXTURE_KEYS.indicatorCoffee, url: `${ASSET_BASE}/indicator-coffee.png` },
    { key: TEXTURE_KEYS.indicatorBang, url: `${ASSET_BASE}/indicator-bang.png` },
    { key: TEXTURE_KEYS.indicatorCheck, url: `${ASSET_BASE}/indicator-check.png` },
  ];
}

/**
 * Queues optional PNG loads in `scene.preload()`. Errors are swallowed so a
 * missing asset is a no-op, not a scene crash.
 */
export function queueOptionalPngAssets(scene: Phaser.Scene): void {
  const manifest = pngManifest();
  for (const { key, url } of manifest) {
    scene.load.image(key, url);
  }
  // Suppress missing-file errors so procedural fallback runs cleanly.
  scene.load.on('loaderror', (file: Phaser.Loader.File) => {
    const url = typeof file.url === 'string' ? file.url : '';
    if (url.startsWith(ASSET_BASE)) {
      // expected when no /public/office/<file>.png is present
    }
  });
}
