// Asset loader: prefers PNGs from /public/office/<key>.png when present,
// otherwise lets the procedural texture generator (textures.ts) take over.
//
// We probe each candidate URL with a `fetch` HEAD before handing it to
// Phaser's loader. Phaser's loader logs `console.error('Failed to process
// file…')` on every 404 and there's no clean public hook to silence it —
// pre-flighting via fetch keeps the console clean when no PixelLab assets
// have been generated (the common case in dev / CI).
//
// `pnpm gen:office-assets` writes PNGs that this loader will then pick up
// automatically on the next page load.

import type Phaser from 'phaser';
import { TEXTURE_KEYS } from './textures';

const ASSET_BASE = '/office';

interface AssetEntry {
  key: string;
  url: string;
}

function pngManifest(): AssetEntry[] {
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
 * HEAD-probe each candidate PNG and return only those that exist. Runs once
 * per scene boot, in parallel. Failures (network errors, 404s, no fetch in
 * the runtime) silently fall back to procedural textures.
 */
export async function probeOfficePngAssets(): Promise<AssetEntry[]> {
  if (typeof fetch === 'undefined') return [];
  const manifest = pngManifest();
  const results = await Promise.all(
    manifest.map(async (entry) => {
      try {
        const res = await fetch(entry.url, { method: 'HEAD', cache: 'no-store' });
        if (!res.ok) return null;
        // Vite's SPA fallback returns 200 with text/html for unknown paths,
        // which would falsely "verify" missing PNGs. Require an image MIME.
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.startsWith('image/')) return null;
        return entry;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((e): e is AssetEntry => e != null);
}

/**
 * Queue the verified PNG bundle into the scene's loader. Assumes the caller
 * already probed via `probeOfficePngAssets`.
 */
export function queueVerifiedPngAssets(scene: Phaser.Scene, entries: readonly AssetEntry[]): void {
  for (const { key, url } of entries) {
    scene.load.image(key, url);
  }
}
