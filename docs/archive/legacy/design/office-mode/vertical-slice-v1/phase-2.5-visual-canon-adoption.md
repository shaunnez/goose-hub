# Office Mode Vertical Slice v1 — Phase 2.5: Visual Canon Adoption

**Status:** Specified. Authored retroactively after Phases 1–6 all
merged. Phase 2.5 is therefore not "between Phase 2 and Phase 3" — it
is a **retrofit pass** against the complete v1 stack. The functional
layer is done; this phase brings the rendered surface in line with
Board 06.

**Goal:** Bring the rendered office in line with Board 06's visual
canon. Today the procedural textures in `game/textures.ts` use an
ad-hoc palette, the PixelLab manifest in
`scripts/generate-office-assets.ts` covers only 11 small assets, **and
Phases 3–6 each added their own hardcoded hex literals into layers,
HUD, choreography intents, and DOM panels.** A grep across
`apps/web/src/components/office/` currently returns ~72 distinct hex
codes — almost none of which are Board 06 canonical. The result: the
runtime office looks unrelated to the design pack.

Phase 2.5 closes that gap **without** introducing atmospheric polish
(lighting, mode tinting, ambient props — those remain post-v1).

This is a **visual fidelity** phase, not a behaviour or geometry
phase. Coordinates, layers, anchors, state mapping — all unchanged.
The same scene now just **renders** with the canonical palette across
every surface Phases 1–6 ship.

---

## 1. Scope

### In scope

- Replace the ad-hoc palette in `apps/web/src/components/office/game/textures.ts`
  with Board 06's canonical palette. Procedural textures regenerate
  to match.
- **Sweep every hex literal under `apps/web/src/components/office/`**
  and replace with imports from `textures.ts:PALETTE` /
  `ROLE_TINTS` / `CINEMATIC_TINTS` (new) / `HUD_TINTS` (new). See
  §6 for the file-by-file inventory of current drift.
- Expand the PixelLab manifest in `scripts/generate-office-assets.ts`
  to mirror the actual `TEXTURE_KEYS` surface plus a small set of
  new keys that the v1 scene actively needs (frosted walls, ticket
  card variants, scout desk). Bake Board 06 hex codes into every
  prompt so PixelLab outputs land in the canonical palette.
- Extend `asset-loader.ts`'s probe manifest to mirror `TEXTURE_KEYS`
  exactly (set equality test in `slice.test.ts`).
- Regenerate the bundle (`pnpm gen:office-assets`), commit the PNGs
  to `apps/web/public/office/`. (§9.1 sandbox exception preserved.)
- Manual verification: dev-server office view matches Board 02 + Board
  06 references at a glance, including HUD chrome and cinematic
  particles / pulses / glows.
- Update `apps/web/src/components/office/README.md` to point at the
  Board 06 palette as the source of truth for **all** tints, not just
  per-role.

### Out of scope (post-v1)

- Atmospheric polish: night palette, mode-driven global tinting,
  rain, ambient janitor / coffee machine, weather, lighting overlays.
  All Boards 09–12 territory.
- Animated states (sprite-sheet walk cycles, idle bobs, talking
  mouth, working hand). The slice continues to render single-frame
  sprites that slide.
- Per-room mood lighting (Phase 2.5 keeps Board 02's frosted-blue QA
  and frosted-grey Review tints; no other room-specific moods).
- TDD-heartbeat glyphs.
- Tool-call micro-animations.
- New behaviour, new layers, new event flows. Phase 2.5 is render
  fidelity only.
- New textures Phase 6 chose to render as `Phaser.GameObjects.Text`
  or `Phaser.GameObjects.Graphics` rather than as a PNG (retry
  counter, round counter, score dial, banner frame, done-day badge).
  Phase 2.5 repalettes their text / fill colours but does not
  introduce new PNG assets for them.

If you find yourself touching anything in "out of scope," stop.

---

## 2. Why this phase exists

Phase 2 adopted Board 02's spatial canon (6 rooms on a 1280×384
floor). That work was correct geometry but used whatever colours the
procedural texture generator already produced. Board 06 — the visual
system spec — was never enforced in code, and each subsequent phase
added its own hardcoded literals.

Specifically (state of `claude/milestone-17-setup-BRII1` at time of
authoring):

- `textures.ts:PALETTE` uses values like `floor: 0x2a2333`, `wall:
  0x4a3a5e`. Board 06 specifies `Floor #3A3D5C`, `Wall #2B2D42`. No
  cross-reference.
- The PixelLab manifest in `generate-office-assets.ts` is 11 entries:
  floor tiles, wall, desk, stairs, 6 indicators. `TEXTURE_KEYS` in
  `textures.ts` has 17 entries; 6 keys (ticket / queueStackMany /
  ticketGlow / ticketScroll / ticketEnvelope / spriteBase) fall
  through to procedural with no PNG covering them.
- Prompts in the manifest do not reference Board 06 hex codes, so
  even when assets are generated they drift from the canon.
- Phase 3 (PersonaLayer + TicketLayer) and Phase 5 (cinematic
  intents) added texture keys without extending the manifest.
- Phase 5 cinematic intents hardcode particle / pulse / glow colours
  (`0xff4444`, `0x00ff88`, `0x88aaff`, `0xff6666`, `0x88ffaa`) — none
  Board 06 canonical.
- Phase 6 (`HudLayer`, `HudFeed`, `QueuePanel`) hardcodes text and
  background colours (`#ffd700`, `#c7b8ff`, `#1a162299`,
  `#1a1622ee`, `#9ca3af`, `#2a2333`, `#4a3a5e`, `#ffffff`,
  `#00000066`, `0xffffff`) — none Board 06 canonical.

A grep across `apps/web/src/components/office/` for `0xRRGGBB` or
`#RRGGBB(AA)?` patterns currently returns ~72 distinct hex codes.
Phase 2.5 collapses that surface to the 25 enumerated palette
entries in §4 + §5.3 + the new §6.

Closing this gap means the running office finally reads as a Board 02
+ Board 06 implementation. Without it, every later visual work
(Boards 09–12 atmospheric polish, future zoom modes) animates against
a non-canonical baseline.

---

## 3. Target file structure (after Phase 2.5)

The PNG set is determined by `TEXTURE_KEYS` in
`apps/web/src/components/office/game/textures.ts`, not by speculation.
Phase 2.5 adds **three** new keys (frosted walls + scout desk) to
support Board 02's already-declared room semantics. Phase 6 chose to
render counters / dials / badges as `Phaser.GameObjects.Text` /
`Graphics` rather than as PNGs; Phase 2.5 honours that choice and does
not add PNG assets for them.

```
apps/web/
  public/office/                       # PNGs land here when pnpm gen runs
    # — mirrors TEXTURE_KEYS exactly (set equality enforced by test) —
    floor-tile.png                     # key: floorTile          (existing, regenerated)
    floor-tile-alt.png                 # key: floorTileAlt       (existing, regenerated)
    wall-tile.png                      # key: wallTile           (existing, regenerated)
    desk.png                           # key: desk               (existing, regenerated)
    stairs.png                         # key: stairs             (existing, regenerated)
    sprite-base.png                    # key: spriteBase         (NEW — was procedural)
    indicator-speech.png               # key: indicatorSpeech    (existing, regenerated)
    indicator-thought.png              # key: indicatorThought   (existing, regenerated)
    indicator-question.png             # key: indicatorQuestion  (existing, regenerated)
    indicator-coffee.png               # key: indicatorCoffee    (existing, regenerated)
    indicator-bang.png                 # key: indicatorBang      (existing, regenerated)
    indicator-check.png                # key: indicatorCheck     (existing, regenerated)
    ticket.png                         # key: ticket             (NEW — was procedural)
    queue-stack-many.png               # key: queueStackMany     (NEW — was procedural)
    ticket-glow.png                    # key: ticketGlow         (NEW — was procedural)
    ticket-scroll.png                  # key: ticketScroll       (NEW — was procedural)
    ticket-envelope.png                # key: ticketEnvelope     (NEW — was procedural)
    # — three new keys added by Phase 2.5 (declared in TEXTURE_KEYS too) —
    wall-frosted-blue.png              # key: wallFrostedBlue    (NEW key; QA chamber)
    wall-frosted-grey.png              # key: wallFrostedGrey    (NEW key; Review chamber)
    scout-desk.png                     # key: scoutDesk          (NEW key; Library)
  src/components/office/
    README.md                           # ADJUSTED — Board 06 palette as source of truth
    game/
      textures.ts                       # ADJUSTED — PALETTE → Board 06 + new keys
      asset-loader.ts                   # ADJUSTED — pngManifest() ≡ TEXTURE_KEYS
      layers/
        HudLayer.ts                     # ADJUSTED — text/fill colours from HUD_TINTS
        RoomLayer.ts                    # ADJUSTED — frosted-wall tints from PALETTE
        PersonaLayer.ts                 # ADJUSTED — tints via ROLE_TINTS
      choreography/
        cinematics/investigationWave.ts # ADJUSTED — scout glow from CINEMATIC_TINTS
        cinematics/mergeCelebration.ts  # ADJUSTED — green pulse/particles from CINEMATIC_TINTS
        cinematics/qaFailed.ts          # ADJUSTED — red pulse from CINEMATIC_TINTS
        intents/corridorPulse.ts        # ADJUSTED — pulse colour from CINEMATIC_TINTS
        intents/glowRing.ts             # ADJUSTED — default tint from CINEMATIC_TINTS
        intents/particleBurst.ts        # ADJUSTED — default tint from CINEMATIC_TINTS
        intents/spawnVerdictScroll.ts   # ADJUSTED — scroll tint from CINEMATIC_TINTS
    components/
      HudFeed.tsx                       # ADJUSTED — colours via HUD_TINTS
      QueuePanel.tsx                    # ADJUSTED — colours via HUD_TINTS
scripts/
  generate-office-assets.ts             # ADJUSTED — MANIFEST mirrors TEXTURE_KEYS;
                                        # every prompt embeds Board 06 hex codes
docs/design/office-mode/
  vertical-slice-v1/
    README.md                           # ADJUSTED — roadmap table inserts Phase 2.5
    phase-2.5-visual-canon-adoption.md  # this file
```

Total: 20 PNGs (17 mirroring existing `TEXTURE_KEYS` + 3 new keys).
No new code modules. No new architecture. Existing `asset-loader.ts`
auto-prefers PNGs when present, so the runtime picks up new assets on
restart.

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

Do **not** invent new base colours. The full allowable palette
surface is enumerated across §4 + §5.3 + §5.4 + §5.5:

> **25 opaque hex codes** = 8 canonical (§4.0) + 3 derived shades
> (§4.1) + 2 derived blends (§4.2) + 12 role tints (§5.3) + 0 new
> opaque in §5.4 (cinematic; all bindings reuse canonical) + 0 new
> opaque in §5.5 (HUD; all bindings reuse canonical).
>
> Plus **3 allow-listed alpha overlays** (§5.5) for semi-transparent
> DOM panel backgrounds.
>
> Total surface: **28 distinct codes**, all enumerated in this
> document. Anything else is a palette drift bug.

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

## 5. PixelLab manifest + palette catalogue extensions

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

### 5.2 Manifest entries (mirrors `TEXTURE_KEYS`)

Exactly one entry per `TEXTURE_KEYS` entry. 17 existing keys + 3 new
(§3) = **20 entries**. File names must match `asset-loader.ts`'s
probe URLs.

| File                       | Size  | TEXTURE_KEYS key       | Prompt seed                                                                                                                              |
| -------------------------- | ----- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| floor-tile.png             | 16    | `floorTile`            | "top-down dark navy office carpet tile, seamless, palette: floor #3A3D5C, pixel art, 16×16"                                              |
| floor-tile-alt.png         | 16    | `floorTileAlt`         | "top-down dark navy office carpet tile, slightly lighter alt stripe, palette: floor #3A3D5C with subtle stripe #42466A, pixel art, 16×16" |
| wall-tile.png              | 16    | `wallTile`             | "top-down purple wall tile with shadow at base, palette: wall #2B2D42, pixel art, 16×16"                                                 |
| desk.png                   | 32    | `desk`                 | "top-down brown wood office desk with cyan glowing monitor screen, palette: desk #6B4F3B, monitor #6FE7FF, pixel art, 32×24"             |
| stairs.png                 | 32    | `stairs`               | "top-down pixel art staircase with wooden steps, palette: wood #6B4F3B over wall #2B2D42, pixel art, 32×32"                              |
| sprite-base.png            | 16    | `spriteBase`           | "top-down adorable cartoon goose, white feathers, orange beak, palette: cream + amber #F2CC8F beak + soft shadow on floor #3A3D5C, pixel art, 16×16, transparent background" |
| indicator-speech.png       | 16    | `indicatorSpeech`      | "pixel art white speech bubble with three small black dots, palette: white over wall #2B2D42 outline, 14×16, transparent bg"             |
| indicator-thought.png      | 16    | `indicatorThought`     | "pixel art white cloud thought bubble with trailing dot, palette: white over wall #2B2D42 outline, 14×16, transparent bg"                |
| indicator-question.png     | 16    | `indicatorQuestion`    | "pixel art white speech bubble with bold black question mark, palette: white + wall #2B2D42 mark, 14×16, transparent bg"                 |
| indicator-coffee.png       | 16    | `indicatorCoffee`      | "pixel art white coffee mug with steam wisps, palette: cream mug + amber #F2CC8F coffee + desk #6B4F3B base, 14×14, transparent bg"      |
| indicator-bang.png         | 16    | `indicatorBang`        | "pixel art warning triangle with exclamation mark, palette: fail red #FF6B6B + white mark, 14×14, transparent bg"                        |
| indicator-check.png        | 16    | `indicatorCheck`       | "pixel art circle with checkmark, palette: success green #8BD17C + white check, 14×14, transparent bg"                                   |
| ticket.png                 | 16    | `ticket`               | "small folded paper ticket card with corner clip, palette: amber #F2CC8F card with cyan #6FE7FF accent, pixel art, 16×16, transparent bg" |
| queue-stack-many.png       | 16    | `queueStackMany`       | "small stack of 4+ paper cards with subtle red overflow tint, palette: amber #F2CC8F + fail red #FF6B6B edge, pixel art, 16×16, transparent" |
| ticket-glow.png            | 24    | `ticketGlow`           | "small soft glow ring effect, palette: monitor cyan #6FE7FF over transparent, pixel art, 24×24, transparent bg"                          |
| ticket-scroll.png          | 16    | `ticketScroll`         | "small rolled scroll of paper, palette: fail red #FF6B6B with parchment cream, pixel art, 16×16, transparent bg"                         |
| ticket-envelope.png        | 16    | `ticketEnvelope`       | "small sealed envelope with wax seal, palette: cream paper with cyan #6FE7FF wax seal, pixel art, 16×16, transparent bg"                 |
| wall-frosted-blue.png      | 16    | `wallFrostedBlue` (NEW) | "top-down translucent frosted-blue wall tile, palette: wall #2B2D42 base with cyan #6FE7FF inner glow blended to #3F6B80, pixel art, 16×16" |
| wall-frosted-grey.png      | 16    | `wallFrostedGrey` (NEW) | "top-down translucent frosted purple-grey wall tile, palette: wall #2B2D42 base with review purple #D68FD6 blend to #473A55, pixel art, 16×16" |
| scout-desk.png             | 24    | `scoutDesk` (NEW)       | "small top-down library reading desk, modest pixel art, palette: desk #6B4F3B on floor #3A3D5C, 24×16"                                   |

Total: **20 assets**, one per declared `TEXTURE_KEYS` entry. Hobby-tier
PixelLab credit budget should comfortably fit a single run.

If a future slice (atmospheric polish, watchtower) declares more
texture keys, that slice's spec extends both `TEXTURE_KEYS` and this
manifest atomically. Phase 2.5 does not pre-allocate keys it doesn't
intend to use.

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

This table is **one of three carve-outs** from the canonical palette in
Phase 2.5. The other two (cinematic and HUD tints) are enumerated in
§5.4 and §5.5. The full palette surface count is restated in §4.1
once §5.4 and §5.5 are read.

Codify in `textures.ts` as a single exported `ROLE_TINTS` constant.
Replace any per-role colour usage in `textures.ts` or elsewhere with
imports of this constant.

### 5.4 Cinematic intent tints — enumerated extension (8 entries)

Phase 5's intent modules (corridor pulse, particle burst, glow ring,
verdict scroll, scout envelope) currently embed ad-hoc hex literals
(`0x00ff88`, `0xff4444`, `0xff6666`, `0x88aaff`, `0x88ffaa`). These
must move to a single exported `CINEMATIC_TINTS` constant in
`textures.ts`, with every entry tied to a canonical hue or near
neighbour (same constraint as §5.3).

| Slot                         | Hex literal (TS) | Relationship to canonical             | Used by                                            |
| ---------------------------- | ---------------- | ------------------------------------- | -------------------------------------------------- |
| `pulseFail`                  | `0xFF6B6B`       | fail red (canonical, reused)          | `corridorPulse.ts`, `qaFailed.ts` red sweep        |
| `pulseSuccess`               | `0x8BD17C`       | success green (canonical, reused)     | `mergeCelebration.ts` green pulse                  |
| `glowRingDefault`            | `0x8BD17C`       | success green (canonical, reused)     | `glowRing.ts` default tint                         |
| `glowRingFail`               | `0xFF6B6B`       | fail red (canonical, reused)          | `glowRing.ts` for qa-failed cinematic              |
| `glowRingWave`               | `0x6FE7FF`       | monitor cyan (canonical, reused)      | `investigationWave.ts` convergence glow            |
| `particleBurstDefault`       | `0x8BD17C`       | success green (canonical, reused)     | `particleBurst.ts` default tint (merge)            |
| `verdictScrollFail`          | `0xFF6B6B`       | fail red (canonical, reused)          | `spawnVerdictScroll.ts` body                        |
| `scoutEnvelopeSeal`          | `0x6FE7FF`       | monitor cyan (canonical, reused)      | `spawnScoutEnvelope.ts` wax seal                    |

Every value is a verbatim canonical entry; the table is a **named
binding**, not a colour extension. The point is to remove ad-hoc
literals from intent code, not to introduce new hues. If a future
cinematic needs a hue not in this table, extend `CINEMATIC_TINTS` by
ADR — not by hardcoded literal.

### 5.5 HUD tints — enumerated extension (5 entries)

Phase 6's `HudLayer.ts`, `HudFeed.tsx`, and `QueuePanel.tsx` currently
embed ad-hoc hex literals (`#ffd700`, `#c7b8ff`, `#1a162299`,
`#1a1622ee`, `#9ca3af`, `#2a2333`, `#4a3a5e`, `#ffffff`, `#00000066`,
`0xffffff`). Phase 2.5 collapses these to a single exported
`HUD_TINTS` constant in `textures.ts` and one alpha overlay
allow-list.

| Slot                         | Hex literal (TS) / CSS string | Relationship to canonical            | Used by                                          |
| ---------------------------- | ----------------------------- | ------------------------------------ | ------------------------------------------------ |
| `hudBadgeText`               | `#F2CC8F`                     | amber (canonical, reused)            | retry / round / done-day badge text              |
| `hudCounterText`             | `#D68FD6`                     | review purple (canonical, reused)    | round counter, score readout, queue badge        |
| `hudCameraStateText`         | `#6FE7FF`                     | monitor cyan (canonical, reused)     | "FOLLOWING #N" camera-state text                 |
| `hudSpotlight`               | `0x6FE7FF`                    | monitor cyan (canonical, reused)     | blocked-state spotlight arc                      |
| `hudFeedLineText`            | `#F2CC8F`                     | amber (canonical, reused)            | event feed body text                             |

**Alpha-overlay allow-list (background tints only — semi-transparent
panels):**

| Slot                | CSS string         | Notes                                                |
| ------------------- | ------------------ | ---------------------------------------------------- |
| `hudPanelBgDark`    | `#2B2D4299`        | wall canonical + `99` alpha (60%) — DOM panel bg     |
| `hudPanelBgDarker`  | `#2B2D42EE`        | wall canonical + `EE` alpha (93%) — queue-panel bg   |
| `hudShadowOverlay`  | `#00000066`        | pure black + `66` alpha (40%) — camera-text shadow   |

Alpha overlays are limited to the three slots above. Anything else
must be opaque and come from `PALETTE` / `ROLE_TINTS` /
`CINEMATIC_TINTS` / `HUD_TINTS`. Total palette surface across this
document:

> **25 hex codes** = 8 canonical (§4.0) + 3 derived (§4.1) + 2
> derived blends (§4.2) + 12 role tints (§5.3) + 0 new in §5.4 (all
> bindings reuse canonical) + 0 new in §5.5 (all bindings reuse
> canonical) + **3 alpha overlays** (above, allow-listed).

Total = 25 opaque hex codes + 3 alpha overlays. Any other literal
under `apps/web/src/components/office/` is a palette drift bug.

### 5.6 Palette drift inventory (files to repaint)

Concrete map of the current drift, file-by-file. Implementers should
work through this list; the §10 grep test will fail until each is
clean.

| File                                                                                       | Drifting literals                                                                                  | Replace with                                                                                 |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `game/textures.ts`                                                                         | full `PALETTE` const + per-role `spriteXxx` keys                                                  | §4 + §5.3 rewrite                                                                            |
| `game/layers/HudLayer.ts`                                                                  | `#ffd700`, `#c7b8ff`, `#1a162299`, `#ffffff`, `#00000066`, `0xffffff`                              | `HUD_TINTS.hudBadgeText / hudCounterText / hudCameraStateText / hudSpotlight`, `hudShadowOverlay`, `hudPanelBgDark` |
| `components/HudFeed.tsx`                                                                   | `#c7b8ff`                                                                                          | `HUD_TINTS.hudFeedLineText` (`#F2CC8F`)                                                       |
| `components/QueuePanel.tsx`                                                                | `#1a1622ee`, `#2a2333`, `#4a3a5e`, `#9ca3af`, `#c7b8ff`                                            | `HUD_TINTS.hudPanelBgDarker`, `PALETTE.wall`, `PALETTE.floor`, `HUD_TINTS.hudCounterText`     |
| `game/choreography/cinematics/investigationWave.ts`                                         | `0x88aaff`                                                                                         | `CINEMATIC_TINTS.glowRingWave` (`0x6FE7FF`)                                                  |
| `game/choreography/cinematics/mergeCelebration.ts`                                          | `0x00ff88`, `0x88ffaa`                                                                             | `CINEMATIC_TINTS.pulseSuccess` (`0x8BD17C`), `CINEMATIC_TINTS.particleBurstDefault`           |
| `game/choreography/cinematics/qaFailed.ts`                                                  | `0xff4444`                                                                                         | `CINEMATIC_TINTS.pulseFail` (`0xFF6B6B`)                                                     |
| `game/choreography/intents/corridorPulse.ts`                                                | `0xff4444`                                                                                         | `CINEMATIC_TINTS.pulseFail`                                                                  |
| `game/choreography/intents/glowRing.ts`                                                     | `0x00ff88`                                                                                         | `CINEMATIC_TINTS.glowRingDefault`                                                            |
| `game/choreography/intents/particleBurst.ts`                                                | `0x00ff88`                                                                                         | `CINEMATIC_TINTS.particleBurstDefault`                                                       |
| `game/choreography/intents/spawnVerdictScroll.ts`                                           | `0xff6666`                                                                                         | `CINEMATIC_TINTS.verdictScrollFail`                                                          |
| `game/layers/RoomLayer.ts`                                                                  | one-off literals for frosted-wall, banner backgrounds, etc. (audit during implementation)         | `PALETTE.qaWall`, `PALETTE.reviewWall`, `PALETTE.wall`, `PALETTE.bannerBg`                   |
| `game/layers/PersonaLayer.ts`                                                               | any per-role / shadow literals not already going through `ROLE_TINTS`                              | `ROLE_TINTS[role]`                                                                            |

The current full set of distinct hex literals under
`apps/web/src/components/office/` (run `grep -rhoE '(0x[0-9a-fA-F]{6}|#[0-9a-fA-F]{6,8})' apps/web/src/components/office/ | sort -u`)
is ~72. After Phase 2.5 it must be: the 25 enumerated opaque codes +
the 3 allow-listed alpha overlays = 28 distinct, all imported from
`textures.ts` or appearing only inside the four constant tables.

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

## 7. `textures.ts` repalette + tint catalogue

Five concrete edits:

1. **Rewrite the `PALETTE` const** to the 13 entries enumerated in
   §4 (8 canonical + 3 derived + 2 blends). Drop the per-role
   `spriteXxx` keys.
2. **Add `ROLE_TINTS`** as a separate exported const per §5.3 (12
   entries).
3. **Add `CINEMATIC_TINTS`** as a separate exported const per §5.4
   (8 entries; all values reuse canonical hues).
4. **Add `HUD_TINTS`** as a separate exported const per §5.5 (5
   opaque entries + 3 allow-listed alpha-overlay CSS strings).
5. **Re-tune every procedural generator** to call the new constants.
   Targets: floor tile, floor tile alt, wall tile, desk, stairs,
   sprite base, six indicators, ticket / queue-stack /
   ticketGlow / ticketScroll / ticketEnvelope textures, plus
   procedural fallbacks for the three new keys (`wallFrostedBlue`,
   `wallFrostedGrey`, `scoutDesk`) added by Phase 2.5. Each fallback
   uses palette constants exclusively. Behaviour-preserving: same
   shape, same size, canonical colours.

No new file, no new module. Single file rewrite — `textures.ts`.
Every consumer of an old palette literal (HudLayer, HudFeed,
QueuePanel, cinematic intents, etc.) imports the appropriate constant
from this module per the §5.6 drift inventory.

---

## 8. Sequence of edits

Each step compiles independently if you stop after it. Run
`pnpm test`, `pnpm typecheck`, `pnpm lint` after each.

1. **Palette swap in `textures.ts`.** Replace `PALETTE` with the 13
   entries from §4. Add `ROLE_TINTS` (§5.3), `CINEMATIC_TINTS` (§5.4),
   `HUD_TINTS` (§5.5) as separate exported consts. Update all
   existing procedural generator call sites to use the new constants.
2. **Declare new `TEXTURE_KEYS`** entries for `wallFrostedBlue`,
   `wallFrostedGrey`, `scoutDesk`. Add procedural fallbacks for them
   in `textures.ts` using `PALETTE.qaWall`, `PALETTE.reviewWall`,
   `PALETTE.desk` + `PALETTE.floor`.
3. **Sweep drift inventory (§5.6).** Walk through each file listed
   and replace each ad-hoc hex literal with the appropriate import.
   Touch one file at a time; run tests after each. This is the
   highest-leverage step — most of the visible "looks nothing like
   the designs" problem is fixed here, before any PixelLab call.
4. **Expand `pngManifest()` in `asset-loader.ts`** to mirror the
   updated `TEXTURE_KEYS` (20 entries — see §5.2).
5. **Expand `scripts/generate-office-assets.ts:MANIFEST`** to the 20
   specs in §5.2. Embed Board 06 hex codes in every prompt.
6. **Run the grep acceptance test** locally (§9 sweep). It should
   already pass at this point if step 3 was thorough.
7. **Run `pnpm gen:office-assets`** (requires `PIXELLAB_API_KEY`).
   Sandbox / no-network sessions stop here; the work product is the
   updated manifest + procedural stubs.
8. **Commit PNGs** to `apps/web/public/office/`. Each PNG is ≤ a few
   KB; the bundle is small.
9. **Manual verification (§11).** Compare the running office to
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
- [ ] `textures.ts:PALETTE` contains exactly the 13 entries enumerated
      in §4: 8 canonical (§4.0) + 3 derived shades (§4.1) + 2 derived
      blends (§4.2).
- [ ] `textures.ts:ROLE_TINTS` exists with exactly the 12 entries
      enumerated in §5.3.
- [ ] `textures.ts:CINEMATIC_TINTS` exists with exactly the 8 entries
      enumerated in §5.4.
- [ ] `textures.ts:HUD_TINTS` exists with exactly the 5 opaque entries
      enumerated in §5.5, plus the 3 alpha-overlay entries declared in
      the §5.5 allow-list table.
- [ ] **Sweeping grep acceptance.** Running
      `grep -rhoE '(0x[0-9a-fA-F]{6}|#[0-9a-fA-F]{6,8})' apps/web/src/components/office/ | sort -u`
      returns **only** the 28 distinct codes enumerated across §4 +
      §5.3–§5.5. No other hex literal appears anywhere under
      `apps/web/src/components/office/`. **Soft acceptance: a unit
      test in `slice.test.ts` runs this grep and asserts set equality
      against the documented surface.**
- [ ] Every file in the §5.6 drift inventory now imports its colours
      from `textures.ts`. Spot-check: `HudLayer.ts`, `HudFeed.tsx`,
      `QueuePanel.tsx`, `investigationWave.ts`,
      `mergeCelebration.ts`, `qaFailed.ts`, `corridorPulse.ts`,
      `glowRing.ts`, `particleBurst.ts`, `spawnVerdictScroll.ts`.
- [ ] `asset-loader.ts:pngManifest()` keys ≡ `TEXTURE_KEYS` keys (set
      equality test in `slice.test.ts`).
- [ ] `scripts/generate-office-assets.ts:MANIFEST` has exactly one
      entry per `TEXTURE_KEYS` entry (20 entries given §3 + 3 new
      keys). Range 18..22 acceptable.
- [ ] Every PixelLab prompt embeds at least one Board 06 hex code
      (regex `#[0-9A-F]{6}`). Unit test in `slice.test.ts`.
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
- `CINEMATIC_TINTS` contains exactly the 8 entries enumerated in §5.4.
- `HUD_TINTS` contains exactly the 5 opaque + 3 alpha-overlay entries
  enumerated in §5.5.
- **Repo-wide hex sweep:** test runs the §9 grep and asserts the
  result set equals the union of `PALETTE` ∪ `ROLE_TINTS` ∪
  `CINEMATIC_TINTS` ∪ `HUD_TINTS`. 28 codes total. Test fails on any
  new drift.
- `pngManifest()` keys = `TEXTURE_KEYS` keys (set equality).
- `generate-office-assets.ts:MANIFEST` entries each contain at least
  one Board 06 hex code in their prompt (regex over `#[0-9A-F]{6}`).
- Every key in `TEXTURE_KEYS` appears as a MANIFEST entry's `file`
  field (set equality across the two surfaces).

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
- [ ] **HUD overlays** (retry counter, round counter, score readout,
      done-day badge, camera-state text, queue badges) render in
      Board 06 palette — amber / review purple / cyan only, no
      `#ffd700` or `#c7b8ff` drift.
- [ ] **Choreography cinematics:** trigger qaFailed → corridor pulse
      is `#FF6B6B` red, not `0xff4444`. Trigger mergeCelebration →
      glow ring is `#8BD17C` green, not `0x00ff88`. Trigger
      investigationWave → convergence glow is `#6FE7FF` cyan, not
      `0x88aaff`.
- [ ] **HudFeed and QueuePanel DOM panels** render with the §5.5
      `HUD_TINTS` colours; backgrounds use the allow-listed alpha
      overlays.
- [ ] FloorIndicator + DeskDetailPanel still work; their existing CSS
      colours are unchanged (DOM, not canvas, outside Phase 2.5's
      sweep).

If anything differs from the Board 02 reference image at a glance,
regenerate or tighten the prompt — don't ratify drift in tests.

---

## 12. Stop conditions

Stop and ask the human if any of the following occur:

- A PixelLab prompt drifts off-palette repeatedly despite the anchor.
  Surface the prompt; ask whether to tighten or to skip the asset
  (procedural fallback continues to render).
- The PixelLab credit budget for the run is exceeded. The manifest is
  ~20 entries; a single run should fit hobby tier. If multiple
  re-runs are needed, surface before continuing.
- An asset visibly needs a new colour outside the 28-code surface
  (§4 + §5.3 + §5.4 + §5.5). That is a Board 06 spec change; ADR +
  amend Board 06 first, then revisit this doc.
- A cinematic intent or HUD element visibly *needs* the ad-hoc colour
  it currently uses (e.g. the existing yellow `#ffd700` reads better
  than `HUD_TINTS.hudBadgeText` amber). Don't quietly re-introduce
  drift; surface and adjust the binding in §5.4 / §5.5 with an ADR.
- Animation / behaviour change feels necessary to make the new assets
  read correctly. It isn't. The slide-walks + single-frame sprites
  are deliberate. Surface.
- The runtime starts hitting performance issues with ~20 loaded PNGs.
  It won't (total bundle size is ~60 KB); if it does, that's a
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
  Lane / preemption / intent contracts unchanged.
- **No new cinematic primitives or HUD elements.** Phase 2.5 only
  repaints what Phases 3–6 already shipped.
- **No new PNG assets for elements Phase 6 chose to render as
  `Phaser.GameObjects.Text` / `Graphics`** — retry counter, round
  counter, score dial, banner frame, done-day badge. Their *colours*
  move to `HUD_TINTS`; their *renderable* stays Text/Graphics.
- **No room-specific palette beyond the frosted variants** Board 02
  already requires.
- **No new files or modules** beyond what §3 lists.
- **No mutation of workflow state.** Trivial to violate in palette
  work? No — but restated for invariant consistency across phase
  docs.

---

## 14. What happens after Phase 2.5

Phases 1–6 are already merged. Phase 2.5 is the retrofit pass that
makes the running office finally match the design pack. After it
lands:

- The runtime office reads as a Board 02 + Board 06 implementation
  at a glance. Every visible colour is one of 28 enumerated codes.
- The 4 canonical cinematics (investigationWave, qaFailed,
  reviewConverged, mergeCelebration) play out in canonical palette.
- HUD overlays (queue badges, retry / round counters, score readout,
  camera-state, done-day badge, event feed) read in canonical
  palette.
- Future visual slices (atmospheric polish from Boards 09–12, zoom
  modes, watchtower, lobby, backstage corkboard) layer **on top** of
  the canonical baseline rather than fighting drift.
- The PixelLab manifest and the asset-loader probe agree on a single
  authoritative key surface (`TEXTURE_KEYS`). New keys require
  updating both atomically.

The slice's `README.md` exit criteria (§10) are met once Phase 2.5
merges with all PNGs in place. **v1 is shippable at that point.**

This plan only covers Phase 2.5.
