
# Asset Manifest

Progress markers per asset:
- `- [ ]` = not yet generated. Eligible for the next loop iteration.
- `- [x]` = generated, file exists under `apps/web/public/office/`, registered in `pngManifest()`, and a Playwright pass verified Phaser loaded the texture.
- `- [!]` = generation or wiring failed previously. Skipped until a manual rerun flips it back to `- [ ]`.

Section 10 ("Optional Later Assets — DEFERRED") is intentionally NOT checkboxed so the loop skips it.

---

## 01 — Core Tiles

### Floors
- [!] floor_tile_01.png
- [!] floor_tile_02.png
- [!] corridor_tile_01.png
- [!] corridor_tile_02.png
- [ ] floor_shadow_edge.png
- [ ] carpet_trim_horizontal.png
- [ ] carpet_trim_vertical.png

### Walls
- [ ] wall_dark_01.png
- [ ] wall_dark_02.png
- [ ] wall_corner_inner.png
- [ ] wall_corner_outer.png
- [ ] wall_trim_top.png
- [ ] wall_trim_bottom.png

### Special Walls
- [ ] frosted_glass_wall.png
- [ ] frosted_glass_door_closed.png
- [ ] frosted_glass_door_open.png
- [ ] sealed_wall_blue.png
- [ ] sealed_wall_green.png

---

## 02 — Corridor Assets

- [ ] corridor_light_pool.png
- [ ] corridor_pulse_red.png
- [ ] corridor_pulse_green.png
- [ ] movement_trail_blue.png
- [ ] movement_trail_red.png
- [ ] movement_trail_green.png
- [ ] movement_trail_yellow.png

---

## 03 — Room Props

### Triage
- [ ] desk_triage.png
- [ ] intake_board.png
- [ ] paperwork_stack.png
- [ ] queue_stack_small.png
- [ ] queue_stack_large.png

### Investigation
- [ ] desk_investigation.png
- [ ] investigation_monitor.png
- [ ] investigation_map_board.png
- [ ] bookshelf_small.png
- [ ] bookshelf_large.png

### Sealed Library
- [ ] library_terminal.png
- [ ] convergence_core.png
- [ ] glowing_convergence_ring.png
- [ ] scout_report_stack.png
- [ ] sealed_slot_library.png

### Dev
- [ ] desk_dev_single.png
- [ ] desk_dev_dual.png
- [ ] dev_monitor_single.png
- [ ] dev_monitor_dual.png
- [ ] keyboard_glow.png
- [ ] desk_lamp.png

### QA
- [ ] qa_station.png
- [ ] retry_counter_frame.png
- [ ] verdict_scroll_printer.png
- [ ] qa_input_slot.png
- [ ] qa_output_slot.png
- [ ] qa_warning_light.png

### Review
- [ ] review_table.png
- [ ] review_chair.png
- [ ] convergence_counter.png
- [ ] quality_score_gauge.png
- [ ] review_glass_overlay.png

### Done / Archive
- [ ] done_shelf.png
- [ ] archive_shelf.png
- [ ] archive_drawer.png
- [ ] merge_trophy_small.png
- [ ] merge_trophy_large.png

### Goose Coffee
- [ ] goose_coffee_sign.png
- [ ] coffee_machine.png
- [ ] coffee_mug.png
- [ ] steam_small.png

---

## 04 — Goose Sprites

### Base
- [ ] goose_idle.png
- [ ] goose_walk_sheet.png
- [ ] goose_sit.png
- [ ] goose_think.png

### Role Variants
- [ ] goose_triage.png
- [ ] goose_investigator.png
- [ ] goose_dev.png
- [ ] goose_qa.png
- [ ] goose_reviewer.png
- [ ] goose_scout.png
- [ ] goose_ops.png

### Overlay Variants
- [ ] goose_spotlight.png
- [ ] goose_blocked.png
- [ ] goose_hero.png

---

## 05 — Ticket Assets

- [ ] ticket_normal.png
- [ ] ticket_hero.png
- [ ] ticket_failed.png
- [ ] ticket_done.png
- [ ] ticket_retry.png
- [ ] ticket_queue_stack.png
- [ ] ticket_glow_overlay.png

---

## 06 — HUD / UI

### Speech / Thought
- [ ] speech_bubble_small.png
- [ ] thought_bubble_small.png
- [ ] question_bubble_small.png

### Indicators
- [ ] blocked_icon.png
- [ ] convergence_icon.png
- [ ] retry_badge.png
- [ ] queue_badge.png
- [ ] hero_badge.png
- [ ] merge_check.png

### Panels
- [ ] hero_ticket_popup.png
- [ ] queue_counter_panel.png
- [ ] retry_counter_panel.png
- [ ] convergence_panel.png

### Event Feed
- [ ] event_feed_bg.png
- [ ] event_feed_row.png

---

## 07 — Effects / Overlays

- [ ] monitor_glow_overlay.png
- [ ] room_heat_overlay_low.png
- [ ] room_heat_overlay_high.png
- [ ] merge_particle.png
- [ ] qa_failure_flash.png
- [ ] glow_soft.png
- [ ] spotlight_overlay.png

---

## 08 — Ambient

- [ ] rain_window_overlay.png
- [ ] rain_streak_overlay.png
- [ ] ambient_shadow_soft.png
- [ ] lamp_glow_soft.png
- [ ] lamp_glow_warm.png

---

## 09 — Typography / Labels

- [ ] room_label_triage.png
- [ ] room_label_investigation.png
- [ ] room_label_library.png
- [ ] room_label_dev.png
- [ ] room_label_qa.png
- [ ] room_label_review.png
- [ ] room_label_done.png
- [ ] room_label_archive.png

---

## 10 — Optional Later Assets (DEFERRED)

- animated_walk_cycle_8frame.png
- particle_smoke.png
- janitor_bot.png
- watchtower_beacon.png
- corkboard_notes.png
