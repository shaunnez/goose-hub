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
    { key: 'office:floor_shadow_edge', url: `${ASSET_BASE}/floor_shadow_edge.png` },
    { key: 'office:carpet_trim_horizontal', url: `${ASSET_BASE}/carpet_trim_horizontal.png` },
    { key: 'office:carpet_trim_vertical', url: `${ASSET_BASE}/carpet_trim_vertical.png` },
    // 01 — Core Tiles / Walls
    { key: 'office:wall_dark_01', url: `${ASSET_BASE}/wall_dark_01.png` },
    { key: 'office:wall_dark_02', url: `${ASSET_BASE}/wall_dark_02.png` },
    { key: 'office:wall_corner_inner', url: `${ASSET_BASE}/wall_corner_inner.png` },
    { key: 'office:wall_corner_outer', url: `${ASSET_BASE}/wall_corner_outer.png` },
    { key: 'office:wall_trim_top', url: `${ASSET_BASE}/wall_trim_top.png` },
    { key: 'office:wall_trim_bottom', url: `${ASSET_BASE}/wall_trim_bottom.png` },
    // 01 — Core Tiles / Special Walls
    { key: 'office:frosted_glass_wall', url: `${ASSET_BASE}/frosted_glass_wall.png` },
    { key: 'office:frosted_glass_door_closed', url: `${ASSET_BASE}/frosted_glass_door_closed.png` },
    { key: 'office:frosted_glass_door_open', url: `${ASSET_BASE}/frosted_glass_door_open.png` },
    { key: 'office:sealed_wall_blue', url: `${ASSET_BASE}/sealed_wall_blue.png` },
    { key: 'office:sealed_wall_green', url: `${ASSET_BASE}/sealed_wall_green.png` },
    // 02 — Corridor Assets
    { key: 'office:corridor_light_pool', url: `${ASSET_BASE}/corridor_light_pool.png` },
    { key: 'office:corridor_pulse_red', url: `${ASSET_BASE}/corridor_pulse_red.png` },
    { key: 'office:corridor_pulse_green', url: `${ASSET_BASE}/corridor_pulse_green.png` },
    { key: 'office:movement_trail_blue', url: `${ASSET_BASE}/movement_trail_blue.png` },
    { key: 'office:movement_trail_red', url: `${ASSET_BASE}/movement_trail_red.png` },
    { key: 'office:movement_trail_green', url: `${ASSET_BASE}/movement_trail_green.png` },
    { key: 'office:movement_trail_yellow', url: `${ASSET_BASE}/movement_trail_yellow.png` },
    // 03 — Room Props / Triage
    { key: 'office:desk_triage', url: `${ASSET_BASE}/desk_triage.png` },
    { key: 'office:intake_board', url: `${ASSET_BASE}/intake_board.png` },
    { key: 'office:paperwork_stack', url: `${ASSET_BASE}/paperwork_stack.png` },
    { key: 'office:queue_stack_small', url: `${ASSET_BASE}/queue_stack_small.png` },
    { key: 'office:queue_stack_large', url: `${ASSET_BASE}/queue_stack_large.png` },
    // 03 — Room Props / Investigation
    { key: 'office:desk_investigation', url: `${ASSET_BASE}/desk_investigation.png` },
    { key: 'office:investigation_monitor', url: `${ASSET_BASE}/investigation_monitor.png` },
    { key: 'office:investigation_map_board', url: `${ASSET_BASE}/investigation_map_board.png` },
    { key: 'office:bookshelf_small', url: `${ASSET_BASE}/bookshelf_small.png` },
    { key: 'office:bookshelf_large', url: `${ASSET_BASE}/bookshelf_large.png` },
    // 03 — Room Props / Sealed Library
    { key: 'office:library_terminal', url: `${ASSET_BASE}/library_terminal.png` },
    { key: 'office:convergence_core', url: `${ASSET_BASE}/convergence_core.png` },
    { key: 'office:glowing_convergence_ring', url: `${ASSET_BASE}/glowing_convergence_ring.png` },
    { key: 'office:scout_report_stack', url: `${ASSET_BASE}/scout_report_stack.png` },
    { key: 'office:sealed_slot_library', url: `${ASSET_BASE}/sealed_slot_library.png` },
    // 03 — Room Props / Dev
    { key: 'office:desk_dev_single', url: `${ASSET_BASE}/desk_dev_single.png` },
    { key: 'office:desk_dev_dual', url: `${ASSET_BASE}/desk_dev_dual.png` },
    { key: 'office:dev_monitor_single', url: `${ASSET_BASE}/dev_monitor_single.png` },
    { key: 'office:dev_monitor_dual', url: `${ASSET_BASE}/dev_monitor_dual.png` },
    { key: 'office:keyboard_glow', url: `${ASSET_BASE}/keyboard_glow.png` },
    { key: 'office:desk_lamp', url: `${ASSET_BASE}/desk_lamp.png` },
    // 03 — Room Props / QA
    { key: 'office:qa_station', url: `${ASSET_BASE}/qa_station.png` },
    { key: 'office:retry_counter_frame', url: `${ASSET_BASE}/retry_counter_frame.png` },
    { key: 'office:verdict_scroll_printer', url: `${ASSET_BASE}/verdict_scroll_printer.png` },
    { key: 'office:qa_input_slot', url: `${ASSET_BASE}/qa_input_slot.png` },
    { key: 'office:qa_output_slot', url: `${ASSET_BASE}/qa_output_slot.png` },
    { key: 'office:qa_warning_light', url: `${ASSET_BASE}/qa_warning_light.png` },
    // 03 — Room Props / Review
    { key: 'office:review_table', url: `${ASSET_BASE}/review_table.png` },
    { key: 'office:review_chair', url: `${ASSET_BASE}/review_chair.png` },
    { key: 'office:convergence_counter', url: `${ASSET_BASE}/convergence_counter.png` },
    { key: 'office:quality_score_gauge', url: `${ASSET_BASE}/quality_score_gauge.png` },
    { key: 'office:review_glass_overlay', url: `${ASSET_BASE}/review_glass_overlay.png` },
    // 03 — Room Props / Done + Archive
    { key: 'office:done_shelf', url: `${ASSET_BASE}/done_shelf.png` },
    { key: 'office:archive_shelf', url: `${ASSET_BASE}/archive_shelf.png` },
    { key: 'office:archive_drawer', url: `${ASSET_BASE}/archive_drawer.png` },
    { key: 'office:merge_trophy_small', url: `${ASSET_BASE}/merge_trophy_small.png` },
    { key: 'office:merge_trophy_large', url: `${ASSET_BASE}/merge_trophy_large.png` },
    // 03 — Room Props / Goose Coffee
    { key: 'office:goose_coffee_sign', url: `${ASSET_BASE}/goose_coffee_sign.png` },
    { key: 'office:coffee_machine', url: `${ASSET_BASE}/coffee_machine.png` },
    { key: 'office:coffee_mug', url: `${ASSET_BASE}/coffee_mug.png` },
    { key: 'office:steam_small', url: `${ASSET_BASE}/steam_small.png` },
    // 04 — Goose Sprites / Base
    { key: 'office:goose_idle', url: `${ASSET_BASE}/goose_idle.png` },
    { key: 'office:goose_walk_sheet', url: `${ASSET_BASE}/goose_walk_sheet.png` },
    { key: 'office:goose_sit', url: `${ASSET_BASE}/goose_sit.png` },
    { key: 'office:goose_think', url: `${ASSET_BASE}/goose_think.png` },
    // 04 — Goose Sprites / Role Variants
    { key: 'office:goose_triage', url: `${ASSET_BASE}/goose_triage.png` },
    { key: 'office:goose_investigator', url: `${ASSET_BASE}/goose_investigator.png` },
    { key: 'office:goose_dev', url: `${ASSET_BASE}/goose_dev.png` },
    { key: 'office:goose_qa', url: `${ASSET_BASE}/goose_qa.png` },
    { key: 'office:goose_reviewer', url: `${ASSET_BASE}/goose_reviewer.png` },
    { key: 'office:goose_scout', url: `${ASSET_BASE}/goose_scout.png` },
    { key: 'office:goose_ops', url: `${ASSET_BASE}/goose_ops.png` },
    // 04 — Goose Sprites / Overlay Variants
    { key: 'office:goose_spotlight', url: `${ASSET_BASE}/goose_spotlight.png` },
    { key: 'office:goose_blocked', url: `${ASSET_BASE}/goose_blocked.png` },
    { key: 'office:goose_hero', url: `${ASSET_BASE}/goose_hero.png` },
    // 05 — Ticket Assets
    { key: 'office:ticket_normal', url: `${ASSET_BASE}/ticket_normal.png` },
    { key: 'office:ticket_hero', url: `${ASSET_BASE}/ticket_hero.png` },
    { key: 'office:ticket_failed', url: `${ASSET_BASE}/ticket_failed.png` },
    { key: 'office:ticket_done', url: `${ASSET_BASE}/ticket_done.png` },
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
