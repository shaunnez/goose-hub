# Office Mode Vertical Slice v1 — Phase 6: Runtime HUD

**Status:** Specified. Last phase of the slice. After this merges, v1
is shippable.

**Goal:** Add the minimum runtime observability overlays the slice
needs so a player watching the office can read what's happening
without parsing motion alone.

The HUD must feel **physically integrated into the world** — labels
above heads, counters mounted on doors, depth badges at room
thresholds, a dial on the Review chamber. Not a generic dashboard
pasted over the canvas.

This is the office-first principle: the office is the dashboard.

---

## 1. Scope

### In scope

- **Hero labels** — codename above the carrier persona of the current
  hero ticket; issue id + truncated title in the banner Hero-Ticket
  cell. (Phase 3 already implemented codename pop + banner cell; phase
  6 polishes them and adds priority tinting.)
- **Queue overlays** — depth badges at room doorways (the `+N`
  variant for tier-4 stacks from Board 02 §8) and a click-to-list
  panel for queued items.
- **Retry counter** — numeric badge on the QA chamber, increments on
  `qa.functional-failed` events (which phase 5 already emits
  `'choreo.retry-incremented'` for).
- **Convergence counter** — round counter on the Review chamber door.
- **QualityScore dial readout** — small numeric label below the dial
  on the Review door frame (Board 02 §4.5 reserves the dial anchor).
- **Room pressure overlays** — subtle room-floor tint that warms as
  in-flight ticket count climbs in that room.
- **Blocked-state overlays** — spotlight effect + bell icon on
  `gate-pending` / `needs-human` personas (phase 5 already freezes them
  with `swapIndicator(question)`).
- **Done-day badge** — small "+N today" counter below the Done shelf;
  increments on `'choreo.merge-celebrated'` event from phase 5.
- **Runtime event feed** — a small DOM-side React component that
  subscribes to the scene emitter and renders the last ~5 lines of
  high-tier choreography activity ("Wave started", "Review converged",
  "QA failed", "Merged: #1234").
- **Hero-ticket camera-state indicator** — a tiny "Following" icon /
  text in the top-left of the canvas when camera is on
  `hero-ticket-follow`; absent when on `floor-overview`.

### Out of scope (post-v1)

- Zoom mode HUD (`building`, `room`, `persona` indicators) — Board 02
  §6 reserves the anchors; v1 has only `floor-overview` and
  `hero-ticket-follow`.
- Budget / token gauge — operationally important but lives in the
  lobby (not in scope). Phase 6 does not surface it.
- Room load *heatmap* (Board 08 brief mentions one) — replaced by
  subtle floor tinting per §3.4. No multi-color heatmap.
- TDD heartbeat glyphs.
- Tool-call micro-animations.
- Watchtower / auditor sprite + beacon. Critical-lane anchor reserved;
  not in v1.
- Tier-disagreement light at the QA chamber. Anchor reserved (Board 02
  §16 still-open), not wired in v1.
- Wave-glyph aggregated overlay (the "6 scouts ×" flock-badge at floor
  zoom). v1 always shows individual scouts.
- Sound, ambient audio, weather, rain, night-mode lighting changes.
- Mode (`interactive` / `supervised` / `autonomous`) tinting beyond
  the static badge in the banner's middle cell. Per-mode global
  palette is deferred.
- Persona stat badges, streak counters, win counts.
- WorkPackage tethers.
- Generic event-log expansion beyond the 5-line feed.

If you find yourself touching anything in "out of scope," stop.

---

## 2. Target file structure (after Phase 6)

```
apps/web/src/components/office/
  components/
    OfficePage.tsx               # unchanged
    OfficeTab.tsx                # ADJUSTED — instantiates HudFeed; passes event subscription
    OfficeGameMount.tsx          # unchanged
    FloorIndicator.tsx           # unchanged
    DeskDetailPanel.tsx          # unchanged
    HudFeed.tsx                  # NEW — DOM event feed, ~80 lines
  game/
    OfficeScene.ts               # ADJUSTED — instantiates HudLayer
    asset-loader.ts              # unchanged
    textures.ts                  # extended for badge / dial / spotlight textures (procedural)
    choreography/                # unchanged
    layers/
      RoomLayer.ts               # ADJUSTED — exposes hud-friendly anchor lookups for HudLayer
      PersonaLayer.ts            # unchanged
      TicketLayer.ts             # unchanged
      HudLayer.ts                # NEW — canvas-hud renderable; ~280 lines
      types.ts                   # ADJUSTED — adds HudState type
  lib/
    rooms.ts                     # ADJUSTED — adds two new anchor lookups:
                                 #   hudAnchor('retry-counter' | 'round-counter' | 'quality-score' | 'done-day' | 'camera-state' | etc.)
                                 #   pressureColorForCount(n: number): ColorString  (pure)
    hud-state.ts                 # NEW — pure derivation of HudState from placements + recent events
    ...                          # all other libs unchanged
  slice.test.ts                  # extended for hud-state + room pressure
```

New code budget: ~700 lines including tests.

---

## 3. The HUD components

Each component has a single source of truth — usually
`HudLayer.update(state: HudState)` driven by `hud-state.ts`. State
flows in once per `applyPlacements` or per choreography observability
event, never per frame.

### 3.1 Hero labels

**Where:** above the carrier persona of the current hero ticket, plus
in the Board 02 §3 banner Hero-Ticket cell.

**What phase 3 / 5 already built:**
- Codename pop above persona at `(persona.x, persona.y − 28)`. Owned
  by `PersonaLayer`.
- Banner cell text. Owned by `RoomLayer`.

**What phase 6 adds:**
- Priority tinting on the codename label: `critical` → red,
  `high` → amber, `normal` → cyan, `low` → grey. Single text colour
  per priority. The tint comes from `lib/rooms.ts` →
  `priorityTintColor(priority)` (pure). The carrier persona's
  priority is the priority of its carried ticket.
- Truncation rule for banner: `#${externalId} — ${title.slice(0, 36)}…`.
- A tiny **issue-priority dot** rendered to the left of the banner
  Hero-Ticket cell text, sized 6px square, coloured per priority.

`PersonaLayer.setHeroCodename(personaId, codename, priority)` replaces
the simpler `setHeroCodename(personaId, codename)` from phase 3.

### 3.2 Queue depth badges

**Where:** beside each room queue stack (per Board 02 §8). Existing
queue stack texture tiers already encode depth 0..15 visually. Phase 6
adds the **numeric badge** for tier-4 stacks (depth 16+).

**Implementation:** `HudLayer.applyQueueDepths(perRoom: Record<RoomId,
number>)`. For each room with depth ≥ 16, render a
`Phaser.GameObjects.Text` at `(stack.x + 12, stack.y − 18)` showing
`+${depth - 15}`. For depth < 16, no badge.

**Z-layer:** `canvas-hud` (z=60).

**Cadence:** updated once per `applyPlacements`. No per-frame work.

**Click behaviour:** the existing room queue click zone (Board 02
§10) opens a "Queued at <room>" panel. **The panel itself is a DOM
component**; v1 ships the panel as a simple `<aside>` listing item ids
and titles, similar to `DeskDetailPanel`. Single screen, no
pagination, no filters. Implemented as `components/QueuePanel.tsx`,
opened via React in response to the existing scene `'queue-click'`
emitter event (which `RoomLayer` already emits per phase 2). If the
emitter event does not yet exist, phase 6 adds it — single
`stopPropagation`-aware click handler on `zone.queue.*` rects.

### 3.3 Retry counter

**Where:** corridor side of the QA chamber, anchor
`hudAnchor('retry-counter')` = Board 02 §4.4 `(784, 96)`.

**Visual:** small numeric badge "×N" with a single-digit cap (rare;
≥10 retries surface as "9+"). Default value: `0`. Hidden when value is
0.

**Update rule:**
- Phase 5 emits `'choreo.retry-incremented'` on
  `qa.functional-failed`. Phase 6's `HudLayer` listens for this and
  increments a per-ticket counter (`Map<ticketId, number>`).
- The counter for the **hero ticket** is rendered. Counters for
  non-hero tickets are tracked but invisible until they become hero.
- Counter resets when the ticket transitions to `factory:done` /
  `factory:archived` / `factory:rejected` (observed via
  `applyPlacements`).

**Bounce:** on increment, the badge runs a 200ms `Quad.Out` scale
bounce (1.0 → 1.4 → 1.0), per Board 02 §14.1 step 4 of `qaFailed`.

### 3.4 Convergence counter (Review)

**Where:** corridor side of the Review chamber, anchor
`hudAnchor('round-counter')` = Board 02 §4.5 `(1024, 96)`.

**Visual:** "rN" where N is the current convergence round. Default `r1`
when the ticket enters Review for the first time. Increments on each
`review.escalated` event (deferred from the v1 cinematic catalogue but
the *counter* still surfaces it — minimal HUD wiring, no cinematic).

If the hero is not in Review (or no hero exists), the counter is
hidden.

### 3.5 QualityScore dial readout

**Where:** beside the dial face, anchor `hudAnchor('quality-score')` =
Board 02 §4.5 `(1064, 104)`.

**Visual:** numeric text `0..100` beneath the dial frame, monospace,
12px. Phase 6 does **not** animate a dial needle — the needle is a
later atmospheric concern; phase 6 only renders the numeric.

**Update rule:**
- Read from `WorkItemDto` if the server includes
  `qualityScore?: number` on issues. If not, read from a
  `qualityScore` field on the hero ticket only.
- Update on `applyPlacements`. No event-driven path; the score is
  data, not motion.
- Hidden when no hero or no score.

If the field is not yet plumbed in `WorkItemDto`, phase 6 leaves the
anchor unused. Do not block phase 6 on a server-side change; surface
in the PR description.

### 3.6 Room pressure overlay

**Where:** floor tiles inside each room.

**Visual:** a single tile-tint modulation applied per room. As
"in-flight tickets in this room" increases, the room's interior tint
shifts from neutral cyan toward warm amber (pressure). Mapping (from
`lib/rooms.ts → pressureColorForCount(n)`):

| In-flight tickets | Tint           |
| ----------------- | -------------- |
| 0                 | neutral cyan   |
| 1..3              | neutral        |
| 4..7              | slight amber   |
| 8..15             | amber          |
| 16+               | warm amber     |

For the v1 single-ticket journey, all rooms stay at 0..1 most of the
time; pressure surfaces only during the Wave (3 scouts in Library) or
parallel-build (out of v1 scope). Implementation must work for higher
counts but v1 visual budget is the 0..3 range.

**Implementation:** `HudLayer` does not own this — `RoomLayer.applyPressure(perRoom: Record<RoomId, number>)`
takes the count map and tints the floor-tile group inside each room.
This is the **only** HUD-driven write phase 6 makes into `RoomLayer`,
done via a single primitive method, not a layer boundary violation.

**Cadence:** once per `applyPlacements`. No per-frame work.

### 3.7 Blocked-state overlay

**Where:** above and around a frozen persona (one with
`factory:needs-human` or `factory:gate-pending`).

**Visual:** a soft spotlight ring at `(persona.x, persona.y − 6)`
radius 28px (z=`effects` 50). Plus a small bell icon at
`(persona.x + 16, persona.y − 32)` (z=`canvas-hud` 60) when the state
is `gate-pending` only. `needs-human` shows a `?` indicator (already
swapped by phase 5) plus the spotlight; no bell.

**Implementation:** `HudLayer.applyBlocked(personaIds: Set<string>,
modes: Map<string, 'gate-pending' | 'needs-human'>)`. Spotlight and
bell are per-persona; cleaned up when the persona transitions out.

**Cadence:** once per `applyPlacements`.

### 3.8 Done-day badge

**Where:** below the Done shelf, anchor `hudAnchor('done-day')` =
Board 02 §4.6 `(1184, 296)`.

**Visual:** "+N today" text. `N` increments on every
`'choreo.merge-celebrated'` event from phase 5.

**Reset rule:** on midnight (browser-local). Implement with a
`setInterval` set in `HudLayer.create()` that checks the current date
once per minute; on date change, the counter resets to 0.

(This is the one place phase 6 introduces a tiny timer that ticks
without an event. It is bounded — one timer, one check per minute,
not a per-frame update.)

### 3.9 Runtime event feed

**Where:** **DOM**, not canvas. Top-right of the office viewport,
below the existing `FloorIndicator`. Component:
`components/HudFeed.tsx`.

**Visual:** a fixed 200×120px panel showing the last 5 lines of
high-tier choreography activity, scrolling from the bottom. Each line:
- Small priority dot.
- Event verb ("Wave started", "QA failed", "Review converged",
  "Merged").
- Ticket id `#1234`.

**Data source:** subscribes to scene events:
- `'choreo.intent-started'` filtered by cinematic boundaries (only
  the *first* intent of each cinematic produces a feed line, identified
  by name match: `cameraTo` is a follower, ignored; `spawnVerdictScroll`
  is qaFailed; `attachToDesk` + `swapIndicator(thought)` at lead-desk
  is investigationWave; etc.).
- Better approach: phase 5's `ChoreographyPlayer` is extended to emit
  `'choreo.cinematic-started'` and `'choreo.cinematic-completed'`
  events whenever a cinematic-named timeline starts / completes. Phase
  6 listens for **`'choreo.cinematic-started'` only.**

If extending the player conflicts with the phase 5 acceptance criteria
("`ChoreographyPlayer` ≤ 300 lines"), then the alternative is: phase
6 inspects intent names heuristically. Pick the cleaner one;
extending the player by ~10 lines is preferred.

**Feed line lifetime:**
- Each new event prepends a line to the feed.
- Lines older than 30 seconds fade out (opacity 0 over 1s); then
  disappear from the DOM.
- The feed never exceeds 5 visible lines; older lines drop on
  insertion of a new one if at max.

**Cadence:** event-driven only. No polling.

**No filters.** No expansion. No detail view. v1 is a 5-line ticker.

### 3.10 Hero-ticket camera state indicator

**Where:** top-left of the canvas, anchor
`hudAnchor('camera-state')` = `(8, 8)` (added to `lib/rooms.ts` for
this phase).

**Visual:** a small text "FOLLOWING #1234" when camera anchor is
`hero-ticket-follow`; absent when `floor-overview`. Text is white,
8px, monospace; renders on `canvas-hud` (z=60).

**Update rule:** `HudLayer.applyCameraState({ anchor: AnchorName,
ticketId?: string })`. Called by `OfficeScene` whenever the camera
anchor changes (which phase 5 already does at cinematic start /
end).

---

## 4. `HudLayer` responsibilities

The `HudLayer` is a single layer instance owned by `OfficeScene`.
Construction order:

```
new RoomLayer(...)
new PersonaLayer(...)
new TicketLayer(...)
new HudLayer(...)        // last — sits at top of z-stack
```

`HudLayer` owns:

- All canvas-hud children listed in §3 (queue badges, retry counter,
  round counter, score readout, done-day badge, camera state text,
  blocked-state spotlight + bell).
- A single subscription to the scene emitter for
  `'choreo.cinematic-started'`, `'choreo.retry-incremented'`,
  `'choreo.merge-celebrated'`.
- A single `applyHud(state: HudState)` method called by `OfficeScene`
  whenever `applyPlacements` updates derive a new HUD state.

It does **not** own:

- Hero codename labels above personas (that's `PersonaLayer`, set by
  phase 3 and extended by phase 6 for priority tinting only).
- Banner Hero-Ticket cell (that's `RoomLayer`'s banner text from phase
  2).
- Room pressure tinting (that's `RoomLayer.applyPressure`, called from
  the scene with the same `HudState` payload).
- The DOM event feed (that's `HudFeed.tsx`).

This split — `HudLayer` for canvas-hud, `HudFeed.tsx` for DOM — is
deliberate. The feed is a scrolling text widget; DOM is the right
medium. The badges, counters, dials, and spotlights are world-anchored;
Phaser is the right medium.

---

## 5. `lib/hud-state.ts` — pure derivation

```ts
export interface HudState {
  hero: {
    ticketId: string;
    personaId: string | null;
    priority: 'critical' | 'high' | 'normal' | 'low';
    bannerLabel: string;       // "#1234 — title…"
    qualityScore: number | null;
  } | null;
  queues: Record<RoomId, number>;          // depth per room
  pressure: Record<RoomId, number>;        // in-flight per room
  retry: Record<string, number>;           // ticket id → retry count
  reviewRound: number | null;
  blocked: Array<{ personaId: string; mode: 'gate-pending' | 'needs-human' }>;
  camera: { anchor: 'floor-overview' | 'hero-ticket-follow'; ticketId?: string };
  doneToday: number;
}
```

Pure derivation:

```ts
export function hudStateFromPlacements(
  personas: PersonaPlacement[],
  tickets: TicketPlacement[],
  prev: HudState | null,             // for retry / doneToday accumulators
  events: { retryIncremented: string[]; mergedCelebrated: string[] }
): HudState;
```

Tests cover every field. The function is the single source of truth for
"what does the HUD show right now?" `OfficeScene` calls it on every
`applyPlacements` and pushes the result to `HudLayer`, `RoomLayer`
(for pressure), and `HudFeed.tsx` (via emitter).

---

## 6. Layering rules

Inherit Board 02 §7. Phase 6 sits at z=60 (`canvas-hud`).

| Phase 6 surface             | Layer (z)        | Belongs to                |
| --------------------------- | ---------------- | ------------------------- |
| Hero codename label         | 35 (persona-overlays) | `PersonaLayer`          |
| Banner text (3 cells)       | 60 (canvas-hud)  | `RoomLayer`               |
| Queue depth badge `+N`      | 60 (canvas-hud)  | `HudLayer`                |
| Retry counter               | 60 (canvas-hud)  | `HudLayer`                |
| Round counter               | 60 (canvas-hud)  | `HudLayer`                |
| QualityScore readout        | 60 (canvas-hud)  | `HudLayer`                |
| Done-day badge              | 60 (canvas-hud)  | `HudLayer`                |
| Camera-state text           | 60 (canvas-hud)  | `HudLayer`                |
| Blocked spotlight ring      | 50 (effects)     | `HudLayer`                |
| Blocked bell icon           | 60 (canvas-hud)  | `HudLayer`                |
| Room pressure tile tint     | 0 (floor-tiles, modulated) | `RoomLayer`     |
| HudFeed (event log)         | DOM              | `HudFeed.tsx`             |

No new z values are introduced. The `canvas-hud` band remains
single-layered; insertion order within it does not matter visually
because no two HUD elements overlap.

---

## 7. Update cadence

**Per `applyPlacements`:**
- Recompute `HudState` via `hudStateFromPlacements`.
- Push to `HudLayer.applyHud(state)` → updates badges, counters,
  readouts, spotlights.
- Push to `RoomLayer.applyPressure(state.pressure)`.
- Push to `HudFeed.tsx` via React state.

**Per choreography event:**
- `'choreo.retry-incremented'` → accumulator updates retry map,
  `HudLayer` re-renders the relevant badge with a bounce.
- `'choreo.merge-celebrated'` → accumulator increments `doneToday`.
- `'choreo.cinematic-started'` → `HudFeed` prepends a line.

**Per minute:**
- `HudLayer` checks browser date; if rolled over, reset `doneToday`.

**No per-frame update.** No `scene.update()` work. Phase 6 must not
introduce a per-frame tick.

---

## 8. Interaction rules

| Element                    | Click behaviour                                                 |
| -------------------------- | --------------------------------------------------------------- |
| Queue badge `+N`           | Opens `QueuePanel.tsx` (DOM) listing queued items for that room |
| Retry counter              | No click; informational only                                    |
| Round counter              | No click                                                        |
| QualityScore readout       | No click in v1 (would link to detail panel later)               |
| Done-day badge             | No click in v1                                                  |
| Blocked spotlight / bell   | Click on the persona opens the existing `DeskDetailPanel` (per phase 3); the bell itself does not have its own zone |
| Camera-state text          | No click in v1 (clicking it could swap camera back; deferred)  |
| HudFeed lines              | Hovering a line shows a tiny title-tooltip via the `title=`     |
|                            | attribute (browser-native); clicking is no-op in v1             |

All clicks emit through React handlers, not the scene. The scene
remains visualisation-only.

---

## 9. Acceptance criteria

The PR is mergeable iff:

- [ ] `pnpm test` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` passes.
- [ ] `office-click-through.spec.ts` passes in CI.
- [ ] `layers/HudLayer.ts` exists; ≤ 320 lines.
- [ ] `components/HudFeed.tsx` exists; ≤ 100 lines.
- [ ] `components/QueuePanel.tsx` exists; ≤ 100 lines.
- [ ] `lib/hud-state.ts` exists; pure; ≤ 200 lines including tests
      target.
- [ ] `lib/rooms.ts` extended with `hudAnchor`, `priorityTintColor`,
      `pressureColorForCount`. No tile-pixel literals in any file
      outside `lib/rooms.ts`.
- [ ] `HudLayer` listens to `'choreo.cinematic-started'`,
      `'choreo.retry-incremented'`, `'choreo.merge-celebrated'` —
      and nothing else.
- [ ] **No per-frame update logic** added to `HudLayer` or any
      adjacent layer.
- [ ] **No mutation of workflow state.** Grep across `game/` returns
      no `fetch`, `postMessage`, label-write calls.
- [ ] No new dependencies in `apps/web/package.json`.
- [ ] Manual verification (§11) all ticked.

---

## 10. Test surface

### Unit tests (`slice.test.ts`)

- `hudStateFromPlacements`:
  - With no hero → `hero: null`.
  - With a hero carrying a critical ticket → priority `'critical'`.
  - With retry events accumulated → `retry[ticketId]` matches count.
  - With blocked personas → `blocked[]` has the right modes.
  - Done-today increments on each merged event in the input batch.
- `priorityTintColor(priority)` → returns expected colour per priority.
- `pressureColorForCount(n)` → returns expected colour per bucket.
- `hudAnchor(name)` → returns the expected `(x, y)` per Board 02 anchor
  table.

### Integration tests

- A scripted set of placements + events feeds `hudStateFromPlacements`
  then asserts `HudLayer.applyHud` was called with the right state.
  Phaser tween calls and text widgets mocked at the layer boundary.
- `HudFeed` snapshot test: 5 cinematic-started events fed in produce
  5 visible lines in the expected order.

### E2E

- `office-click-through.spec.ts` continues to pass.
- Optional opt-in spec for the HUD: scripted journey via the
  EventSource shim emits all four cinematics and asserts:
  - Hero label appears on the carrier persona.
  - Retry counter shows `1` after `qa.functional-failed`.
  - Done-day badge shows `1` after `pr.merged`.
  - HudFeed shows 4 lines.

---

## 11. Manual verification checklist

Before opening the PR, in the dev server:

- [ ] With no hero ticket, no codename pop, no banner Hero-Ticket cell,
      no retry / round counters, no QualityScore readout, no Done-day
      badge.
- [ ] Click a ticket: codename appears above carrier, priority tinted.
      Banner shows id + title + priority dot.
- [ ] Run the v1 journey end-to-end:
  - Investigation wave: 3 scouts visible; Library room pressure tint
    warms briefly.
  - Dev: no special HUD beyond hero label.
  - QA failure: retry counter at QA chamber shows `1` with bounce
    animation. Critical lane suppresses HudFeed line burst (only one
    feed line per cinematic, not per intent).
  - Review: round counter shows `r1`. (If `review.escalated` is
    emitted, round increments to `r2` etc.)
  - Merge: shelf landing + Done-day badge ticks to `1`.
- [ ] HudFeed shows lines for: "Wave started #N", "QA failed #N",
      "Review converged #N", "Merged #N". Each line carries a small
      priority dot.
- [ ] Open the office tab, wait > 30s, verify oldest HudFeed line
      fades out and disappears.
- [ ] Resize browser: queue badges, counters, dial readout, Done-day
      badge stay anchored to their world positions (they're canvas-hud,
      not DOM). HudFeed stays anchored to the viewport corner (it is
      DOM).
- [ ] Block a ticket: set `factory:gate-pending` on the hero — the
      spotlight ring appears around its carrier, a bell icon
      appears at top-right of the persona. Indicator is `?` (already
      from phase 5).
- [ ] No console errors.

---

## 12. Stop conditions

Stop and ask the human if any of the following occur:

- A HUD element starts wanting a per-frame tick. None of the v1
  elements should. If you find yourself wiring `scene.update()`,
  restate the design.
- Queue depth requires aggregation that doesn't exist in `tickets[]`
  (e.g. you need a count of items in `factory:in-progress` for a
  room — but the room has multiple desks). The `placementsFromItems`
  function should produce the per-room count for free; if it doesn't,
  extend that pure function rather than adding a side-channel.
- Two HUD elements overlap visually at the default scale. Each anchor
  in Board 02 was selected to avoid overlap, but if it happens at
  certain depths, surface — do not silently relocate anchors.
- The event feed begins to need filtering, expansion, or pagination.
  v1 is a 5-line ticker. Anything more is a different milestone.
- The QualityScore field is not on `WorkItemDto`. Surface — do not
  guess at where to source the value.
- Phase 5's `ChoreographyPlayer` does not emit
  `'choreo.cinematic-started'` events. Phase 5's acceptance criteria
  expect the per-intent observability emit; check whether the
  cinematic-level event was added or whether phase 6 needs the
  extension. Either is fine; pick the cleaner one.

---

## 13. Explicit non-goals

Restated:

- **No generic dashboard.** Everything in phase 6 anchors into the
  world geometry, except the 5-line event feed (intentionally DOM
  because it scrolls).
- **No zoom-mode HUD.** Single zoom level in v1.
- **No budget / token gauges.** Lobby concern.
- **No multi-color heatmaps.** Single-axis pressure tint per room.
- **No watchtower beacon.** Anchor reserved; not in v1.
- **No tier-disagreement light at QA.** Anchor reserved; not in v1.
- **No expanded event log.** 5 lines, fade after 30s.
- **No HUD interaction beyond two narrow click paths**: queue badges
  open a panel; blocked persona clicks open DeskDetailPanel.
- **No sound, no audio.**
- **No atmospheric polish** (night palette, rain, mode-driven global
  tints).
- **No persona stats** beyond the codename label + priority colour.
- **No mutation of workflow state from any HUD element.** Restated:
  this is the load-bearing invariant. HUD click handlers route through
  React; React handlers route to the existing workflow paths or to no
  side effects at all.

---

## 14. What happens after Phase 6

After phase 6 merges:

- The slice is **shippable.** A player can pick a project, watch one
  ticket traverse the v1 journey, and read both the motion and the
  HUD overlays to understand what's happening.
- Open follow-on slices (post-v1 milestones), each with its own
  ADR / spec:
  - Atmospheric polish (Boards 09–12): night palette, mode-driven
    global tint, ambient janitor / coffee machine.
  - Watchtower + auditor cinematic.
  - Tier-3 micro-animations: TDD glyphs, tool-call flickers, monitor
    flicker on desk lamps.
  - Sound / ambience.
  - Multi-floor / building view.
  - Lobby + courier + budget board.
  - Backstage corkboard + retro room.
  - M19 parallel-build cinematic + WorkPackage tethers.
  - Persona variants, stat badges, streaks.
  - Zoom modes (`building`, `room`, `persona`) — Board 02 anchors
    already reserved.

None of those are in scope for v1. They are the next slices.

This plan only covers Phase 6.
