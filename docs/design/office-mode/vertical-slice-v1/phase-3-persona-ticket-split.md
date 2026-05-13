# Office Mode Vertical Slice v1 — Phase 3: Persona / Ticket Split

**Status:** Specified. Do not begin Phase 4 work in this phase.

**Goal:** Split the single combined sprite (one body + one indicator)
that Phase 2 inherits into two visually distinct renderables:

- `PersonaSprite` — the goose carrying / working a WorkItem.
- `TicketSprite` — the WorkItem itself, as a physical card / scroll / envelope.

This is a **rendering split only.** It does not introduce SSE event
handling, choreography intents, cinematic primitives, or any new event
ingestion path. Phase 4 will introduce those; phase 3 leaves the data
flow exactly as Phase 2 left it.

The split exists so phases 4 and 5 can address persona movement and
ticket movement as separate concerns without rewriting the sprite
hierarchy under cinematic time pressure.

---

## 1. Scope

### In scope

- Two new layer files: `layers/PersonaLayer.ts`, `layers/TicketLayer.ts`,
  replacing `SpriteLayer.ts`.
- Two new sprite classes / entry records: `PersonaSprite`, `TicketSprite`.
  Both are thin wrappers around a `Phaser.GameObjects.Container` plus
  body / indicator / label children.
- A `carry` contract describing how a `TicketSprite` follows a
  `PersonaSprite` (or, when no carrier exists, owns its own position).
- Queue stack rendering for tickets waiting at room doorways — depth
  tiers per Board 02 §8.
- Slot transit semantics for tickets crossing sealed-room slot anchors
  (Library envelope-out, QA input/output, Review door) — geometric only;
  the *triggering events* are phase 4.
- Hero promotion interaction: when a ticket is "hero" (per Board 02
  §11), it renders on layer `z=45` and its carrier persona renders a
  codename label.
- A deterministic stand-in persona name when no server-side `personaId`
  exists, via `lib/persona-codenames.ts`.
- New pure module: `lib/persona-codenames.ts` (per Board 02 §12.6).
- New pure module: `lib/ticket-carry.ts` (carry-position math).

### Out of scope (phase 4 and later)

- SSE event-direct subscription. React Query invalidation continues to
  drive `applyPlacements`.
- `ChoreographyPlayer`, `Timeline`, lanes, intents, or any cinematic
  primitive.
- Verdict-scroll, envelope, glow-ring, particle, or convergence-ring
  visuals. The ticket sprite has a single visual mode in phase 3 (a
  card). Variants (scroll, envelope) land in phase 5.
- Sprite-sheet walk cycles. Personas still slide.
- TDD-heartbeat glyphs, tool-call micro-animations, monitor flicker.
- Watchtower, backstage, lobby, multi-floor rendering.
- Camera changes. `floor-overview` remains the only active camera anchor
  in phase 3. `hero-ticket-follow` is allocated but **not switched to
  yet**; phase 5 wires the cinematic camera switch.
- Banner Hero-Ticket cell update mechanism. The cell exists from phase 2
  and is set on hero promotion in phase 3 (one-way only — see §6.4).

If you find yourself touching anything in "out of scope," stop.

---

## 2. Target file structure (after Phase 3)

```
apps/web/src/components/office/
  components/
    OfficePage.tsx               # unchanged
    OfficeTab.tsx                # unchanged (or activeProject selection only)
    OfficeGameMount.tsx          # unchanged
    FloorIndicator.tsx           # unchanged
    DeskDetailPanel.tsx          # unchanged
  game/
    OfficeScene.ts               # delegates to RoomLayer + PersonaLayer + TicketLayer
    asset-loader.ts              # unchanged
    textures.ts                  # new texture keys: ticket card body, queue-stack tiers
    layers/
      types.ts                   # extended: PersonaPlacement, TicketPlacement
      RoomLayer.ts               # unchanged from phase 2
      SpriteLayer.ts             # DELETED — replaced by PersonaLayer + TicketLayer
      PersonaLayer.ts            # NEW — persona-only ownership
      TicketLayer.ts             # NEW — ticket-only ownership; queue stacks; slot transit
  lib/
    rooms.ts                     # unchanged (read-only consumer)
    agent-positions.ts           # ADJUSTED — emits { personas, tickets } pair
    layout.ts                    # unchanged
    pathfinding.ts               # unchanged (carry math is separate)
    persona-codenames.ts         # NEW — deterministic codename derivation
    ticket-carry.ts              # NEW — pure carry-position math
    state-to-room.ts             # unchanged (phase 2 introduced this)
    state-indicators.ts          # unchanged
  slice.test.ts                  # extended for persona-codenames + ticket-carry + agent-positions
```

`SpriteLayer.ts` is deleted, not deprecated. Phase 3 is the breaking
split. No callers should reach across the old name.

---

## 3. Sprite identity contracts

### 3.1 `PersonaSprite`

| Field         | Type                                          | Notes                                                    |
| ------------- | --------------------------------------------- | -------------------------------------------------------- |
| `personaId`   | `string`                                      | `${projectSlug}:${seed}`; v1 seed = ticket's `externalId` until server plumbs real persona ids |
| `codename`    | `string`                                      | derived from `personaId` via `codenameFor`; stable per session |
| `roomId`      | `RoomId`                                      | which room the persona occupies                          |
| `deskSlot`    | `number` (room-local index)                   | which station / desk the persona is seated at, or `-1` if walking |
| `container`   | `Phaser.GameObjects.Container`                | parent for body + indicator + label                      |
| `body`        | `Phaser.GameObjects.Image`                    | role-keyed texture                                        |
| `indicator`   | `Phaser.GameObjects.Image`                    | speech / thought / check / bang / question / null         |
| `label?`      | `Phaser.GameObjects.Text`                     | codename pop; only present when hero                      |
| `walkTween?`  | `Phaser.Tweens.Tween`                         | nullable; in-flight motion                                |
| `silhouette`  | `boolean`                                     | dimmed render inside sealed rooms (Library / QA / Review) |
| `state`       | `'idle' \| 'walking' \| 'working' \| 'frozen'`| pure read state; phase 3 sets `walking` / `idle`; phase 4+ adds `working` (during `agent.run-started`); phase 5 adds `frozen` (during `gate-pending`, `needs-human`) |

Identity rule: a `PersonaSprite` is keyed by `personaId`. Two `PersonaSprite`s
cannot share a `personaId`. A persona persists across walks; only its
position, indicator, and label change.

### 3.2 `TicketSprite`

| Field         | Type                                                                      | Notes                                                    |
| ------------- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| `ticketId`    | `string`                                                                  | `${projectSlug}:${externalId}` — same as M17's `spriteId` |
| `carrierPersonaId?` | `string \| null`                                                    | nullable; null when ticket is in transit alone, queued, on shelf, in slot |
| `position`    | `'carried' \| 'desk' \| 'queue' \| 'slot' \| 'shelf' \| 'free'`           | discriminator for current owner / location              |
| `roomId?`     | `RoomId \| null`                                                          | room context for queue / shelf / slot positions          |
| `slotId?`     | `string \| null`                                                          | e.g. `qa.input`, `qa.output`, `library.envelope-out`, `review.door` |
| `shelfSlot?`  | `number \| null`                                                          | 0..4 for Done shelf                                      |
| `container`   | `Phaser.GameObjects.Container`                                            | parent for body + badge                                  |
| `body`        | `Phaser.GameObjects.Image`                                                | default texture: card; phase 5 swaps to scroll / envelope variants for slot transit |
| `priorityTint`| `'critical' \| 'high' \| 'normal' \| 'low'`                              | applied as body modulation                                |
| `hero`        | `boolean`                                                                 | hero promotion flag; affects z and adds glow             |
| `glow?`       | `Phaser.GameObjects.Image`                                                | hero glow ring (z=50); present when `hero`                |

Identity rule: a `TicketSprite` is keyed by `ticketId`. Two `TicketSprite`s
cannot share a `ticketId`. A ticket persists across state transitions;
its `position` and `roomId` change but the sprite instance does not.

### 3.3 Joint identity invariant

For any active WorkItem in a state mapped to a room:

- Exactly one `TicketSprite` exists for it.
- Either zero or one `PersonaSprite` is its carrier at any moment (the
  `carrierPersonaId` field on the ticket).
- A `PersonaSprite` may carry zero or one tickets at a time. (v1 does
  not render multi-ticket personas; if data implies it, render only
  the highest-priority and log a `system.note`-style console warning.)

---

## 4. Ownership rules

### 4.1 Layer ownership

| Layer        | Owns                                                            | Reads                                                  | Mutates                       |
| ------------ | --------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------- |
| `RoomLayer`  | room containers, walls, doors, desks, slot frames, shelf back, queue-stack containers | nothing from other layers | room z-layers only            |
| `PersonaLayer` | persona sprites + their containers, codename labels, walk tweens | `lib/rooms.ts` anchors only; `RoomLayer.occupiedDeskKeys()` for stack offsets | persona z-layers only       |
| `TicketLayer` | ticket sprites + their containers, carry offsets, queue stacks, slot tweens, shelf slot assignments | `PersonaLayer.getCarrierPosition(personaId)` for carried tickets; `lib/rooms.ts` anchors | ticket and ticket-hero z-layers only |

A layer never reads from another layer's mutable internals. Cross-layer
reads go through narrow, read-only methods like
`PersonaLayer.getCarrierPosition`. Cross-layer writes do not exist.

### 4.2 Scene-level ownership

`OfficeScene` owns:

- Construction order: `RoomLayer` → `PersonaLayer` → `TicketLayer` (in
  ascending z-order). Construction happens before the first
  `'ready'` emit.
- The single emitter that all three layers share.
- The `applyProjects(project)` → `RoomLayer.applyProject(project)`
  delegation.
- The `applyPlacements({ personas, tickets })` →
  `PersonaLayer.applyPlacements(personas)` then
  `TicketLayer.applyPlacements(tickets)` delegation **in that order**:
  tickets read persona positions, so personas must settle first.

### 4.3 Pure-lib ownership

| Module                    | Owns                                                          |
| ------------------------- | ------------------------------------------------------------- |
| `lib/rooms.ts`            | all floor coordinates (read-only across the codebase)         |
| `lib/agent-positions.ts`  | derives `{ personas: PersonaPlacement[], tickets: TicketPlacement[] }` from `WorkItemDto[]` |
| `lib/state-to-room.ts`    | factory state → room id mapping                                |
| `lib/state-indicators.ts` | factory state → indicator glyph mapping                        |
| `lib/persona-codenames.ts`| deterministic codename hash + canonical pool                   |
| `lib/ticket-carry.ts`     | offset math for `position='carried'` and `position='desk'`    |
| `lib/pathfinding.ts`      | same-floor waypoint planning (unchanged)                       |

No Phaser import in `lib/`.

---

## 5. Carried-ticket semantics

A ticket whose `position='carried'` follows its carrier persona's
**rendered** position. This is a render-time follow, not a tween, and
must update every frame the persona moves.

### 5.1 Carry offset

Per Board 02 §5.3:

- Offset is `(+10, −12)` relative to the persona container origin.
- Origin convention: persona origin is `(0.5, 1)` (bottom-center);
  ticket origin is `(0.5, 0.5)` (centered). The offset is computed
  from the persona's container `x`, `y` directly.

### 5.2 Follow implementation

Option A (selected): parent the `TicketSprite.container` to the
`PersonaSprite.container` when `position='carried'`; offset is the
ticket container's local `x`, `y`. On `position` transition out of
`'carried'`, re-parent to the scene root and snap to the new
absolute position.

Option B (rejected): per-frame copy in `update()`. Rejected because
phase 3 must not introduce a per-frame update loop; Phaser parent-child
positioning is free.

### 5.3 Position transitions

| From → To             | Trigger                                | Phaser action                                                  |
| --------------------- | -------------------------------------- | -------------------------------------------------------------- |
| `carried` → `desk`    | persona arrives at desk anchor          | re-parent to scene root; snap to desk's ticket-attach anchor   |
| `desk` → `carried`    | persona leaves desk for another room    | re-parent to persona container with offset `(+10, −12)`        |
| `carried` → `queue`   | (rare in phase 3; phase 4 will trigger when persona departs without ticket — not in v1) | not encountered in phase 3 |
| `queue` → `carried`   | persona arrives at queue head, picks up | re-parent + offset                                             |
| any → `slot`          | ticket enters a slot transit (phase 5)  | re-parent to scene root; deferred tween logic                  |
| `slot` → any          | ticket leaves slot                      | re-parent + appropriate anchor                                 |
| any → `shelf`         | `mergeCelebration` lands ticket (phase 5) | re-parent to scene root; snap to shelf-slot anchor          |
| any → `free`          | brief in-transit between owners         | re-parent to scene root; held at last known anchor             |

Phase 3 must implement `carried`, `desk`, `queue`, `shelf` transitions
geometrically (snap or re-parent). Slot transits are **stubbed**: the
ticket teleports to the destination anchor with no animation. Phase 5
replaces the teleport with a real slot tween. Wiring is in place; tween
is not.

---

## 6. Queue ownership

Queue stacks render at the corridor side of every open-entry room
(Triage, Investigation, Dev, QA-input, Review). Per Board 02 §8, depth
ranges map to one of four texture tiers, plus a `+N` numeric badge for
the highest tier.

### 6.1 Queue owner

`TicketLayer` owns queue stacks. They are not separate sprite classes;
they are stack-anchor positions that `TicketLayer` writes a single
texture-swapping sprite + optional text into per room.

```
TicketLayer.queueStacks: Map<RoomId, { stackSprite: Phaser.GameObjects.Image, badge?: Phaser.GameObjects.Text }>
```

### 6.2 Queue contents

A ticket whose `position='queue'` and `roomId=R` is **counted** in the
queue stack at room `R`'s queue anchor. It is **not** rendered as an
independent sprite while queued: the stack texture *represents* it.

Exception: the currently-hero ticket is never counted in a stack and is
always rendered as its own sprite, regardless of position (per Board 02
§8). When the hero ticket happens to be at a queue position, the stack
depth is computed *excluding* it.

### 6.3 Queue derivation

`lib/agent-positions.ts` emits ticket placements with `position='queue'`
when the work item is in a state mapped to a room but no persona is
currently seated at any desk in that room with a matching room id, **and**
the room is at capacity, **and** the work item is not the current hero.

For v1 the "at capacity" rule simplifies to: queues exist only at
Investigation (when wave is mid-flight) and Dev (when all 3 builder
desks are occupied). All other rooms have no queue depth in the v1
journey because only one ticket is in motion. Phase 4 / 5 do not change
this; phase 6 may surface depth as an overlay regardless.

### 6.4 Hero label and banner cell

When a ticket becomes hero (per Board 02 §11), two side-effects occur:

- The carrier `PersonaSprite` adds a codename `Phaser.GameObjects.Text`
  label at `(persona.x, persona.y − 28)` on z=`persona-overlays`.
- The Board 02 §3 banner's right-cell (Active Hero Ticket) updates to
  `#{externalId} — {title|truncated}`.

The banner update is a one-way write from the scene to its own banner
text. Banner text is owned by `RoomLayer` (it was added during the
phase 2 floor build); `RoomLayer` exposes a single method
`RoomLayer.setHeroTicketCell(text: string | null)` that `TicketLayer`
calls on hero promotion / release. This is the **one** cross-layer
write path in phase 3 and is restricted to a string label — no game
state.

When hero releases (sticky timeout, click-elsewhere, or cinematic
end), the codename label is destroyed and the banner cell is cleared.

---

## 7. Slot transit semantics (phase-3 stubs)

Per Board 02 §9, slots have three anchors: `queueAnchor`,
`exteriorAnchor`, `interiorAnchor`. A ticket "crosses a slot" by tweening
through the three anchors in sequence.

In phase 3, the **logic of when a ticket changes slot position is not
wired to events.** Phase 4 introduces event-driven slot transit. Phase
3 is purely structural:

- `TicketLayer` exposes `setTicketSlotPosition(ticketId, slotId,
  anchorKind)` where `anchorKind ∈ {'queue', 'exterior', 'interior'}`.
- The method snaps (no tween) the ticket to the requested anchor.
- A future caller (phase 4 choreography intent) will sequence three
  calls 200ms apart to animate the transit. Phase 3 never calls these
  in sequence from inside the scene.

This separation matters because it isolates *geometry* (phase 3) from
*timing* (phase 4). Both must be tested independently.

---

## 8. Hero promotion interaction

Phase 3 implements hero promotion **only on click**. Other promotion
triggers (lane-driven, transition-driven, sticky window) require the
choreography player and are phase 5.

### 8.1 Click promotion

A ticket click handler (the per-sprite `pointerdown` registered in
`TicketLayer.spawn`) does two things:

1. Emits `'desk-click'` on the scene emitter (preserves M17 behaviour;
   React routes this to the DeskDetailPanel).
2. Promotes the ticket to hero locally for 10 seconds. After 10 s the
   hero releases via a Phaser timer (`scene.time.delayedCall`).

Re-click on the same ticket resets the 10s window. Click on a different
ticket transfers hero (the previous hero releases immediately, the new
one promotes). Click outside any ticket releases hero on the current
sticky after the timer expires (no early release in phase 3 — that's a
phase 4 lane interaction).

### 8.2 Promotion side-effects

On promote:
- Ticket sprite moves to `z = ticket-hero` (45).
- A `glow` image is added as a sibling at `z = effects` (50), parented
  to the ticket container.
- If the ticket has a carrier persona, the carrier gains a codename
  label (see §6.4).
- Banner Hero-Ticket cell updates.

On release:
- Reverse all of the above. Move ticket back to `z = tickets` (40).
- Destroy the glow image.
- Destroy the codename label.
- Clear the banner cell.

### 8.3 Camera

Phase 3 **does not** switch camera to `hero-ticket-follow`. Camera
remains at `floor-overview`. Phase 5 wires the camera switch as part
of the primary-lane cinematic.

---

## 9. Layer / z-index expectations

Inherit from Board 02 §7. Phase 3 adds nothing to the z-table.

Layer construction order in `OfficeScene.create()`:

```
new RoomLayer(...)        // populates z=0..25
new PersonaLayer(...)     // populates z=30..35
new TicketLayer(...)      // populates z=40..50 (45 for hero; 50 for glow)
```

`TicketLayer.spawn()` must `setDepth(40)` on the container by default,
and `setDepth(45)` on promotion. `PersonaLayer.spawn()` must
`setDepth(30)` on the container; codename label, when present, is its
own `Text` at `setDepth(35)`.

The `canvas-hud` layer (z=60) is owned by `RoomLayer` for now (banner
+ static text). Phase 6 introduces real HUD overlays that may add new
text at z=60; the layer is unchanged here.

---

## 10. Deterministic stand-in persona rules

Until the server emits a `personaId` on each `WorkItemDto`, the slice
derives a deterministic codename per work item. This is a visual
stability shim — same input always yields the same name within a
session, even though the name is fabricated.

### 10.1 `lib/persona-codenames.ts`

```ts
export const CODENAME_POOL: readonly string[] = [
  // ~30 entries, sourced from the operational-model canon
  // e.g. "Grey Honker", "Cinder Drake", "Pale Tern", "Brass Magpie",
  // "Iron Skua", "Slate Pelican", "Amber Heron", "Rust Cormorant", ...
];

export function codenameFor(seed: string): string {
  // Deterministic 32-bit FNV-1a or similar → index into CODENAME_POOL.
  // Must be pure and import-only (no Math.random, no Date.now).
}
```

The exact hash is unconstrained; correctness is "deterministic +
import-only." Tests assert:

- `codenameFor('a') === codenameFor('a')`
- `codenameFor` returns a string from `CODENAME_POOL`.
- Reasonable distribution (e.g. 100 distinct seeds yield >20 distinct
  names — soft assertion, not strict).

### 10.2 Seed source

v1 seed is `${projectSlug}:${externalId}`. The codename derives per
**ticket**, not per persona, because v1 has no persona identity from
the server. The mental model: "this issue's owner is always Grey
Honker." When the server begins emitting `personaId`, the seed source
swaps in `lib/agent-positions.ts`; the codename function and pool are
unchanged.

This is a deliberate **mis-modelling** (a codename per ticket, not per
persona) to ship a stable visual without forcing the server to plumb
identity now. Phase 4 does not depend on it. The right model lands
later.

### 10.3 No invented archetypes

The codename is the only persona-stand-in render. Phase 3 does **not**:
- Vary persona body texture per persona.
- Vary persona pace per model tier.
- Render persona stat badges, streaks, win counts.

All of those exist in the operational model. None ships in v1.

---

## 11. Boundary preservation checks

A future change in phase 3 that breaks any of the below is rejected.

| Boundary                              | Check                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------- |
| React ↔ Phaser                        | `OfficeScene.applyPlacements` accepts `{ personas, tickets }` only; no event subscription in the scene |
| Scene-local ownership                 | `PersonaLayer` and `TicketLayer` do not import each other                |
| Pure libs                             | `lib/persona-codenames.ts` and `lib/ticket-carry.ts` have zero Phaser imports |
| No mutation of workflow state         | Grep for `fetch(`, `postMessage(`, `mutateAsync` in `apps/web/src/components/office/game/` returns no matches |
| One coordinate source                 | Grep for tile-pixel literals (16, 88, 112, 136, 168, 200, 232, 280, 288, ...) in `game/` returns only `lib/rooms.ts` imports |
| Single project                        | `OfficeScene.applyProjects` signature is `(project: OfficeProject)`, not array; mount + tab unchanged |

---

## 12. What `lib/agent-positions.ts` looks like after phase 3

Public signature:

```ts
export function placementsFromItems(items: readonly WorkItemDto[]): {
  personas: PersonaPlacement[];
  tickets: TicketPlacement[];
};

export interface PersonaPlacement {
  personaId: string;
  codename: string;
  roomId: RoomId | null;     // null = freeze in place (needs-human / gate-pending)
  deskSlot: number;          // -1 if walking / queued at door
}

export interface TicketPlacement {
  ticketId: string;
  externalId: number;
  title: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  carrierPersonaId: string | null;
  position: 'carried' | 'desk' | 'queue' | 'slot' | 'shelf' | 'free';
  roomId: RoomId | null;
  slotId: string | null;
  shelfSlot: number | null;
  indicator: IndicatorGlyph | null;  // existing M17 set
}
```

`placementsFromItems` is a pure function. Its only inputs are the work
items; its only outputs are the placements. Tests cover:

- Each phase-A..I state in `state-to-room` maps to the correct room.
- A `factory:investigating` item produces a persona at the investigation
  lab lead-desk slot.
- A `factory:in-progress` item produces a persona at one of the dev
  desks (deterministic — same item ID always picks the same desk).
- A ticket carried by an in-progress persona has
  `position='carried'`, `carrierPersonaId=<that persona>`.
- A ticket in `factory:done` has `position='shelf'`, `shelfSlot ∈ 0..4`.

---

## 13. Sequence of edits

1. **Create `lib/persona-codenames.ts`** with `CODENAME_POOL` and
   `codenameFor`. Add unit tests in `slice.test.ts`. Verify `pnpm test`.
2. **Create `lib/ticket-carry.ts`** with `ticketCarryOffset(): {dx, dy}`,
   `ticketAtDeskOffset(): {dx, dy}` (per Board 02 §5.3). Add unit tests.
3. **Refactor `lib/agent-positions.ts`** to emit
   `{ personas, tickets }`. Update tests for the new return type.
   Other callers of `placementsFromItems` (only `OfficeScene` /
   `SpriteLayer` consume it) tolerate the new shape behind a thin
   adapter that flattens to the old `AgentPlacement[]` for one commit.
4. **Create `layers/PersonaLayer.ts`.** Copy persona-handling code out
   of `SpriteLayer` (spawn, walk, indicator update, destroy). Wire to
   the scene. Behaviour must match `SpriteLayer` for personas. Verify.
5. **Create `layers/TicketLayer.ts`.** Implement ticket sprite spawn /
   destroy. Implement carry follow via container re-parenting. Implement
   queue stack rendering at room queue anchors. Stub slot transit
   (snap, no tween). Stub shelf landing (snap to shelf slot). Verify.
6. **Delete `layers/SpriteLayer.ts`.** Remove the flatten adapter from
   step 3. `OfficeScene.applyPlacements` now takes
   `{ personas, tickets }`. Update `OfficeTab` to pass the destructured
   value through `OfficeGameMount`.
7. **Wire hero promotion on click** (per §8). Add `TicketLayer.promote`
   / `release` methods; route per-sprite `pointerdown` through promote.
   Add `RoomLayer.setHeroTicketCell` for the banner update.
8. **Visual verification** — open the office tab in dev server, click
   a ticket, observe glow + label + banner update; wait 10s, observe
   release; click a different ticket, observe transfer.

Each step compiles and passes tests. Do not batch.

---

## 14. Test surface

### Unit tests (`apps/web/src/components/office/slice.test.ts`)

Existing tests (rooms / layout / pathfinding / state-to-room /
state-indicators) stay green untouched. New tests:

- `persona-codenames`: determinism + pool membership + distribution.
- `ticket-carry`: offset values match spec; result is pure.
- `agent-positions` (rewritten): per-state placement assertions,
  covering each room and each `position` discriminator.

Target: existing 27 unit tests + ~15 new tests = ~42 total.

### E2E tests

- `office-click-through.spec.ts` must remain green.
- Add a `phase-3` opt-in screenshot run (`RUN_SCREENSHOTS=1`) that
  captures: floor with one queued ticket, click promotes to hero, hero
  released after 10s. Not required for CI green.

### Manual verification checklist

Before opening the PR:

- [ ] Office tab loads at `/projects/:slug/office` with no console errors.
- [ ] Personas render at the correct rooms / desks for current state.
- [ ] Tickets render as carded sprites at carry offsets when working;
      at desk attach anchors when seated; at queue anchors when queued.
- [ ] Queue stacks at room doorways swap texture tier as depth changes
      (depth 0 → no sprite; depth 1..2 → 1-card; etc.).
- [ ] Hero click promotes: glow appears, codename label appears, banner
      Hero-Ticket cell updates.
- [ ] Hero release after 10s: glow gone, label gone, banner clears.
- [ ] Click another ticket: hero transfers.
- [ ] FloorIndicator + DeskDetailPanel still work.
- [ ] No layout jumps on browser resize.

---

## 15. Acceptance criteria

The PR is mergeable iff:

- [ ] `pnpm test` passes (~42 unit tests).
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` passes.
- [ ] `office-click-through.spec.ts` passes in CI.
- [ ] `layers/SpriteLayer.ts` is deleted.
- [ ] `layers/PersonaLayer.ts` exists and is ≤ 250 lines.
- [ ] `layers/TicketLayer.ts` exists and is ≤ 300 lines.
- [ ] `lib/persona-codenames.ts` exists with `CODENAME_POOL` of
      ≥ 24 entries and a pure `codenameFor`.
- [ ] `lib/ticket-carry.ts` exists with pure offset functions.
- [ ] No imports between `PersonaLayer` and `TicketLayer`.
- [ ] No Phaser imports in `lib/`.
- [ ] No coordinate literals in `game/` or `components/` outside
      `lib/rooms.ts` imports (grep check from Board 02 §18).
- [ ] No `fetch` / `postMessage` / label-write calls in
      `apps/web/src/components/office/game/`.
- [ ] Manual verification checklist all ticked.
- [ ] No new dependencies in `apps/web/package.json`.

---

## 16. Stop conditions

Stop and ask the human if any of the following occur:

- Board 02 §1.5 ownership invariant becomes hard to honour. Example: you
  find yourself wanting to write a label or `fetch` a state from inside
  a layer. The architecture forbids it; do not work around it.
- A test asserts behaviour that's actually a phase 4 concern (timing,
  event handling, lane priority). Move the test out of phase 3.
- The persona placement logic forces a "one persona per role" collapse
  again. Phase 3 must support multiple personas per room; if the math
  doesn't, the data model is wrong.
- `lib/rooms.ts` requires a coordinate change. It shouldn't. If it
  does, that's a Board 02 spec change; ADR before proceeding.
- The carry-follow implementation needs a per-frame update loop. It
  should not; Phaser parent-child positioning handles this for free.

---

## 17. Explicit non-goals

Restated from §1 because they are the most common ways phase 3 work
drifts into phase 4 / 5:

- **No SSE event handling.** Tickets and personas update on
  `applyPlacements` only.
- **No choreography player, intents, lanes, or timelines.** All phase 4.
- **No verdict scroll, envelope, particle, ring, or pulse visuals.**
  Phase 5.
- **No camera switching.** `floor-overview` only.
- **No persona variants** (per-role textures already exist from M17;
  no per-persona, per-tier, or per-stat variants).
- **No TDD-heartbeat glyphs, monitor flicker, tool-call animations.**
- **No queue interaction beyond a click that opens a panel** — the
  panel itself is not in scope; the click zone is registered, the
  React handler is phase 6.
- **No sound. No ambience. No procedural anything.**

If a future phase needs work that *feels* like it belongs in phase 3,
move it. Phase 3 must stay narrow.

---

## 18. What happens after Phase 3

Phase 4 (next session, after Phase 3 PR merges):

- Add `EventSource('/events')` direct subscription in `OfficeTab` (in
  parallel to the existing React Query invalidation, not in place of).
- Author `lib/choreography.ts` — intent registry + lane assignments.
- Add `ChoreographyPlayer` to `OfficeScene`; expose `applyChoreography`.
- Implement `walkToRoom`, `attachToDesk`, `swapIndicator` as the first
  three intents. They re-use phase 3's persona walk + ticket carry
  primitives.

Phase 5: the four cinematics.
Phase 6: the HUD overlays.

This plan only covers Phase 3.
