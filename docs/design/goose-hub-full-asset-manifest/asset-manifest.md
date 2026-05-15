
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
- [!] floor_shadow_edge.png
- [!] carpet_trim_horizontal.png
- [!] carpet_trim_vertical.png

### Walls
- [!] wall_dark_01.png
- [x] wall_dark_02.png
- [x] wall_corner_inner.png
- [x] wall_corner_outer.png
- [x] wall_trim_top.png
- [x] wall_trim_bottom.png

### Special Walls
- [x] frosted_glass_wall.png
- [x] frosted_glass_door_closed.png
- [x] frosted_glass_door_open.png
- [x] sealed_wall_blue.png
- [x] sealed_wall_green.png

---

## 02 — Corridor Assets

- [x] corridor_light_pool.png
- [x] corridor_pulse_red.png
- [x] corridor_pulse_green.png
- [x] movement_trail_blue.png
- [x] movement_trail_red.png
- [x] movement_trail_green.png
- [x] movement_trail_yellow.png

---

## 03 — Room Props

### Triage
- [x] desk_triage.png
- [x] intake_board.png
- [x] paperwork_stack.png
- [x] queue_stack_small.png
- [x] queue_stack_large.png

### Investigation
- [x] desk_investigation.png
- [x] investigation_monitor.png
- [x] investigation_map_board.png
- [x] bookshelf_small.png
- [x] bookshelf_large.png

### Sealed Library
- [x] library_terminal.png
- [x] convergence_core.png
- [x] glowing_convergence_ring.png
- [x] scout_report_stack.png
- [x] sealed_slot_library.png

### Dev
- [x] desk_dev_single.png
- [x] desk_dev_dual.png
- [x] dev_monitor_single.png
- [x] dev_monitor_dual.png
- [x] keyboard_glow.png
- [x] desk_lamp.png

### QA
- [x] qa_station.png
- [x] retry_counter_frame.png
- [x] verdict_scroll_printer.png
- [x] qa_input_slot.png
- [x] qa_output_slot.png
- [x] qa_warning_light.png

### Review
- [x] review_table.png
- [x] review_chair.png
- [x] convergence_counter.png
- [x] quality_score_gauge.png
- [x] review_glass_overlay.png

### Done / Archive
- [x] done_shelf.png
- [x] archive_shelf.png
- [x] archive_drawer.png
- [x] merge_trophy_small.png
- [x] merge_trophy_large.png

### Goose Coffee
- [x] goose_coffee_sign.png
- [x] coffee_machine.png
- [x] coffee_mug.png
- [x] steam_small.png

---

## 04 — Goose Sprites

### Base
- [x] goose_idle.png
- [x] goose_walk_sheet.png
- [x] goose_sit.png
- [x] goose_think.png

### Role Variants
- [x] goose_triage.png
- [x] goose_investigator.png
- [x] goose_dev.png
- [x] goose_qa.png
- [x] goose_reviewer.png
- [x] goose_scout.png
- [x] goose_ops.png

### Overlay Variants
- [x] goose_spotlight.png
- [x] goose_blocked.png
- [x] goose_hero.png

---

## 05 — Ticket Assets

- [x] ticket_normal.png
- [x] ticket_hero.png
- [x] ticket_failed.png
- [x] ticket_done.png
- [x] ticket_retry.png
- [x] ticket_queue_stack.png
- [x] ticket_glow_overlay.png

---

## 06 — HUD / UI

### Speech / Thought
- [x] speech_bubble_small.png
- [x] thought_bubble_small.png
- [x] question_bubble_small.png

### Indicators
- [x] blocked_icon.png
- [x] convergence_icon.png
- [x] retry_badge.png
- [x] queue_badge.png
- [x] hero_badge.png
- [x] merge_check.png

### Panels
- [x] hero_ticket_popup.png
- [x] queue_counter_panel.png
- [x] retry_counter_panel.png
- [x] convergence_panel.png

### Event Feed
- [x] event_feed_bg.png
- [x] event_feed_row.png

---

## 07 — Effects / Overlays

- [x] monitor_glow_overlay.png
- [x] room_heat_overlay_low.png
- [x] room_heat_overlay_high.png
- [x] merge_particle.png
- [x] qa_failure_flash.png
- [x] glow_soft.png
- [x] spotlight_overlay.png

---

## 08 — Ambient

- [x] rain_window_overlay.png
- [x] rain_streak_overlay.png
- [x] ambient_shadow_soft.png
- [x] lamp_glow_soft.png
- [x] lamp_glow_warm.png

---

## 09 — Typography / Labels

- [x] room_label_triage.png
- [x] room_label_investigation.png
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
