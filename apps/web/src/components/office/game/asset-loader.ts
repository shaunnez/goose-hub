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

export function pngManifest(): AssetEntry[] {
  return [
    { key: TEXTURE_KEYS.floorTile, url: `${ASSET_BASE}/floor-tile.png` },
    { key: TEXTURE_KEYS.floorTileAlt, url: `${ASSET_BASE}/floor-tile-alt.png` },
    { key: TEXTURE_KEYS.wallTile, url: `${ASSET_BASE}/wall-tile.png` },
    { key: TEXTURE_KEYS.desk, url: `${ASSET_BASE}/desk.png` },
    { key: TEXTURE_KEYS.stairs, url: `${ASSET_BASE}/stairs.png` },
    { key: TEXTURE_KEYS.spriteBase, url: `${ASSET_BASE}/sprite.png` },
    { key: TEXTURE_KEYS.indicatorSpeech, url: `${ASSET_BASE}/indicator-speech.png` },
    { key: TEXTURE_KEYS.indicatorThought, url: `${ASSET_BASE}/indicator-thought.png` },
    { key: TEXTURE_KEYS.indicatorQuestion, url: `${ASSET_BASE}/indicator-question.png` },
    { key: TEXTURE_KEYS.indicatorCoffee, url: `${ASSET_BASE}/indicator-coffee.png` },
    { key: TEXTURE_KEYS.indicatorBang, url: `${ASSET_BASE}/indicator-bang.png` },
    { key: TEXTURE_KEYS.indicatorCheck, url: `${ASSET_BASE}/indicator-check.png` },
    { key: TEXTURE_KEYS.ticket, url: `${ASSET_BASE}/ticket.png` },
    { key: TEXTURE_KEYS.queueStackMany, url: `${ASSET_BASE}/queue-stack-many.png` },
    { key: TEXTURE_KEYS.ticketGlow, url: `${ASSET_BASE}/ticket-glow.png` },
    { key: TEXTURE_KEYS.ticketScroll, url: `${ASSET_BASE}/ticket-scroll.png` },
    { key: TEXTURE_KEYS.ticketEnvelope, url: `${ASSET_BASE}/ticket-envelope.png` },
    { key: TEXTURE_KEYS.wallFrostedBlue, url: `${ASSET_BASE}/wall-frosted-blue.png` },
    { key: TEXTURE_KEYS.wallFrostedGrey, url: `${ASSET_BASE}/wall-frosted-grey.png` },
    { key: TEXTURE_KEYS.scoutDesk, url: `${ASSET_BASE}/scout-desk.png` },
    // 01 — Core Tiles / Floors
    { key: 'office:floor_tile_01', url: `${ASSET_BASE}/floor_tile_01.png` },
    { key: 'office:floor_tile_02', url: `${ASSET_BASE}/floor_tile_02.png` },
    { key: 'office:corridor_tile_01', url: `${ASSET_BASE}/corridor_tile_01.png` },
    { key: 'office:corridor_tile_02', url: `${ASSET_BASE}/corridor_tile_02.png` },
    // 01 — Core Tiles / Walls
    { key: 'office:wall_dark_02', url: `${ASSET_BASE}/wall_dark_02.png` },
    { key: 'office:wall_corner_inner', url: `${ASSET_BASE}/wall_corner_inner.png` },
    { key: 'office:wall_corner_outer', url: `${ASSET_BASE}/wall_corner_outer.png` },
    { key: 'office:wall_trim_top', url: `${ASSET_BASE}/wall_trim_top.png` },
    // 05 — Ticket Assets
    { key: 'office:ticket_retry', url: `${ASSET_BASE}/ticket_retry.png` },
    { key: 'office:ticket_queue_stack', url: `${ASSET_BASE}/ticket_queue_stack.png` },
    { key: 'office:ticket_glow_overlay', url: `${ASSET_BASE}/ticket_glow_overlay.png` },
    // 06 — HUD / UI / Speech
    { key: 'office:speech_bubble_small', url: `${ASSET_BASE}/speech_bubble_small.png` },
    { key: 'office:thought_bubble_small', url: `${ASSET_BASE}/thought_bubble_small.png` },
    { key: 'office:question_bubble_small', url: `${ASSET_BASE}/question_bubble_small.png` },
    // 06 — HUD / UI / Indicators
    { key: 'office:blocked_icon', url: `${ASSET_BASE}/blocked_icon.png` },
    { key: 'office:convergence_icon', url: `${ASSET_BASE}/convergence_icon.png` },
    { key: 'office:retry_badge', url: `${ASSET_BASE}/retry_badge.png` },
    { key: 'office:queue_badge', url: `${ASSET_BASE}/queue_badge.png` },
    { key: 'office:hero_badge', url: `${ASSET_BASE}/hero_badge.png` },
    { key: 'office:merge_check', url: `${ASSET_BASE}/merge_check.png` },
    // 06 — HUD / UI / Panels
    { key: 'office:hero_ticket_popup', url: `${ASSET_BASE}/hero_ticket_popup.png` },
    { key: 'office:queue_counter_panel', url: `${ASSET_BASE}/queue_counter_panel.png` },
    { key: 'office:retry_counter_panel', url: `${ASSET_BASE}/retry_counter_panel.png` },
    { key: 'office:convergence_panel', url: `${ASSET_BASE}/convergence_panel.png` },
    // 06 — HUD / UI / Event Feed
    { key: 'office:event_feed_bg', url: `${ASSET_BASE}/event_feed_bg.png` },
    { key: 'office:event_feed_row', url: `${ASSET_BASE}/event_feed_row.png` },
    // 07 — Effects / Overlays
    { key: 'office:monitor_glow_overlay', url: `${ASSET_BASE}/monitor_glow_overlay.png` },
    { key: 'office:room_heat_overlay_low', url: `${ASSET_BASE}/room_heat_overlay_low.png` },
    { key: 'office:room_heat_overlay_high', url: `${ASSET_BASE}/room_heat_overlay_high.png` },
    { key: 'office:merge_particle', url: `${ASSET_BASE}/merge_particle.png` },
    { key: 'office:qa_failure_flash', url: `${ASSET_BASE}/qa_failure_flash.png` },
    { key: 'office:glow_soft', url: `${ASSET_BASE}/glow_soft.png` },
    { key: 'office:spotlight_overlay', url: `${ASSET_BASE}/spotlight_overlay.png` },
    // 08 — Ambient
    { key: 'office:rain_window_overlay', url: `${ASSET_BASE}/rain_window_overlay.png` },
    { key: 'office:rain_streak_overlay', url: `${ASSET_BASE}/rain_streak_overlay.png` },
    { key: 'office:ambient_shadow_soft', url: `${ASSET_BASE}/ambient_shadow_soft.png` },
    { key: 'office:lamp_glow_soft', url: `${ASSET_BASE}/lamp_glow_soft.png` },
    { key: 'office:lamp_glow_warm', url: `${ASSET_BASE}/lamp_glow_warm.png` },
    // 09 — Typography / Labels
    { key: 'office:room_label_triage', url: `${ASSET_BASE}/room_label_triage.png` },
    { key: 'office:room_label_investigation', url: `${ASSET_BASE}/room_label_investigation.png` },
    { key: 'office:room_label_library', url: `${ASSET_BASE}/room_label_library.png` },
    { key: 'office:room_label_dev', url: `${ASSET_BASE}/room_label_dev.png` },
    { key: 'office:room_label_qa', url: `${ASSET_BASE}/room_label_qa.png` },
    { key: 'office:room_label_review', url: `${ASSET_BASE}/room_label_review.png` },
    { key: 'office:room_label_done', url: `${ASSET_BASE}/room_label_done.png` },
    { key: 'office:room_label_archive', url: `${ASSET_BASE}/room_label_archive.png` },
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
