#!/usr/bin/env tsx
/**
 * Generate the Office tab pixel-art asset bundle via the PixelLab REST API.
 *
 * Usage:
 *   PIXELLAB_API_KEY=<key> pnpm gen:office-assets                 # generate everything not already on disk
 *   pnpm gen:office-assets floor_tile_01.png wall_dark_01.png ... # generate only the listed files
 *   pnpm gen:office-assets --force <files...>                     # regenerate even if PNG exists
 *
 * The script writes PNGs into `apps/web/public/office/`. The Phaser scene
 * (apps/web/src/components/office/game/asset-loader.ts) prefers these PNGs
 * over the procedural fallback at runtime, so re-running is a safe quality
 * upgrade.
 *
 * Sandbox / no-network environments: skip running this — the Office tab
 * works without it via the procedural fallback.
 *
 * Two manifests:
 *   - MANIFEST: original kebab-case bundle (20 assets, predates the full
 *     asset-manifest.md). Kept stable so re-running is idempotent for the
 *     assets already wired into asset-loader.ts. slice.test.ts pins its
 *     length and palette rules.
 *   - ASSET_MANIFEST: the 122 snake_case assets defined by
 *     docs/archive/legacy/design/goose-hub-full-asset-manifest/asset-manifest.md.
 *     Generated incrementally by the Goose Hub asset loop.
 *
 * Concurrency is bounded to 4 parallel PixelLab calls (the loop's batch
 * size). PixelLab is sync-only; this is the cheapest parallelism win.
 */

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

loadDotenv();

const API_BASE = 'https://api.pixellab.ai/v1';
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '..', 'apps', 'web', 'public', 'office');
const CONCURRENCY = 4;

interface AssetSpec {
  /** Output filename in apps/web/public/office/. */
  file: string;
  /** Pixflux text prompt. */
  prompt: string;
  /** Intended in-game texture size. PixelLab requests are clamped to its 32x32 minimum. */
  width: number;
  height: number;
}

/** Global style suffix appended to every prompt for visual consistency. */
const STYLE = [
  'pixel art',
  'top-down view',
  'dark navy cyber-office palette',
  'cyan #6FE7FF monitor glow',
  'warm amber #F2CC8F lamp accents',
  'Phaser-compatible',
  'pixel perfect',
  'no anti-aliasing',
  'runtime-readable',
].join(', ');

const p = (intent: string): string => `${intent}. STYLE: ${STYLE}.`;

// ---------------------------------------------------------------------------
// MANIFEST — preserved verbatim from the pre-loop bundle. Do not edit; tests
// pin both length (20) and palette rules. Add new assets to ASSET_MANIFEST.
// ---------------------------------------------------------------------------

export const MANIFEST: AssetSpec[] = [
  {
    file: 'floor-tile.png',
    prompt: 'top-down office carpet tile colour #3A3D5C dark slate-blue, seamless, pixel art, 16x16',
    width: 16,
    height: 16,
  },
  {
    file: 'floor-tile-alt.png',
    prompt: 'top-down office carpet tile colour #42466A slightly lighter slate-blue, seamless, pixel art, 16x16',
    width: 16,
    height: 16,
  },
  {
    file: 'wall-tile.png',
    prompt: 'top-down office wall tile colour #2B2D42 dark navy with shadow at base, pixel art, 16x16',
    width: 16,
    height: 16,
  },
  {
    file: 'desk.png',
    prompt: 'top-down pixel art office desk wood #6B4F3B with monitor showing cyan #6FE7FF screen glow, 32x24',
    width: 32,
    height: 24,
  },
  {
    file: 'stairs.png',
    prompt: 'top-down pixel art staircase wooden steps #85694F with dark rail #6B4F3B, isometric hint, 32x32',
    width: 32,
    height: 32,
  },
  {
    file: 'sprite.png',
    prompt: 'top-down pixel art office goose character neutral pose, body colour #3B3D55, skin #85694F, 12x16, transparent bg',
    width: 16,
    height: 16,
  },
  {
    file: 'indicator-speech.png',
    prompt: 'pixel art speech bubble colour #F2CC8F amber with three dark #2B2D42 dots, 14x16, transparent bg',
    width: 14,
    height: 16,
  },
  {
    file: 'indicator-thought.png',
    prompt: 'pixel art cloud thought bubble colour #F2CC8F amber with trailing dot, outline #2B2D42, 14x16, transparent bg',
    width: 14,
    height: 16,
  },
  {
    file: 'indicator-question.png',
    prompt: 'pixel art speech bubble #F2CC8F amber with bold #2B2D42 question mark, 14x16, transparent bg',
    width: 14,
    height: 16,
  },
  {
    file: 'indicator-coffee.png',
    prompt: 'pixel art coffee mug #F2CC8F amber with steam wisps, brown coffee #6B4F3B inside, 14x14, transparent bg',
    width: 14,
    height: 14,
  },
  {
    file: 'indicator-bang.png',
    prompt: 'pixel art red #FF6B6B warning triangle with #F2CC8F exclamation mark, outline #2B2D42, 14x14, transparent bg',
    width: 14,
    height: 14,
  },
  {
    file: 'indicator-check.png',
    prompt: 'pixel art green #8BD17C circle with #F2CC8F checkmark, outline #2B2D42, 14x14, transparent bg',
    width: 14,
    height: 14,
  },
  {
    file: 'ticket.png',
    prompt: 'pixel art work ticket card #F2CC8F amber body with #473A55 priority strip, outline #85694F, 14x10, transparent bg',
    width: 14,
    height: 16,
  },
  {
    file: 'queue-stack-many.png',
    prompt: 'pixel art stack of 4 staggered #F2CC8F amber cards with #85694F outlines, 20x16, transparent bg',
    width: 20,
    height: 16,
  },
  {
    file: 'ticket-glow.png',
    prompt: 'pixel art glowing halo #F2CC8F amber rounded rect glow effect, 20x16, transparent bg',
    width: 20,
    height: 16,
  },
  {
    file: 'ticket-scroll.png',
    prompt: 'pixel art parchment scroll #F2CC8F amber with dark #6B4F3B rolled ends and text lines, 10x16, transparent bg',
    width: 10,
    height: 16,
  },
  {
    file: 'ticket-envelope.png',
    prompt: 'pixel art envelope #F2CC8F amber with V-flap and #6FE7FF cyan wax seal dot, 14x10, transparent bg',
    width: 14,
    height: 16,
  },
  {
    file: 'wall-frosted-blue.png',
    prompt: 'top-down office wall tile #3F6B80 teal with subtle #6FE7FF cyan frost, pixel art, 16x16',
    width: 16,
    height: 16,
  },
  {
    file: 'wall-frosted-grey.png',
    prompt: 'top-down office wall tile #3B3D55 muted blue-grey with shadow at base, pixel art, 16x16',
    width: 16,
    height: 16,
  },
  {
    file: 'scout-desk.png',
    prompt: 'top-down pixel art scout desk wood #6B4F3B with #6FE7FF cyan monitor and #F2CC8F report on surface, 32x24',
    width: 32,
    height: 24,
  },
];

// ---------------------------------------------------------------------------
// ASSET_MANIFEST — the 122 assets from docs/archive/legacy/design/goose-hub-full-asset-manifest/.
// Filenames MUST match the asset-manifest.md ledger exactly. Every prompt
// uses only Board 06 canonical hex codes (see BOARD06_HEX in slice.test.ts).
// ---------------------------------------------------------------------------

export const ASSET_MANIFEST: AssetSpec[] = [
  // 01 — Core Tiles / Floors
  { file: 'floor_tile_01.png', prompt: p('seamless office floor tile, dark navy #2B2D42 base, subtle weave texture, tiles cleanly when repeated'), width: 16, height: 16 },
  { file: 'floor_tile_02.png', prompt: p('seamless office floor tile variant, slightly lighter slate-blue #3A3D5C, subtle weave texture, tiles cleanly when repeated'), width: 16, height: 16 },
  { file: 'corridor_tile_01.png', prompt: p('seamless corridor floor tile, darker than room floors #2B2D42, faint warm amber spill along center, tiles cleanly'), width: 16, height: 16 },
  { file: 'corridor_tile_02.png', prompt: p('seamless corridor floor tile variant, dark navy #2B2D42 with subtle worn scuff marks, tiles cleanly'), width: 16, height: 16 },
  { file: 'floor_shadow_edge.png', prompt: p('floor edge shadow strip, fades from transparent to dark navy #2B2D42, used along wall bases, transparent background'), width: 16, height: 8 },
  { file: 'carpet_trim_horizontal.png', prompt: p('horizontal carpet trim strip, warm amber #6B4F3B band with subtle pixel-stitch pattern, tiles horizontally'), width: 16, height: 4 },
  { file: 'carpet_trim_vertical.png', prompt: p('vertical carpet trim strip, warm amber #6B4F3B band with subtle pixel-stitch pattern, tiles vertically'), width: 4, height: 16 },

  // 01 — Core Tiles / Walls
  { file: 'wall_dark_01.png', prompt: p('top-down office wall tile, dark navy #2B2D42 brick with shadow at base, tiles seamlessly'), width: 16, height: 16 },
  { file: 'wall_dark_02.png', prompt: p('top-down office wall tile variant, dark navy #2B2D42 with subtle vent or trim detail, tiles seamlessly'), width: 16, height: 16 },
  { file: 'wall_corner_inner.png', prompt: p('inner corner wall tile, dark navy #2B2D42, joins two perpendicular walls cleanly'), width: 16, height: 16 },
  { file: 'wall_corner_outer.png', prompt: p('outer corner wall tile, dark navy #2B2D42, juts into the room cleanly'), width: 16, height: 16 },
  { file: 'wall_trim_top.png', prompt: p('top wall trim strip, warm amber #6B4F3B crown moulding band, tiles horizontally'), width: 16, height: 4 },
  { file: 'wall_trim_bottom.png', prompt: p('bottom wall trim strip, warm amber #6B4F3B baseboard band, tiles horizontally'), width: 16, height: 4 },

  // 01 — Core Tiles / Special Walls
  { file: 'frosted_glass_wall.png', prompt: p('frosted glass office wall tile, semi-transparent teal #3F6B80 with cyan #6FE7FF frost, tiles seamlessly'), width: 16, height: 16 },
  { file: 'frosted_glass_door_closed.png', prompt: p('closed frosted-glass office door, semi-transparent teal #3F6B80 with a vertical seam down the middle'), width: 16, height: 32 },
  { file: 'frosted_glass_door_open.png', prompt: p('open frosted-glass office door, semi-transparent teal #3F6B80 with both halves slid aside revealing dark corridor'), width: 16, height: 32 },
  { file: 'sealed_wall_blue.png', prompt: p('sealed holdout wall tile, dark navy #2B2D42 base with a #3F6B80 teal undertone and a faint cyan #6FE7FF seal glyph, tiles seamlessly'), width: 16, height: 16 },
  { file: 'sealed_wall_green.png', prompt: p('sealed holdout wall tile, dark navy #2B2D42 base with a green #8BD17C undertone and a faint green #8BD17C seal glyph, tiles seamlessly'), width: 16, height: 16 },

  // 02 — Corridor Assets
  { file: 'corridor_light_pool.png', prompt: p('soft amber #F2CC8F light pool overlay for corridor floor, transparent background, radial fade'), width: 32, height: 16 },
  { file: 'corridor_pulse_red.png', prompt: p('red #FF6B6B pulse band overlay sweeping along a corridor floor, transparent background'), width: 32, height: 8 },
  { file: 'corridor_pulse_green.png', prompt: p('green #8BD17C pulse band overlay sweeping along a corridor floor, transparent background'), width: 32, height: 8 },
  { file: 'movement_trail_blue.png', prompt: p('short cyan #6FE7FF movement trail behind a goose, transparent background, fades from solid to transparent'), width: 16, height: 8 },
  { file: 'movement_trail_red.png', prompt: p('short red #FF6B6B movement trail behind a goose, transparent background, fades from solid to transparent'), width: 16, height: 8 },
  { file: 'movement_trail_green.png', prompt: p('short green #8BD17C movement trail behind a goose, transparent background, fades from solid to transparent'), width: 16, height: 8 },
  { file: 'movement_trail_yellow.png', prompt: p('short amber #F2CC8F movement trail behind a goose, transparent background, fades from solid to transparent'), width: 16, height: 8 },

  // 03 — Room Props / Triage
  { file: 'desk_triage.png', prompt: p('top-down triage desk, wood #6B4F3B with a stack of incoming papers and a single cyan monitor, transparent background'), width: 32, height: 24 },
  { file: 'intake_board.png', prompt: p('cork intake board mounted on wall, pinned ticket stubs, warm amber lamp glow above, transparent background'), width: 32, height: 24 },
  { file: 'paperwork_stack.png', prompt: p('small stack of office paperwork, warm amber cards #F2CC8F, faint shadow, transparent background'), width: 16, height: 12 },
  { file: 'queue_stack_small.png', prompt: p('small stack of 2-3 staggered amber #F2CC8F ticket cards with #85694F outlines, transparent background'), width: 16, height: 12 },
  { file: 'queue_stack_large.png', prompt: p('large stack of 6-8 staggered amber #F2CC8F ticket cards with #85694F outlines, transparent background'), width: 20, height: 20 },

  // 03 — Room Props / Investigation
  { file: 'desk_investigation.png', prompt: p('top-down investigation desk, wood #6B4F3B with scattered notes, a magnifier, and a single cyan monitor, transparent background'), width: 32, height: 24 },
  { file: 'investigation_monitor.png', prompt: p('investigation wall monitor showing pinned evidence and connecting strings, cyan #6FE7FF screen glow, transparent background'), width: 24, height: 16 },
  { file: 'investigation_map_board.png', prompt: p('detective map board with pinned photos and red yarn between them, mounted on wall, transparent background'), width: 32, height: 24 },
  { file: 'bookshelf_small.png', prompt: p('small two-shelf wooden bookshelf, books in warm amber and dark navy spines, transparent background'), width: 16, height: 24 },
  { file: 'bookshelf_large.png', prompt: p('tall four-shelf wooden bookshelf, books in warm amber and dark navy spines, transparent background'), width: 16, height: 32 },

  // 03 — Room Props / Sealed Library
  { file: 'library_terminal.png', prompt: p('sealed library terminal, deep cyan housing with a #6FE7FF screen showing scout report glyphs, transparent background'), width: 24, height: 24 },
  { file: 'convergence_core.png', prompt: p('central convergence core pedestal, glowing cyan #6FE7FF orb on dark navy plinth, transparent background'), width: 24, height: 32 },
  { file: 'glowing_convergence_ring.png', prompt: p('faint cyan #6FE7FF glowing ring overlay, transparent background, radial alpha falloff'), width: 32, height: 32 },
  { file: 'scout_report_stack.png', prompt: p('stack of folded scout reports, warm amber #F2CC8F parchment with cyan wax seals, transparent background'), width: 16, height: 12 },
  { file: 'sealed_slot_library.png', prompt: p('sealed slot in library wall, dark navy slot with a faint cyan #6FE7FF inner glow, transparent background'), width: 16, height: 16 },

  // 03 — Room Props / Dev
  { file: 'desk_dev_single.png', prompt: p('top-down dev desk for one, wood #6B4F3B with a single cyan #6FE7FF monitor and a keyboard, transparent background'), width: 32, height: 24 },
  { file: 'desk_dev_dual.png', prompt: p('top-down dev desk for two, wood #6B4F3B with two cyan #6FE7FF monitors and two keyboards side by side, transparent background'), width: 48, height: 24 },
  { file: 'dev_monitor_single.png', prompt: p('single dev monitor, cyan #6FE7FF screen with faint code lines, dark navy bezel, transparent background'), width: 16, height: 16 },
  { file: 'dev_monitor_dual.png', prompt: p('dual dev monitor setup, two cyan #6FE7FF screens with code lines, dark navy bezels, transparent background'), width: 32, height: 16 },
  { file: 'keyboard_glow.png', prompt: p('small office keyboard with faint cyan #6FE7FF keycap glow, top-down, transparent background'), width: 16, height: 8 },
  { file: 'desk_lamp.png', prompt: p('small office desk lamp with warm amber #F2CC8F glow puddle, top-down, transparent background'), width: 8, height: 12 },

  // 03 — Room Props / QA
  { file: 'qa_station.png', prompt: p('QA test station, dark navy #2B2D42 booth with #3F6B80 teal trim, a chair, and a verdict slot, transparent background'), width: 32, height: 32 },
  { file: 'retry_counter_frame.png', prompt: p('small retry counter frame, dark navy #2B2D42 plate with red #FF6B6B accent corners, transparent background'), width: 16, height: 16 },
  { file: 'verdict_scroll_printer.png', prompt: p('verdict scroll printer device, dark navy housing with an emerging amber #F2CC8F scroll, transparent background'), width: 16, height: 20 },
  { file: 'qa_input_slot.png', prompt: p('input slot in QA wall, dark navy slot with a faint cyan #6FE7FF inner glow, top-down, transparent background'), width: 16, height: 8 },
  { file: 'qa_output_slot.png', prompt: p('output slot in QA wall, dark navy slot with a faint amber #F2CC8F inner glow, top-down, transparent background'), width: 16, height: 8 },
  { file: 'qa_warning_light.png', prompt: p('small wall-mounted warning light, red #FF6B6B dome with a faint halo, transparent background'), width: 8, height: 12 },

  // 03 — Room Props / Review
  { file: 'review_table.png', prompt: p('top-down review meeting table, dark wood #6B4F3B oval with two amber lamps, transparent background'), width: 48, height: 32 },
  { file: 'review_chair.png', prompt: p('top-down review chair, dark navy #2B2D42 cushion and wooden frame, transparent background'), width: 12, height: 12 },
  { file: 'convergence_counter.png', prompt: p('digital convergence counter panel, cyan #6FE7FF percentage on dark navy face, transparent background'), width: 24, height: 16 },
  { file: 'quality_score_gauge.png', prompt: p('semicircular quality-score gauge, needle on green #8BD17C arc with red #FF6B6B segment, dark navy face, transparent background'), width: 24, height: 16 },
  { file: 'review_glass_overlay.png', prompt: p('frosted glass viewing window overlay for the review chamber, semi-transparent teal #3F6B80 with subtle reflections, transparent background'), width: 32, height: 32 },

  // 03 — Room Props / Done & Archive
  { file: 'done_shelf.png', prompt: p('done shelf with a single golden merge trophy and stacked completed tickets, dark wood #6B4F3B, transparent background'), width: 32, height: 24 },
  { file: 'archive_shelf.png', prompt: p('tall archive shelf full of bound dossiers, dark wood #6B4F3B frame, transparent background'), width: 24, height: 40 },
  { file: 'archive_drawer.png', prompt: p('single archive drawer cabinet, dark wood #6B4F3B with a brass handle, transparent background'), width: 16, height: 16 },
  { file: 'merge_trophy_small.png', prompt: p('small merge trophy, amber #F2CC8F cup on dark navy plinth, transparent background'), width: 12, height: 16 },
  { file: 'merge_trophy_large.png', prompt: p('large merge trophy, ornate amber #F2CC8F cup with handles on dark navy plinth, transparent background'), width: 16, height: 24 },

  // 03 — Room Props / Goose Coffee
  { file: 'goose_coffee_sign.png', prompt: p('hanging cafe sign reading "GOOSE COFFEE", warm amber #F2CC8F letters on dark navy plaque with chains, transparent background'), width: 32, height: 16 },
  { file: 'coffee_machine.png', prompt: p('countertop espresso machine, dark navy #2B2D42 housing with a single brass spout, transparent background'), width: 16, height: 20 },
  { file: 'coffee_mug.png', prompt: p('small ceramic coffee mug, amber #F2CC8F body with #6B4F3B coffee inside and steam wisp, transparent background'), width: 8, height: 10 },
  { file: 'steam_small.png', prompt: p('three small wispy steam curls, soft white with low alpha, transparent background'), width: 8, height: 12 },

  // 04 — Goose Sprites / Base
  { file: 'goose_idle.png', prompt: p('tiny pixel-art goose office worker sprite in idle pose, white body, orange beak and feet, readable silhouette, transparent background'), width: 16, height: 16 },
  { file: 'goose_walk_sheet.png', prompt: p('4-frame walk-cycle sheet of a tiny pixel-art goose office worker, frames arranged horizontally, transparent background'), width: 64, height: 16 },
  { file: 'goose_sit.png', prompt: p('tiny pixel-art goose office worker sprite seated at a desk, white body, orange beak, transparent background'), width: 16, height: 16 },
  { file: 'goose_think.png', prompt: p('tiny pixel-art goose office worker sprite in thinking pose with a small thought bubble above, transparent background'), width: 16, height: 20 },

  // 04 — Goose Sprites / Role Variants
  { file: 'goose_triage.png', prompt: p('tiny pixel-art goose sprite with a small clipboard accessory denoting Triage role, transparent background'), width: 16, height: 16 },
  { file: 'goose_investigator.png', prompt: p('tiny pixel-art goose sprite with a small magnifier accessory denoting Investigator role, transparent background'), width: 16, height: 16 },
  { file: 'goose_dev.png', prompt: p('tiny pixel-art goose sprite with a tiny laptop accessory denoting Dev role, transparent background'), width: 16, height: 16 },
  { file: 'goose_qa.png', prompt: p('tiny pixel-art goose sprite with a small scroll accessory denoting QA role, transparent background'), width: 16, height: 16 },
  { file: 'goose_reviewer.png', prompt: p('tiny pixel-art goose sprite with reading glasses denoting Reviewer role, transparent background'), width: 16, height: 16 },
  { file: 'goose_scout.png', prompt: p('tiny pixel-art goose sprite with a small explorer cap denoting Scout role, transparent background'), width: 16, height: 16 },
  { file: 'goose_ops.png', prompt: p('tiny pixel-art goose sprite with a small wrench accessory denoting Ops role, transparent background'), width: 16, height: 16 },

  // 04 — Goose Sprites / Overlay Variants
  { file: 'goose_spotlight.png', prompt: p('tiny pixel-art goose sprite under a soft amber spotlight halo, transparent background'), width: 16, height: 20 },
  { file: 'goose_blocked.png', prompt: p('tiny pixel-art goose sprite with a small red "blocked" badge floating above, transparent background'), width: 16, height: 20 },
  { file: 'goose_hero.png', prompt: p('tiny pixel-art goose sprite with a faint amber #F2CC8F hero glow halo, transparent background'), width: 16, height: 20 },

  // 05 — Ticket Assets
  { file: 'ticket_normal.png', prompt: p('pixel-art software work ticket card, amber #F2CC8F body, dark navy text lines, subtle outline, transparent background'), width: 16, height: 12 },
  { file: 'ticket_hero.png', prompt: p('pixel-art hero ticket card with amber #F2CC8F body and a bright cyan #6FE7FF glow rim, transparent background'), width: 16, height: 12 },
  { file: 'ticket_failed.png', prompt: p('pixel-art failed ticket card, amber body with a red #FF6B6B FAIL stamp diagonal, transparent background'), width: 16, height: 12 },
  { file: 'ticket_done.png', prompt: p('pixel-art done ticket card, amber body with a green #8BD17C check stamp, transparent background'), width: 16, height: 12 },
  { file: 'ticket_retry.png', prompt: p('pixel-art retry ticket card, amber body with a small circular arrow icon, transparent background'), width: 16, height: 12 },
  { file: 'ticket_queue_stack.png', prompt: p('pixel-art stack of 4 staggered ticket cards, amber #F2CC8F bodies, dark outlines, transparent background'), width: 20, height: 16 },
  { file: 'ticket_glow_overlay.png', prompt: p('pixel-art rounded glow halo around a ticket-card footprint, amber #F2CC8F with alpha falloff, transparent background'), width: 20, height: 16 },

  // 06 — HUD / UI / Speech & Thought
  { file: 'speech_bubble_small.png', prompt: p('small pixel-art speech bubble, amber #F2CC8F fill, dark navy outline, three dots inside, transparent background'), width: 14, height: 12 },
  { file: 'thought_bubble_small.png', prompt: p('small pixel-art cloud thought bubble, amber #F2CC8F fill, dark navy outline, trailing dots, transparent background'), width: 14, height: 14 },
  { file: 'question_bubble_small.png', prompt: p('small pixel-art speech bubble with a bold question mark inside, amber fill, transparent background'), width: 14, height: 12 },

  // 06 — HUD / UI / Indicators
  { file: 'blocked_icon.png', prompt: p('small pixel-art red #FF6B6B blocked icon, octagon with a slash, dark navy outline, transparent background'), width: 12, height: 12 },
  { file: 'convergence_icon.png', prompt: p('small pixel-art cyan #6FE7FF convergence target reticle icon, dark navy outline, transparent background'), width: 12, height: 12 },
  { file: 'retry_badge.png', prompt: p('small pixel-art retry badge, amber #F2CC8F circular arrow on dark navy circle, transparent background'), width: 12, height: 12 },
  { file: 'queue_badge.png', prompt: p('small pixel-art queue badge with a numeric slot, amber #F2CC8F on dark navy, transparent background'), width: 14, height: 12 },
  { file: 'hero_badge.png', prompt: p('small pixel-art hero star badge, amber #F2CC8F star on dark navy disc, transparent background'), width: 12, height: 12 },
  { file: 'merge_check.png', prompt: p('small pixel-art merged checkmark badge, green #8BD17C check on dark navy disc, transparent background'), width: 12, height: 12 },

  // 06 — HUD / UI / Panels
  { file: 'hero_ticket_popup.png', prompt: p('hero-ticket popup panel frame, dark navy #2B2D42 background with amber #F2CC8F border and corner accents, transparent background'), width: 64, height: 32 },
  { file: 'queue_counter_panel.png', prompt: p('small queue counter panel frame, dark navy #2B2D42 background with amber #F2CC8F edge, transparent background'), width: 32, height: 16 },
  { file: 'retry_counter_panel.png', prompt: p('small retry counter panel frame, dark navy #2B2D42 background with red #FF6B6B edge, transparent background'), width: 32, height: 16 },
  { file: 'convergence_panel.png', prompt: p('convergence percentage panel frame, dark navy #2B2D42 background with cyan #6FE7FF edge and gauge slot, transparent background'), width: 48, height: 24 },

  // 06 — HUD / UI / Event Feed
  { file: 'event_feed_bg.png', prompt: p('event-feed panel background tile, dark navy #2B2D42 with subtle vertical scanlines, tiles vertically'), width: 32, height: 16 },
  { file: 'event_feed_row.png', prompt: p('single event-feed row frame, dark navy #2B2D42 with a thin amber #F2CC8F left border, tiles horizontally'), width: 32, height: 8 },

  // 07 — Effects / Overlays
  { file: 'monitor_glow_overlay.png', prompt: p('soft cyan #6FE7FF monitor glow overlay, transparent background, radial alpha falloff'), width: 16, height: 16 },
  { file: 'room_heat_overlay_low.png', prompt: p('room heat overlay tint, faint amber #F2CC8F low-intensity, transparent background'), width: 32, height: 32 },
  { file: 'room_heat_overlay_high.png', prompt: p('room heat overlay tint, strong red #FF6B6B high-intensity, transparent background'), width: 32, height: 32 },
  { file: 'merge_particle.png', prompt: p('single small merge celebration particle, amber #F2CC8F sparkle with soft halo, transparent background'), width: 8, height: 8 },
  { file: 'qa_failure_flash.png', prompt: p('full-room QA failure flash overlay, red #FF6B6B with alpha falloff to edges, transparent background'), width: 32, height: 32 },
  { file: 'glow_soft.png', prompt: p('generic soft warm glow halo, amber #F2CC8F radial alpha falloff, transparent background'), width: 16, height: 16 },
  { file: 'spotlight_overlay.png', prompt: p('downward cone spotlight overlay, soft amber #F2CC8F with alpha falloff, transparent background'), width: 24, height: 32 },

  // 08 — Ambient
  { file: 'rain_window_overlay.png', prompt: p('rainy window overlay tile, dark navy with subtle streaks and faint cyan reflections, transparent background, tiles seamlessly'), width: 32, height: 32 },
  { file: 'rain_streak_overlay.png', prompt: p('diagonal rain streak overlay, light cyan #6FE7FF strokes on transparent background, tiles vertically'), width: 32, height: 32 },
  { file: 'ambient_shadow_soft.png', prompt: p('soft ambient shadow overlay, dark navy #2B2D42 with radial alpha falloff, transparent background'), width: 32, height: 32 },
  { file: 'lamp_glow_soft.png', prompt: p('soft amber #F2CC8F lamp glow halo, low intensity, transparent background'), width: 24, height: 24 },
  { file: 'lamp_glow_warm.png', prompt: p('warm amber #F2CC8F lamp glow halo, higher intensity, transparent background'), width: 24, height: 24 },

  // 09 — Typography / Labels
  { file: 'room_label_triage.png', prompt: p('horizontal room-label banner reading "TRIAGE" in amber #F2CC8F pixel letters on dark navy plaque, transparent background'), width: 48, height: 12 },
  { file: 'room_label_investigation.png', prompt: p('horizontal room-label banner reading "INVESTIGATION" in amber #F2CC8F pixel letters on dark navy plaque, transparent background'), width: 64, height: 12 },
  { file: 'room_label_library.png', prompt: p('horizontal room-label banner reading "LIBRARY" in amber #F2CC8F pixel letters on dark navy plaque, transparent background'), width: 48, height: 12 },
  { file: 'room_label_dev.png', prompt: p('horizontal room-label banner reading "DEV" in amber #F2CC8F pixel letters on dark navy plaque, transparent background'), width: 32, height: 12 },
  { file: 'room_label_qa.png', prompt: p('horizontal room-label banner reading "QA" in amber #F2CC8F pixel letters on dark navy plaque, transparent background'), width: 32, height: 12 },
  { file: 'room_label_review.png', prompt: p('horizontal room-label banner reading "REVIEW" in amber #F2CC8F pixel letters on dark navy plaque, transparent background'), width: 48, height: 12 },
  { file: 'room_label_done.png', prompt: p('horizontal room-label banner reading "DONE" in amber #F2CC8F pixel letters on dark navy plaque, transparent background'), width: 32, height: 12 },
  { file: 'room_label_archive.png', prompt: p('horizontal room-label banner reading "ARCHIVE" in amber #F2CC8F pixel letters on dark navy plaque, transparent background'), width: 48, height: 12 },
];

function pixellabImageSize(spec: AssetSpec): { width: number; height: number } {
  return {
    width: Math.max(spec.width, 32),
    height: Math.max(spec.height, 32),
  };
}

async function generate(spec: AssetSpec, apiKey: string): Promise<Uint8Array> {
  const imageSize = pixellabImageSize(spec);
  const res = await fetch(`${API_BASE}/generate-image-pixflux`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      description: spec.prompt,
      image_size: imageSize,
      no_background: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PixelLab API ${res.status} for ${spec.file}: ${text}`);
  }
  const json = (await res.json()) as { image?: { base64?: string }; image_base64?: string };
  const b64 = json.image?.base64 ?? json.image_base64;
  if (b64 == null) throw new Error(`PixelLab response missing image for ${spec.file}`);
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

async function pathExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.size > 0;
  } catch {
    return false;
  }
}

interface RunResult {
  file: string;
  ok: boolean;
  bytes?: number;
  error?: string;
}

async function runOne(spec: AssetSpec, apiKey: string, outDir: string): Promise<RunResult> {
  try {
    const bytes = await generate(spec, apiKey);
    await writeFile(resolve(outDir, spec.file), bytes);
    return { file: spec.file, ok: true, bytes: bytes.byteLength };
  } catch (err) {
    return { file: spec.file, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function runBounded(
  specs: readonly AssetSpec[],
  apiKey: string,
  outDir: string,
  concurrency: number,
): Promise<RunResult[]> {
  const queue = [...specs];
  const results: RunResult[] = [];
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const spec = queue.shift();
      if (spec == null) return;
      process.stdout.write(`  ${spec.file} … `);
      const r = await runOne(spec, apiKey, outDir);
      results.push(r);
      console.log(r.ok ? `${r.bytes} bytes` : `FAILED — ${r.error}`);
    }
  }
  const n = Math.max(1, Math.min(concurrency, specs.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

function parseArgs(argv: readonly string[]): { force: boolean; files: string[] } {
  let force = false;
  const files: string[] = [];
  for (const a of argv) {
    if (a === '--force') {
      force = true;
    } else if (a.startsWith('-')) {
      // ignore other flags for forwards compat
    } else {
      files.push(a);
    }
  }
  return { force, files };
}

async function main(): Promise<void> {
  const apiKey = process.env.PIXELLAB_API_KEY;
  if (apiKey == null || apiKey.length === 0) {
    console.error('Set PIXELLAB_API_KEY (in .env or shell) — get a key at https://api.pixellab.ai/mcp');
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });

  const { force, files } = parseArgs(process.argv.slice(2));
  const allSpecs: AssetSpec[] = [...MANIFEST, ...ASSET_MANIFEST];

  let specs: AssetSpec[];
  if (files.length > 0) {
    const known = new Map(allSpecs.map((s) => [s.file, s] as const));
    const missing: string[] = [];
    specs = [];
    for (const f of files) {
      const s = known.get(f);
      if (s != null) specs.push(s);
      else missing.push(f);
    }
    if (missing.length > 0) {
      console.error(`Unknown asset(s): ${missing.join(', ')}`);
      process.exit(1);
    }
  } else {
    specs = allSpecs;
  }

  if (!force) {
    const filtered: AssetSpec[] = [];
    for (const s of specs) {
      if (await pathExists(resolve(OUT_DIR, s.file))) {
        console.log(`  ${s.file} … SKIP (exists; use --force to regenerate)`);
      } else {
        filtered.push(s);
      }
    }
    specs = filtered;
  }

  if (specs.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  console.log(`Generating ${specs.length} asset(s) into ${OUT_DIR} (concurrency=${CONCURRENCY})`);
  const results = await runBounded(specs, apiKey, OUT_DIR, CONCURRENCY);
  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log(`Done. ${ok}/${results.length} succeeded.`);
  if (failed.length > 0) {
    console.log('Failures:');
    for (const r of failed) console.log(`  - ${r.file}: ${r.error}`);
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
