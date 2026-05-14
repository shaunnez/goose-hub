# Office Mode Vertical Slice v1 — Phase 2.5: Visual Canon Adoption

**Status:** Specified. Inserted retroactively between Phase 2 (merged) and
Phase 3 (in flight). Implementation may run in parallel with Phase 3
because the two phases touch disjoint code: Phase 2.5 changes art
assets + procedural palette; Phase 3 changes sprite-class structure.

**Goal:** Bring the rendered office in line with Board 06's visual
canon. Today the procedural textures in `game/textures.ts` use an
ad-hoc palette, and the PixelLab manifest in
`scripts/generate-office-assets.ts` covers only 11 small assets. The
result: the runtime office looks nothing like the design pack.

Phase 2.5 closes that gap **without** introducing atmospheric polish
(lighting, mode tinting, ambient props — those remain post-v1).

This is a **visual fidelity** phase, not a behaviour or geometry
phase. Coordinates, layers, anchors, state mapping — all unchanged.
The same scene now just **renders** with the canonical palette and a
richer sprite catalogue.

---

## 1. Scope

### In scope

- Replace the ad-hoc palette in `apps/web/src/components/office/game/textures.ts`
  with Board 06's canonical palette. Procedural textures regenerate
  to match.
- Expand the PixelLab manifest in `scripts/generate-office-assets.ts`
  to cover the v1 sprite catalogue (~30 entries). Bake Board 06 hex
  codes into every prompt so PixelLab outputs land in the canonical
  palette.
- Extend `asset-loader.ts`'s probe manifest to cover every new key.
- Regenerate the bundle (`pnpm gen:office-assets`), commit the PNGs
  to `apps/web/public/office/`.
- Manual verification: dev-server office view matches Board 02 + Board
  06 references at a glance.
- Update `apps/web/src/components/office/README.md` to point at the
  Board 06 palette as the source of truth for tints.
- (Optional) Update Board 06's design-spec to add any palette
  refinements discovered during regeneration. Not required for the
  PR; if you do it, single ADR entry.

### Out of scope (post-v1)

- Atmospheric polish: night palette, mode-driven global tinting,
  rain, ambient janitor / coffee machine, weather, lighting overlays.
  All Boards 09–12 territory.
- Animated states (sprite-sheet walk cycles, idle bobs, talking
  mouth, working hand). The slice continues to render single-frame
  sprites that slide.
- Room-specific palette variants beyond what Board 02 calls out
  (frosted-blue QA, frosted-grey Review). No per-room mood lighting.
- TDD-heartbeat glyphs.
- Tool-call micro-animations.
- HUD overlays (counters, dials, feed) — Phase 6.
- Cinematic-specific particles / glow rings — generated during Phase 5
  alongside the cinematic that uses them, so prompts can be tuned for
  timing/feel.
- New behaviour, new layers, new event flows. Phase 2.5 is render
  fidelity only.

If you find yourself touching anything in "out of scope," stop.

---

## 2. Why this phase exists

Phase 2 adopted Board 02's spatial canon (6 rooms on a 1280×384
floor). That work was correct geometry but used whatever colours the
procedural texture generator already produced. Board 06 — the visual
system spec — was never enforced in code.

Specifically:

- `textures.ts:PALETTE` uses values like `floor: 0x2a2333`, `wall:
  0x4a3a5e`. Board 06 specifies `Floor #3A3D5C`, `Wall #2B2D42`. No
  cross-reference.
- The PixelLab manifest in `generate-office-assets.ts` is 11 entries:
  floor tiles, wall, desk, stairs, 6 indicators. Missing: persona
  body sprite, ticket card, scroll variant, envelope variant, door
  frames, slot frames, frosted walls (QA / Review), shelf back,
  scout desk, QualityScore dial frame, retry-counter frame,
  banner / queue card tiers.
- Prompts in the manifest do not reference Board 06 hex codes, so
  even when assets are generated they drift from the canon.

The result is a working scene that looks unrelated to the design pack
the user is reviewing. Closing this gap before Phase 3 visual work
lands means every later cinematic animates against canonical art.

---

## 3. Target file structure (after Phase 2.5)

```
apps/web/
  public/office/                       # PNGs land here when pnpm gen runs
    floor-tile.png                     # existing key set, regenerated with palette
    floor-tile-alt.png
    wall-tile.png
    wall-frosted-blue.png              # NEW — QA wall variant
    wall-frosted-grey.png              # NEW — Review wall variant
    desk.png
    desk-lamp-on.png                   # NEW — phase 4/5 desk lamp on state
    desk-lamp-off.png                  # NEW — desk lamp off
    door-closed.png                    # NEW — generic door frame, closed
    door-open.png                      # NEW — generic door frame, open
    slot-frame.png                     # NEW — slot opening frame
    shelf-back.png                     # NEW — Done shelf back wall
    scout-desk.png                     # NEW — Library scout desk
    score-dial-frame.png               # NEW — QualityScore dial face
    score-dial-needle.png              # NEW — dial needle (Phase 6+)
    retry-counter-frame.png            # NEW — retry counter housing
    banner-frame.png                   # NEW — banner cell border (optional; Text+rect ok)
    stairs.png
    persona-body-base.png              # NEW — goose body (tinted per role at runtime)
    persona-head-base.png              # NEW — goose head (tinted per role)
    ticket-card.png                    # NEW — default ticket sprite (replaces phase-3 procedural)
    ticket-scroll.png                  # NEW — scroll variant (Phase 5 uses)
    ticket-envelope.png                # NEW — envelope variant (Phase 5 uses)
    queue-stack-1.png                  # NEW — depth tier 1
    queue-stack-2.png                  # NEW — tier 2
    queue-stack-3.png                  # NEW — tier 3
    queue-stack-many.png               # NEW — tier 4
    indicator-speech.png               # existing
    indicator-thought.png              # existing
    indicator-question.png             # existing
    indicator-coffee.png               # existing
    indicator-bang.png                 # existing
    indicator-check.png                # existing
  src/components/office/
    README.md                           # ADJUSTED — point at Board 06 + this doc
    game/
      asset-loader.ts                   # ADJUSTED — probe manifest expanded to ~30 keys
      textures.ts                       # ADJUSTED — PALETTE → Board 06 hex codes
scripts/
  generate-office-assets.ts             # ADJUSTED — MANIFEST expanded to ~30 specs;
                                        # every prompt embeds Board 06 hex codes
docs/design/office-mode/
  vertical-slice-v1/
    README.md                           # ADJUSTED — roadmap table inserts Phase 2.5
    phase-2.5-visual-canon-adoption.md  # this file
```

No new modules. No code architecture change. Existing `asset-loader.ts`
auto-prefers PNGs when present (per its current code path), so the
runtime picks up new assets without scene changes.

---

## 4. Board 06 palette → code mapping

The single source of truth. Phase 2.5 wires `textures.ts:PALETTE` and
`generate-office-assets.ts` prompts to these values, exactly.

### 4.0 Canonical base palette (8 entries)

These eight hex codes are the canonical Board 06 palette. Verbatim
from `06-visual-system/design-spec.md`. Anything outside this set is
a derived shade (§4.1), a derived blend (§4.2), or a role tint
(§5.3) — and must be explicitly enumerated there.

| Concept                    | Board 06 hex | Hex literal (TS) | Used by                                          |
| -------------------------- | ------------ | ---------------- | ------------------------------------------------ |
| Background wall            | `#2B2D42`    | `0x2B2D42`       | wall tiles, room walls, outer walls               |
| Floor                      | `#3A3D5C`    | `0x3A3D5C`       | floor tiles (primary)                             |
| Desk wood                  | `#6B4F3B`    | `0x6B4F3B`       | desk surface, scout desks, lead desk              |
| Monitor glow (cyan)        | `#6FE7FF`    | `0x6FE7FF`       | desk monitor on state, dev lamp on, cyan accents |
| Amber light                | `#F2CC8F`    | `0xF2CC8F`       | warm lamp, budget-pressure tint, banner middle   |
| Failure red                | `#FF6B6B`    | `0xFF6B6B`       | retry counter, qa-failed indicators, scroll body |
| Success green              | `#8BD17C`    | `0x8BD17C`       | check indicators, merge pulse, dial-good zone    |
| Review purple              | `#D68FD6`    | `0xD68FD6`       | review-chamber tint, review indicators           |

### 4.1 Derived shades (3 entries)

Procedural textures sometimes need a slightly lighter / darker
companion shade for tile alternation, top edges, etc. Constrain
derivation to:

| Concept   | Hex literal (TS) | Derivation                            | Used by                          |
| --------- | ---------------- | ------------------------------------- | -------------------------------- |
| `floorAlt`| `0x42466A`       | `floor + 8% L (HSL)` from `#3A3D5C`   | floor-tile-alt (subtle stripe)   |
| `wallTop` | `0x3B3D55`       | `wall + 12% L` from `#2B2D42`         | 1-px highlight along wall north edge |
| `deskTop` | `0x85694F`       | `desk + 12% L` from `#6B4F3B`         | desk surface highlight           |

Do **not** invent new base colours. Anything outside the 8 canonical
entries (§4.0) + the 3 derived shades (§4.1) + the 2 derived blends
(§4.2) + the 12 role tints (§5.3) is a palette drift bug. **Total
allowable palette surface: 25 hex codes**, all enumerated in this
document.

### 4.2 Derived blends — frosted wall variants (2 entries)

Board 02 §4.4 + §4.5 specify QA = frosted-blue, Review = frosted-grey,
both translucent. Implementation:

| Concept             | Hex literal (TS) | Derivation                                         | Used by             |
| ------------------- | ---------------- | -------------------------------------------------- | ------------------- |
| `qaWall`            | `0x3F6B80`       | `#2B2D42` blended 60/40 with `#6FE7FF` (cool blue) | QA chamber walls    |
| `reviewWall`        | `0x473A55`       | `#2B2D42` blended 70/30 with `#D68FD6` (warm grey-purple) | Review chamber walls |

These two tinted textures replace the standard wall-tile within those
rooms. They are derived (canonical-blends), not free-choice colours.

---

## 5. PixelLab manifest expansion

`scripts/generate-office-assets.ts:MANIFEST` grows from 11 to ~30
entries. Each new entry follows the same pattern as existing ones —
file + prompt + size — with two new constraints.

### 5.1 Prompt template

Every prompt **must** include the Board 06 palette anchor. Recommended
template:

```
<noun phrase>, <perspective>, <key visual detail>,
palette: dark wall #2B2D42, floor #3A3D5C, cyan glow #6FE7FF,
amber #F2CC8F, fail red #FF6B6B, success green #8BD17C,
pixel art, <size> px
```

PixelLab respects palette anchors well in practice; without them the
generator drifts.

### 5.2 New manifest entries

Suggested set. Adjust naming to match `TEXTURE_KEYS` in `textures.ts`.

| File                       | Size  | Prompt seed                                                                                  |
| -------------------------- | ----- | -------------------------------------------------------------------------------------------- |
| floor-tile.png             | 16    | "top-down dark navy office carpet tile, seamless, palette: floor #3A3D5C, pixel art, 16×16" |
| floor-tile-alt.png         | 16    | "top-down dark navy office carpet tile, slightly lighter alt stripe, palette: #42466A, pixel art, 16×16" |
| wall-tile.png              | 16    | "top-down purple wall tile with shadow at base, palette: wall #2B2D42, pixel art, 16×16"   |
| wall-frosted-blue.png      | 16    | "top-down translucent frosted-blue wall tile, palette: #3F6B80 with cyan #6FE7FF inner glow, pixel art, 16×16" |
| wall-frosted-grey.png      | 16    | "top-down translucent frosted purple-grey wall tile, palette: #473A55 with hint of purple #D68FD6, pixel art, 16×16" |
| desk.png                   | 32    | "top-down brown wood office desk with cyan glowing monitor screen, palette: desk #6B4F3B, monitor #6FE7FF, pixel art, 32×24" |
| desk-lamp-on.png           | 16    | "small amber desk lamp glowing warm light, palette: amber #F2CC8F over wood #6B4F3B, pixel art, 16×16" |
| desk-lamp-off.png          | 16    | "small dim desk lamp, off, palette: muted wood #6B4F3B, pixel art, 16×16"                  |
| door-closed.png            | 32    | "top-down doorframe in purple wall, closed door, palette: wall #2B2D42, accent #6FE7FF, pixel art, 32×16" |
| door-open.png              | 32    | "top-down doorframe in purple wall, doorway open showing interior, palette: wall #2B2D42, floor #3A3D5C inside, pixel art, 32×16" |
| slot-frame.png             | 32    | "top-down narrow rectangular wall slot opening for cards, palette: wall #2B2D42, cyan inner edge #6FE7FF, pixel art, 32×16" |
| shelf-back.png             | 80    | "top-down wall-mounted wooden shelf back with 5 slots, palette: wood #6B4F3B over wall #2B2D42, pixel art, 80×16" |
| scout-desk.png             | 24    | "small top-down library reading desk, modest pixel art, palette: wood #6B4F3B on floor #3A3D5C, 24×16" |
| score-dial-frame.png       | 32    | "top-down circular gauge dial with tick marks, no needle, palette: brass over wall #2B2D42, fail red #FF6B6B → amber #F2CC8F → success green #8BD17C gradient ticks, pixel art, 32×32" |
| score-dial-needle.png      | 32    | "small thin gauge needle pointing up, palette: cyan #6FE7FF over transparent background, pixel art, 32×32" |
| retry-counter-frame.png    | 24    | "small rectangular numeric counter display housing, palette: wall #2B2D42 with fail red #FF6B6B border, pixel art, 24×16" |
| banner-frame.png           | 64    | "horizontal banner sign frame, palette: wall #2B2D42 with cyan #6FE7FF edge, pixel art, 64×24" |
| stairs.png                 | 32    | (existing — keep)                                                                            |
| persona-body-base.png      | 16    | "top-down adorable cartoon goose body, white feathers, palette: cream + soft shadow on floor #3A3D5C, pixel art, 16×16, transparent background" |
| persona-head-base.png      | 16    | "top-down adorable cartoon goose head with orange beak, palette: white feathers + amber #F2CC8F beak, pixel art, 16×16, transparent background" |
| ticket-card.png            | 16    | "small folded paper ticket card with corner clip, palette: amber #F2CC8F card with cyan #6FE7FF accent, pixel art, 16×16, transparent background" |
| ticket-scroll.png          | 16    | "small rolled scroll of paper, palette: fail red #FF6B6B with parchment, pixel art, 16×16, transparent background" |
| ticket-envelope.png        | 16    | "small sealed envelope with wax seal, palette: cream paper with cyan #6FE7FF wax seal, pixel art, 16×16, transparent background" |
| queue-stack-1.png          | 16    | "single small paper card lying on floor, palette: amber #F2CC8F, pixel art, 16×16, transparent" |
| queue-stack-2.png          | 16    | "small stack of 2 paper cards, palette: amber #F2CC8F, pixel art, 16×16, transparent"     |
| queue-stack-3.png          | 16    | "small stack of 3 paper cards, palette: amber #F2CC8F, pixel art, 16×16, transparent"     |
| queue-stack-many.png       | 16    | "small stack of 4+ paper cards with subtle red overflow tint, palette: amber #F2CC8F + fail red #FF6B6B edge, pixel art, 16×16, transparent" |
| indicator-speech.png       | 16    | (existing — keep, regenerate with palette anchor for consistency)                          |
| indicator-thought.png      | 16    | (existing — keep, regenerate)                                                              |
| indicator-question.png     | 16    | (existing — keep, regenerate)                                                              |
| indicator-coffee.png       | 16    | (existing — keep, regenerate)                                                              |
| indicator-bang.png         | 16    | (existing — keep, regenerate)                                                              |
| indicator-check.png        | 16    | (existing — keep, regenerate)                                                              |

Total: ~30 assets. Hobby-tier PixelLab credit budget should be fine
for a single run.

### 5.3 Per-role persona tinting — enumerated extension (12 entries)

Phase 2.5 ships **one** persona body PNG. Per-role colour variation
happens at runtime via `Phaser.GameObjects.Image.setTint(0xRRGGBB)`.

The 12 roles need 12 distinct, glanceable tints. The 8-entry canonical
palette (§4.0) has only 5 chromatic entries (cyan / amber / fail red /
success green / review purple) suitable as tint hues — not enough for
12 distinct roles. Phase 2.5 therefore **carves out a single enumerated
extension table of 12 role tints** (below) that is treated as part of
the canonical palette surface for the purpose of palette-drift checks.

Constraint on these 12 entries: each must either be a canonical hue
(§4.0) reused as-is, or a near-neighbour of one (same Board 06 hue
family, ±20° H, ±15% S, ±15% L). New hue families are forbidden.

| Role             | Tint hex      | Relationship to canonical             |
| ---------------- | ------------- | ------------------------------------- |
| triager          | `0xA78BFA`    | neighbour of review purple `#D68FD6`  |
| griller          | `0xF2CC8F`    | amber (canonical, reused as-is)       |
| prd-writer       | `0xF59E0B`    | neighbour of amber                    |
| decomposer       | `0x8BD17C`    | success green (canonical, reused)     |
| researcher       | `0x6FE7FF`    | monitor cyan (canonical, reused)      |
| investigator     | `0x7DD3FC`    | neighbour of cyan (lighter)           |
| developer        | `0x34D399`    | neighbour of success green (cooler)   |
| dev-reviewer     | `0xA7F3D0`    | neighbour of success green (paler)    |
| qa               | `0xFF6B6B`    | fail red (canonical, reused)          |
| reviewer         | `0xD68FD6`    | review purple (canonical, reused)     |
| retrospector     | `0xC084FC`    | neighbour of review purple            |
| auditor          | `0xFBBF24`    | neighbour of amber (warmer)           |

This table is the **only** carve-out from the canonical palette in
Phase 2.5. Total allowable palette surface remains as stated in §4.1:
8 canonical + 3 derived + 2 derived blends + 12 role tints = 25 hex
codes, all enumerated in this document. Any per-role colour outside
this table is a palette drift bug.

Codify in `textures.ts` as a single exported `ROLE_TINTS` constant.
Replace any per-role colour usage in `textures.ts` or elsewhere with
imports of this constant.

---

## 6. `asset-loader.ts` expansion

The probe manifest in `asset-loader.ts:pngManifest()` grows to mirror
`TEXTURE_KEYS`. Existing logic — HEAD-probe, MIME check, fallback —
unchanged. Add one entry per new key from §3.

If `TEXTURE_KEYS` has a key that isn't in the probe manifest, the
runtime silently falls through to the procedural generator for that
key. That's the correct fallback, but for v1 we want every key
generated. Acceptance criteria assert exhaustive coverage (§9).

---

## 7. `textures.ts` repalette

Three concrete edits:

1. **Rewrite the `PALETTE` const** to the §4 hex values. Drop
   per-role sprite colours from `PALETTE` into a separate
   exported `ROLE_TINTS` const per §5.3.
2. **Re-tune every procedural generator** to call the new palette
   constants. Targets: floor tile, floor tile alt, wall tile, desk,
   stairs, sprite base, six indicators, plus the Phase 3 ticket +
   queue-stack textures already wired and the Phase 5 scroll /
   envelope variants. Behaviour-preserving: same shape, same size,
   new colours.
3. **Add procedural fallbacks for new keys** introduced in §3 (door,
   slot frame, frosted walls, shelf back, scout desk, dial frame,
   etc.). Each fallback is a few `fillRect` calls — they need only
   look "right enough" until the PixelLab PNG is dropped in. They
   must not introduce non-palette colours.

No new file, no new module. Single file rewrite.

---

## 8. Sequence of edits

Each step compiles independently if you stop after it. Run
`pnpm test`, `pnpm typecheck`, `pnpm lint` after each.

1. **Palette swap in `textures.ts`.** Replace the `PALETTE` const
   with Board 06 hex values + 3 derived shades. Move per-role colours
   to `ROLE_TINTS`. Update all generator call sites. Verify dev
   server: existing scene re-renders in canonical palette; no key
   missing.
2. **Add procedural stubs for new texture keys** (doors, slot frames,
   frosted walls, dial frame, shelf back, scout desk, etc.). Each is
   a minimal `fillRect` placeholder using palette colours.
3. **Expand `TEXTURE_KEYS`** in `textures.ts` to declare the new keys
   (if not already there for phase-3/phase-5 use).
4. **Expand `pngManifest()` in `asset-loader.ts`** to probe every new
   key.
5. **Expand `scripts/generate-office-assets.ts:MANIFEST`** to the ~30
   specs in §5.2. Embed Board 06 hex codes in every prompt.
6. **Run `pnpm gen:office-assets`** (requires `PIXELLAB_API_KEY`).
   Sandbox / no-network sessions stop here; the work product is the
   updated manifest + procedural stubs.
7. **Commit PNGs** to `apps/web/public/office/`. Each PNG is ≤ a few
   KB; the bundle is small.
8. **Manual verification (§11).** Compare the running office to
   Board 02 + Board 06. If a generated asset is off-palette,
   regenerate the single asset with a tightened prompt — don't accept
   palette drift.

---

## 9. Acceptance criteria

The PR is mergeable iff:

- [ ] `pnpm test` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` passes.
- [ ] `office-click-through.spec.ts` passes in CI.
- [ ] `textures.ts:PALETTE` contains exactly the 8 canonical hex codes
      (§4.0) plus 3 derived shades (§4.1) plus 2 derived blends (§4.2).
      No other base colours. (Role tints live separately in
      `ROLE_TINTS` per §5.3.)
- [ ] `textures.ts:ROLE_TINTS` exists with exactly the 12 entries
      enumerated in §5.3, and is the only source of per-role colour.
      Grep returns no other per-role colour literals under
      `apps/web/src/components/office/`.
- [ ] `asset-loader.ts:pngManifest()` covers every key in
      `TEXTURE_KEYS`. (Soft acceptance: a manifest-key/texture-key
      diff test in `slice.test.ts`.)
- [ ] `scripts/generate-office-assets.ts:MANIFEST` has ~30 entries
      (range 25..35 acceptable as scope evolves).
- [ ] Every PixelLab prompt embeds at least one Board 06 hex code.
      (Soft acceptance: a unit test that scans the MANIFEST.)
- [ ] **Conditional on §9.1 (no-network exception below).** All PNGs
      in `apps/web/public/office/` are committed and load without 404
      in the dev server (no console warnings about missing assets).
      If the §9.1 exception applies, this criterion is deferred to the
      follow-on commit and the PR may merge with procedural fallbacks
      only.
- [ ] Manual verification checklist (§11) all ticked.
- [ ] No new dependencies in `apps/web/package.json`.
- [ ] **No mutation of workflow state.** Phase 2.5 only touches
      rendering. No `fetch` / `postMessage` / label-write calls added.
- [ ] **No new architecture.** No new layers, no new modules, no new
      event flows, no behaviour change.

### 9.1 Sandbox / no-network exception

If the PR is authored in a sandbox without outbound HTTPS to PixelLab,
the run-the-generator step (8.6) is skipped. The PR still merges
provided:

- The MANIFEST is expanded per §5.
- Procedural fallbacks render every key in the canonical palette.
- A follow-on commit (by a maintainer with network) runs the
  generator and commits the PNGs.

Surface this clearly in the PR body. Do not invent PNGs.

---

## 10. Test surface

### Unit tests (`slice.test.ts`)

- `PALETTE` contains exactly 13 entries: the 8 canonical hex codes
  (§4.0) + 3 derived shades (§4.1) + 2 derived blends (§4.2). Test
  asserts set equality against the §4 tables.
- `ROLE_TINTS` covers every entry in `OFFICE_ROLES` (12 entries) and
  every value matches §5.3's enumerated table exactly.
- `pngManifest()` keys = `TEXTURE_KEYS` keys (set equality).
- `generate-office-assets.ts:MANIFEST` entries each contain at least
  one Board 06 hex code in their prompt (regex over `#[0-9A-F]{6}`).

### E2E

- `office-click-through.spec.ts` continues to pass.
- Optional screenshot diff (`RUN_SCREENSHOTS=1`) capturing the
  rendered floor with the new palette; useful for human review of
  visual changes.

---

## 11. Manual verification checklist

Before opening the PR, in the dev server:

- [ ] Office tab loads at `/projects/:slug/office` with no console
      errors and no missing-asset warnings.
- [ ] Floor tiles, walls, desks read in the Board 06 palette. Compare
      visually against `docs/design/office-mode/goose-hub-office-mode-design-pack/02-canonical-project-floor/canonical-project-floor.png`.
- [ ] QA chamber walls render with the frosted-blue tint.
- [ ] Review chamber walls render with the frosted-grey-purple tint.
- [ ] Each role's persona sprite tints to its `ROLE_TINTS` value.
- [ ] Ticket card, scroll, envelope textures load (visible if a
      Phase 3 / 5 path is exercised; otherwise verify by direct
      asset URL).
- [ ] Indicator glyphs (speech / thought / question / coffee / bang /
      check) render in palette-consistent colours.
- [ ] Floor & queue-stack render in canonical palette under different
      depths.
- [ ] Banner middle cell (mode badge) and right cell (hero ticket)
      remain readable on the new background.
- [ ] FloorIndicator + DeskDetailPanel still work; their existing CSS
      colours are unchanged (DOM, not canvas).

If anything differs from the Board 02 reference image at a glance,
regenerate or tighten the prompt — don't ratify drift in tests.

---

## 12. Stop conditions

Stop and ask the human if any of the following occur:

- A PixelLab prompt drifts off-palette repeatedly despite the anchor.
  Surface the prompt; ask whether to tighten or to skip the asset
  (procedural fallback continues to render).
- The PixelLab credit budget for the run is exceeded. The manifest is
  ~30 entries; a single run should fit hobby tier. If multiple
  re-runs are needed, surface before continuing.
- An asset visibly needs a new colour outside the 9+3 palette. That
  is a Board 06 spec change; ADR + amend Board 06 first.
- Animation / behaviour change feels necessary to make the new assets
  read correctly. It isn't. The slide-walks + single-frame sprites
  are deliberate. Surface.
- The runtime starts hitting performance issues with ~30 loaded PNGs.
  It won't (total bundle size is ~100 KB); if it does, that's a
  Phaser config issue, not a Phase 2.5 problem.

---

## 13. Explicit non-goals

Restated:

- **No atmospheric polish.** No night palette, no day/night cycle,
  no mode-driven global tint (interactive / supervised / autonomous),
  no rain, no weather, no lighting overlays. Boards 09–12 are a
  separate slice.
- **No animated states.** Sprites are single-frame. No walk cycle,
  no idle bob, no talking mouth.
- **No new behaviour or geometry.** Coordinates from `lib/rooms.ts`
  unchanged. State→room mapping unchanged. Event flows unchanged.
- **No HUD overlays.** Phase 6.
- **No cinematic-specific particles or glow rings** (those are
  generated during Phase 5).
- **No room-specific palette beyond the frosted variants** Board 02
  already requires.
- **No new files or modules** beyond what §3 lists.
- **No mutation of workflow state.** Trivial to violate in palette
  work? No — but restated for invariant consistency across phase
  docs.

---

## 14. What happens after Phase 2.5

Phase 3 continues unchanged (it touches sprite *structure*, not
sprite *appearance*; the new assets it spawns will already be in the
canonical palette).

Phases 4–6 unchanged.

Post-v1 atmospheric polish slice gets its own spec, consumes Boards
09–12, and layers on top of the canonical palette this phase
established.

This plan only covers Phase 2.5.
