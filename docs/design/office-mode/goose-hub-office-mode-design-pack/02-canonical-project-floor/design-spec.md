# Board 02 — Canonical Project Floor — Design Spec

**Status:** Authored. Authoritative spatial contract for the Office Mode Vertical Slice v1.

**Scope:** ONE project floor. Six rooms. One cinematic ticket journey
(TODO → Investigation Wave → Dev → QA Fail → Return To Dev → Review → Merge).

**Do not implement yet.** This document is the brief that
Phase 2 of the implementation roadmap will consume to write
`lib/rooms.ts` (and adjust `lib/layout.ts`, `lib/pathfinding.ts`) deterministically.

Anything not nailed down by numbers in this file is deliberately out of v1 scope.

---

## 1. Purpose & contract

This spec defines:

- Floor geometry (tile grid, walls, corridor, rooms).
- Per-room anchors: door, desks, stations, slots, shelves, dials, queues, click zones.
- Movement lanes and ticket carry conventions.
- Camera anchors (named, reserved for future zoom).
- Z-index layer ordering.
- Hero-task focus rules.
- Mapping from factory states → rooms (v1).
- Mapping from choreography lanes (critical / primary / ambient) → anchors.

Once frozen, no implementer needs to re-derive any of these numbers.
A change to a coordinate in this file is a spec change with an ADR;
a change in code without changing this file is a bug.

---

## 1.5 Ownership invariant (read this first)

**The Phaser office is a visualisation layer only.**

The canonical sources of truth remain, unchanged:

- WorkItem state on the source-of-truth backend (GitHub Issues, indexed in SQLite).
- `factory:*` state labels.
- Orchestration events on the SSE `/events` stream.
- Persona routing, budgets, and any other operational state — all server-side.

The office:

- **Reads** orchestration truth (work items + events + labels).
- **Derives** placements, tickets, and choreography intents from that truth.
- **Renders** those derivations as personas, tickets, rooms, animations, overlays.

The office **never**:

- Mutates a `factory:*` label.
- Writes to the WorkItem store.
- Posts a GitHub comment, opens an issue, edits a body.
- Holds any state that another system would treat as authoritative.

### Sprite ownership

`PersonaSprite` and `TicketSprite` are **visual projections only.**
They expose properties (position, attached desk, indicator, badge counters)
that describe what they currently render. They do not expose methods that
mutate workflow state. A click on either may emit a scene event that React
forwards to a workflow-aware handler (e.g. open the detail panel) — the scene
itself does not initiate a transition.

### Movement ownership rules

When a WorkItem is actively being carried or worked by a visible persona,
the `TicketSprite` follows the `PersonaSprite`'s rendered movement
(see §5.3 carry conventions).

When a WorkItem is:

- queued at a room doorway,
- passing through a sealed slot (Library envelope-out, QA input/output, Review door),
- represented as a verdict scroll or scout-report envelope,
- mid-merge celebration,
- resting on the Done shelf,

…the `TicketSprite` owns its own rendered movement. No persona drives it.
This is the "ticket as autonomous prop" case: a verdict scroll emerging from
the QA output slot is not carried by any goose.

In every case the **rendered** movement is derived from real WorkItem state,
labels, and orchestration events. No Phaser sprite owns workflow state or
mutates kanban state.

---

## 2. Coordinate system & conventions

| Concept              | Value                                                            |
| -------------------- | ---------------------------------------------------------------- |
| Tile size            | **16 px** (matches existing `TILE_SIZE` in `lib/layout.ts`)      |
| Floor grid           | **80 tiles wide × 24 tiles tall** = **1280 × 384 px**            |
| Origin               | top-left `(0, 0)`; `+x` east, `+y` south (Phaser default)        |
| Tile → pixel         | `px = tx × 16`, `py = ty × 16` (top-left of tile)                |
| Tile center → pixel  | `px = (tx + 0.5) × 16`, `py = (ty + 0.5) × 16`                   |
| Game pixelArt        | `true` (no antialiasing); existing M17 setting preserved         |
| Scale mode           | `Phaser.Scale.RESIZE`; world larger than canvas → camera scrolls |
| Anchor conventions   | tiles & walls origin `(0, 0)`; furniture origin `(0.5, 1)`; personas origin `(0.5, 1)`; tickets origin `(0.5, 0.5)` |

Notation in this document:

- `tx`, `ty` — tile coordinates (integers; half-step values denote tile-center).
- `px`, `py` — pixel coordinates (world space).
- `(px, py)` triples in tables are pixel coordinates unless prefixed `tile:`.

All ranges are **inclusive on both ends** (`tx=1..10` means 10 tiles wide, columns 1 through 10).

---

## 3. Floor geometry overview

```
                          ┌───── 80 tiles / 1280 px ─────┐
              ┌─ty=0 ──── ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓     top wall
              │           │     banner / labels ty=1..3 │
              │  ty=4..6  │   ◄═══ MAIN CORRIDOR ═══►   │     east-west walk lane
              │  ty=7 ─── ┼─door─┼door┼door┼slt slt┼dor┼─dor┤    room ceilings (gaps = doors / slots)
              │           │      │    │    │       │   │    │
   24 tiles   │  ty=8..21 │ TRI- │ INV │ DEV │ QA   │REV│DONE│    room interiors
   /384 px    │           │ AGE  │+LIB │     │ SEAL │FRST    │
              │           │      │     │     │      │   │    │
              │  ty=22    │      bottom inner strip       │       (reserved for queue overflow)
              └─ty=23 ─── ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓     bottom wall

Inter-room walls (vertical, 1 tile thick) at tx = 11, 27, 45, 58, 69
Outer walls at tx = 0 and tx = 79
```

### Vertical zones

| Tile rows | Pixel rows  | Purpose                                                                 |
| --------- | ----------- | ----------------------------------------------------------------------- |
| `ty=0`    | `py=0..15`  | Top exterior wall                                                       |
| `ty=1..3` | `py=16..63` | Banner zone — three cells (see below)                                    |
| `ty=4..6` | `py=64..111`| **Main corridor** — east-west walking lane; queue stacks live here      |
| `ty=7`    | `py=112..127`| Room ceiling row — door gaps and slot gaps live here                   |
| `ty=8..21`| `py=128..351`| Room interiors                                                         |
| `ty=22`   | `py=352..367`| Lower utility strip (reserved; no v1 furniture)                        |
| `ty=23`   | `py=368..383`| Bottom exterior wall                                                   |

### Banner zone (ty=1..3) — three cells

| Cell | Tile range (tx) | Pixel range (px) | Content                                           |
| ---- | --------------- | ---------------- | ------------------------------------------------- |
| L    | `tx=1..26`      | `16..431`        | **Project Name** (left-aligned, 14px JetBrains Mono) |
| C    | `tx=27..52`     | `432..847`       | **Mode** badge (`interactive` / `supervised` / `autonomous`) — center-aligned, 12px, mode-tinted background |
| R    | `tx=53..78`     | `848..1263`      | **Active Hero Ticket** — `#1234 — title` truncated; right-aligned, 12px; blank when no hero |

The hero-ticket cell updates as a side-effect of hero promotion (§11); other
cells are static per session. All three are rendered as `Phaser.GameObjects.Text`
on the canvas-hud layer (`z=60`).

### Horizontal zones (left to right)

| Room          | Wall (W) | Interior tx     | Wall (E) | Width (tiles) | Notes                                  |
| ------------- | -------- | --------------- | -------- | ------------- | -------------------------------------- |
| (outer wall)  | `tx=0`   | —               | —        | 1             | left exterior                          |
| Triage        | shared   | `tx=1..10`      | `tx=11`  | 10            | open                                    |
| Investigation | `tx=11`  | `tx=12..26`     | `tx=27`  | 15            | open + sealed sub-room (Library)        |
| Dev           | `tx=27`  | `tx=28..44`     | `tx=45`  | 17            | open; 3 visible builder desks           |
| QA            | `tx=45`  | `tx=46..57`     | `tx=58`  | 12            | sealed (no walk-through; two slots)     |
| Review        | `tx=58`  | `tx=59..68`     | `tx=69`  | 10            | frosted (silhouettes through walls)     |
| Done          | `tx=69`  | `tx=70..78`     | `tx=79`  | 9             | open; shelf along north of interior     |
| (outer wall)  | —        | —               | `tx=79`  | 1             | right exterior                          |

Total interior columns: 73. Walls: 7 (2 outer + 5 inter-room). Sum: 80. ✓

---

## 4. Room inventory

Each room block below specifies: interior bounds, ceiling door/slots, primary anchors,
queue zone, click zones, seal semantics, and hero promotion notes.

All pixel values are **world coordinates** and assume floor origin at `(0, 0)`.

### 4.1 Triage corner — `room.triage`

| Field              | Value                                                                       |
| ------------------ | --------------------------------------------------------------------------- |
| Interior tx        | `1..10` (10 tiles wide)                                                     |
| Interior ty        | `8..21` (14 tiles tall)                                                     |
| Pixel bounds       | `(16, 128) → (175, 351)` (interior only; walls excluded)                    |
| Door (north wall)  | `ty=7`, `tx=4..5` — 2-tile gap. Door **center: (80, 112)**                  |
| Seal               | open                                                                        |
| Triager desk       | tile `(3.5, 12.5)` → **(56, 200)** — anchor origin `(0.5, 1)`               |
| Stamp pad fixture  | tile `(3.5, 11.5)` → **(56, 184)** — decorative; no interaction             |
| Floor inbox tile   | tile `(2, 14)` → **(32, 224)** — courier drop-off point (v1 stand-in for lobby) |
| Queue zone         | corridor strip at `tx=3..6, ty=4..6` (2×3 tile area) — stack anchor `(72, 88)` |
| Click zone         | rect `tile (1..10, 11..14)` → world `(16..175, 176..239)`                   |
| Active states (v1) | `factory:triaging`, `factory:accepted`, plus deferred-discovery overflow (see §13) |
| Hero promotion     | ticket on the triage desk for ≥ 1 second is hero                            |

### 4.2 Investigation Lab + sealed Library — `room.investigation`

This room is the composite of an **open lab** and a **sealed Library sub-chamber**.
The Library is the Wave-1 scout holdout and is fully enclosed inside the larger room.

| Field                        | Value                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------ |
| Outer interior tx            | `12..26`                                                                       |
| Outer interior ty            | `8..21`                                                                        |
| Outer pixel bounds           | `(192, 128) → (431, 351)`                                                      |
| North door (from corridor)   | `ty=7`, `tx=24..25` — door **center: (392, 112)**. Gap is on the **east edge** of the room because the Library occupies the west portion of the ceiling row. |
| **Library (sealed sub-room)** |                                                                                |
| Library interior tx          | `13..22` (10 tiles wide)                                                       |
| Library interior ty          | `9..12` (4 tiles tall)                                                         |
| Library pixel bounds         | `(208, 144) → (367, 207)`                                                      |
| Library walls (inside outer) | west `tx=12`, north `ty=8`, east `tx=23`, south `ty=13`                        |
| Library envelope slot        | south wall `ty=13`, `tx=17..18` — slot **center: (288, 216)**                  |
| Library scout desks (3)      | tile `(14.5, 10.5)`, `(17.5, 10.5)`, `(20.5, 10.5)` → **(232, 168)**, **(280, 168)**, **(328, 168)** |
| Reserved scout desks (3..6)  | tile `(15, 11.5)`, `(19, 11.5)`, `(22, 11.5)` — present in tile grid, sprite-empty until scout count scales above 3 |
| Library click zone           | rect `tile (13..22, 9..12)` → world `(208..367, 144..207)`                     |
| **Investigation Lab (open)** |                                                                                |
| Open area shape              | L-shape: east strip `tx=24..26, ty=8..21` (3 wide × 14 tall) + south strip `tx=12..22, ty=14..21` (11 wide × 8 tall) |
| Lead investigator desk       | tile `(17.5, 17.5)` → **(280, 280)** — faces the Library slot to the north     |
| Scout-report board fixture   | tile `(18, 14)` → **(288, 224)** — destination for envelopes south of the slot |
| Investigation queue zone     | corridor strip `tx=23..26, ty=4..6` — stack anchor **(392, 88)**               |
| Outer click zone (lead desk) | rect `tile (16..20, 16..19)` → world `(256..319, 256..319)`                    |
| Active states (v1)           | `factory:research-pending`, `factory:research-complete`, `factory:investigating`, `factory:investigation-complete` |
| Hero promotion               | scout wave fan-out — entire wave promotes to hero until `swarm.wave-completed` |

**Scout count: hardcoded to 3 in v1.** Canonical maximum is 6 plus 0..2 Wave-2;
those anchors are pre-allocated so the configurable upper bound does not
require geometry changes when v1 is followed by a slice that scales up. A
v1 implementation must instantiate exactly 3 scout sprites and never read a
configurable value for this count — that's a deliberate constraint to keep the
slice readable and to defer the "configurable per-project scout count" decision
to a later spec.

| Scout slot | Tile center  | Pixel center   |
| ---------- | ------------ | -------------- |
| 1          | `(14.5, 10.5)` | `(232, 168)` |
| 2          | `(17.5, 10.5)` | `(280, 168)` |
| 3          | `(20.5, 10.5)` | `(328, 168)` |
| 4 (reserved) | `(15, 11.5)`  | `(240, 184)` |
| 5 (reserved) | `(19, 11.5)`  | `(304, 184)` |
| 6 (reserved) | `(22, 11.5)`  | `(352, 184)` |

### 4.3 Dev floor — `room.dev`

| Field                       | Value                                                                       |
| --------------------------- | --------------------------------------------------------------------------- |
| Interior tx                 | `28..44` (17 tiles wide)                                                    |
| Interior ty                 | `8..21` (14 tiles tall)                                                     |
| Pixel bounds                | `(448, 128) → (719, 351)`                                                   |
| Door (north wall)           | `ty=7`, `tx=35..36` — door **center: (568, 112)**                            |
| Seal                        | open                                                                        |
| Builder desks (3 visible)   | tile `(32, 14.5)`, `(36, 14.5)`, `(40, 14.5)` → **(512, 232)**, **(576, 232)**, **(640, 232)** |
| Reserved 4th builder slot   | tile `(44, 14.5)` → **(704, 232)** — present, empty in v1                   |
| Dev-Review nook (deferred)  | reserved tile bounds `(42..44, 17..20)` — no v1 furniture                   |
| Desk-lamp anchors (per desk)| tile `(desk.tx, 13.5)` (just above the desk, 1 tile north) — controls active/idle lighting |
| Monitor flicker emitter     | tile `(desk.tx, 14)` — particle effect anchor; off until `agent.run-started` fires |
| Ticket-attach anchor (per desk) | tile `(desk.tx, 14)` — ticket sprite snaps here when persona is at desk |
| Queue zone                  | corridor strip `tx=34..37, ty=4..6` — stack anchor **(568, 88)**            |
| Click zones                 | three rects, one per desk: `tile (desk.tx − 1.5 .. desk.tx + 1.5, 13..16)` → e.g. `(488..535, 208..271)` for desk 1 |
| Active states (v1)          | `factory:dev-ready`, `factory:spec-ready`, `factory:in-progress`, `factory:needs-fix`, `factory:qa-failed`, `factory:retrospecting` |
| Hero promotion              | builder running an `agent.run-started` becomes hero for the active run duration; ticket attached to that desk also hero |

### 4.4 QA chamber — `room.qa`

**Sealed.** No walk-through door. Only the input slot and the output slot bridge
the chamber to the corridor. Personas inside QA never leave the room
(rendered as silhouettes; identity not exposed). This visual contract is the
literal counterpart of the QA-skill `contextAllowlist` and the holdout-context
validator.

Each slot has **three distinct anchors** (this naming applies to every slot
in the building — see §9):

- `queueAnchor` — corridor-side, on the walking lane (`py=88`). Where the queue stack visually sits and where a ticket pauses in the corridor before entering / after leaving the slot.
- `exteriorAnchor` — corridor-side, immediately adjacent to the wall (`py=96`). The "lip" of the slot on the outside.
- `interiorAnchor` — inside the room, one tile south of the wall (`py=136`). The "lip" of the slot on the inside.

A ticket traverses a slot by tweening `queueAnchor → exteriorAnchor →
interiorAnchor` (inbound) or the reverse (outbound). The exterior and interior
anchors only differ from the queue anchor by ~25 px each, but distinguishing
them lets the slot "punching through" animation read cleanly.

| Field                       | Value                                                                        |
| --------------------------- | ---------------------------------------------------------------------------- |
| Interior tx                 | `46..57` (12 tiles wide)                                                     |
| Interior ty                 | `8..21` (14 tiles tall)                                                      |
| Pixel bounds                | `(736, 128) → (927, 351)`                                                    |
| North wall                  | `ty=7` — opaque, contains two slots only                                     |
| **Input slot**              | `ty=7`, `tx=49..50`                                                          |
| — queue anchor              | `(792, 88)`                                                                  |
| — exterior anchor           | `(792, 96)`                                                                  |
| — interior anchor           | `(792, 136)`                                                                 |
| **Output slot**             | `ty=7`, `tx=53..54`                                                          |
| — queue anchor              | `(856, 88)` (used only for verdict-scroll exit pause; no queue stack here)   |
| — exterior anchor           | `(856, 96)`                                                                  |
| — interior anchor           | `(856, 136)`                                                                 |
| Retry-counter overlay       | corridor side, tile `(49, 6)` → world **(784, 96)** — numeric badge above input slot |
| Tier-disagreement light     | corridor side, tile `(53, 6)` → world **(848, 96)** — anchor reserved; not wired in v1 (see §16) |
| QA stations (3 silhouettes) | tile `(48, 14.5)`, `(52, 14.5)`, `(56, 14.5)` → **(768, 232)**, **(832, 232)**, **(896, 232)** |
| Click zone                  | rect `tile (46..57, 7..9)` → world `(736..927, 112..159)` — covers north wall and slots; opens "QA status" panel |
| Seal indicator              | wall texture rendered with frosted-blue tint; persona silhouettes inside dimmed 40% |
| Active states (v1)          | `factory:needs-qa`                                                           |
| Hero promotion              | ticket promotes to hero during `qa.functional-failed` cinematic (verdict scroll exit + corridor pulse + reroute) |

### 4.5 Review chamber — `room.review`

**Frosted.** Walls are translucent — silhouettes visible, identities not.
Walk-through door exists but is **closed by default**. Door state is bound to
review-convergence events:

- Closed: tickets do not pass; queue stack grows.
- Open: triggered by `review.converged`; remains open for 1.2 s of animation; then closes again.

| Field                  | Value                                                                        |
| ---------------------- | ---------------------------------------------------------------------------- |
| Interior tx            | `59..68` (10 tiles wide)                                                     |
| Interior ty            | `8..21` (14 tiles tall)                                                      |
| Pixel bounds           | `(944, 128) → (1103, 351)`                                                   |
| Door (north wall)      | `ty=7`, `tx=63..64` — door **center: (1016, 112)**. Default closed.          |
| Round-counter overlay  | corridor side, tile `(64, 6)` → world **(1024, 96)** — badge above door      |
| QualityScore dial      | mounted on door frame east side, tile `(66, 6.5)` → world **(1064, 104)** — dial face shows score 0..100 |
| Reviewer silhouettes (2) | tile `(61, 14.5)`, `(66, 14.5)` → **(976, 232)**, **(1056, 232)**           |
| Critical-finding stamp anchor | tile `(63.5, 9.5)` → **(1016, 152)** — used only when `review.escalated` fires (deferred from v1 cinematic catalogue) |
| Queue zone             | corridor strip `tx=62..65, ty=4..6` — stack anchor **(1016, 88)**            |
| Click zone             | rect `tile (59..68, 7..10)` → world `(944..1103, 112..175)` — covers door, dial, north wall |
| Seal indicator         | wall texture rendered with frosted-grey tint; silhouettes inside dimmed 30%  |
| Active states (v1)     | `factory:needs-review`, `factory:approved`, `factory:merge-conflict`         |
| Hero promotion         | ticket promotes to hero during `review.converged` cinematic                  |

### 4.6 Done shelf — `room.done`

| Field                  | Value                                                                        |
| ---------------------- | ---------------------------------------------------------------------------- |
| Interior tx            | `70..78` (9 tiles wide)                                                      |
| Interior ty            | `8..21` (14 tiles tall)                                                      |
| Pixel bounds           | `(1120, 128) → (1263, 351)`                                                  |
| Door (north wall)      | `ty=7`, `tx=74..75` — door **center: (1192, 112)**                            |
| Seal                   | open                                                                         |
| Shelf row              | tile row `ty=10`, slot centers at `tx=71.5, 73, 74.5, 76, 77.5` → **(1144, 168)**, **(1168, 168)**, **(1192, 168)**, **(1216, 168)**, **(1240, 168)** |
| Shelf semantics        | most recent merged ticket appears at **slot 3 (1192, 168)**; existing tickets shift outward; tickets pushed off either end **fade outward over 800 ms** then despawn |
| Done-day badge         | tile `(74, 18)` → world **(1184, 296)** — small counter ("3 today") below shelves |
| Queue zone             | none (no items wait to enter; merge celebration delivers them directly)      |
| Click zone             | rect `tile (70..78, 10..13)` → world `(1120..1263, 160..223)` — opens "Recent merges" panel |
| Active states (v1)     | `factory:done`, `factory:archived`                                           |
| Hero promotion         | ticket is hero during `mergeCelebration`; reverts to ambient on shelf-landing |

---

## 5. Movement & path lanes

### 5.1 Main corridor

| Property              | Value                                                                  |
| --------------------- | ---------------------------------------------------------------------- |
| Tile band             | `ty=4..6` (3 tiles tall)                                               |
| **Walking lane**      | `ty=5` center — **`py = 88`** (this is the canonical `corridorY` for v1) |
| Walkable span (tx)    | `1..78` (inclusive between outer walls)                                |
| Wall obstacles within | none — corridor is unbroken east-west                                   |
| Vertical entries (doors / slots) | see room table; each room has exactly one entry column |

**Implementation note:** existing `lib/pathfinding.ts:corridorY()` returns
`floorOriginY + TILE_SIZE * 4` = `py = 64` (top of band). For v1 it must
return `py = 88` (center of band) or be replaced by `corridorWalkY()` in a new
`lib/rooms.ts`. Decide in Phase 2; this spec mandates the value, not the function.

### 5.2 Entry/exit lanes per room

A persona arriving at a room from the corridor follows:

```
corridor walking lane (py=88)
    │
    ▼  (vertical descent at door's tx)
door center (px, py=112)   ← y=7 ceiling row, gap
    │
    ▼
inside-door anchor (px, py=136)   ← ty=8, first interior row
    │
    ▼
room internal target (desk / station / shelf slot)
```

For QA (sealed), the persona terminates at the **input slot exterior anchor**
just north of the slot (corridor side). The ticket transfers through the slot;
the persona does not enter the chamber. The slot exterior anchor is the
queue-zone stack anchor (`(792, 88)` for QA).

### 5.3 Ticket carry conventions & movement ownership

See §1.5 for the foundational rule. The ownership detail per render state:

| WorkItem situation                          | Movement owner    | Ticket sprite position                                              |
| ------------------------------------------- | ----------------- | ------------------------------------------------------------------- |
| being carried/worked by a visible persona   | `PersonaSprite`   | offset `(+10, −12)` relative to persona container (above-right) — ticket follows persona |
| persona seated at desk                      | `PersonaSprite`   | snapped to desk's ticket-attach anchor (1 tile above desk top edge) |
| queued at a room doorway                    | `TicketSprite`    | offset within the queue stack quad; stack determines render position |
| passing through a sealed slot               | `TicketSprite`    | tweened along the slot's `queueAnchor → exteriorAnchor → interiorAnchor` line (or reverse) |
| represented as a verdict scroll             | `TicketSprite`    | scroll-prop tween from interior anchor through slot to corridor    |
| represented as a scout-report envelope      | `TicketSprite`    | envelope-prop tween from Library `envelope-out` slot to lead investigator desk |
| mid-merge celebration                       | `TicketSprite`    | corridor → Done door → shelf slot                                  |
| resting on Done shelf                       | `TicketSprite`    | snapped to shelf slot anchor                                       |

Tickets are **never freely orphaned** in the middle of the floor. If no carrier
exists, the ticket either belongs to a queue, a desk, a slot, or a shelf.

Neither sprite class exposes mutators for workflow state. Both expose
read-only properties describing their current rendered position, and a
click-event channel that emits scene events for React to handle.

### 5.4 Pathfinding rules for v1

- Same-floor only. (Cross-floor pathfinding in `lib/pathfinding.ts` is preserved but unused in v1.)
- Same as M17's `sameFloorPath`: `from → vertical-up to corridor → horizontal across corridor → vertical-down to to`.
- Speed: keep M17's `WALK_PIXELS_PER_MS = 0.35` for personas. **Tickets in transit** (carried by no one — e.g. verdict scroll exit) use `0.45` to read as "system motion" not "person walking."
- No diagonal movement.
- Walls are honoured by routing through the corridor only; no inside-room pathfinding.

---

## 6. Camera anchors

For v1, the active camera anchors are **`floor-overview`** and **`hero-ticket-follow`**.
All other anchors are reserved (declared here so future zoom work doesn't reshuffle).

| Name                    | Center (world px)     | Zoom (v1) | Zoom (future) | Used in v1 |
| ----------------------- | --------------------- | --------- | ------------- | ---------- |
| `floor-overview`        | `(640, 192)`          | `1.0`     | `1.0`         | yes — default |
| `hero-ticket-follow`    | dynamic (track sprite)| `1.0`     | `1.5..2.0`    | yes — during cinematic |
| `room-triage`           | `(96, 200)`           | `1.0`     | `2.0`         | reserved   |
| `room-investigation`    | `(312, 200)`          | `1.0`     | `2.0`         | reserved   |
| `room-dev`              | `(584, 200)`          | `1.0`     | `2.0`         | reserved   |
| `room-qa`               | `(832, 200)`          | `1.0`     | `2.0`         | reserved   |
| `room-review`           | `(1024, 200)`         | `1.0`     | `2.0`         | reserved   |
| `room-done`             | `(1192, 200)`         | `1.0`     | `2.0`         | reserved   |
| `library-zoom`          | `(288, 168)`          | `1.0`     | `3.0`         | reserved (wave fan-out) |

Camera bounds: `(0, 0, 1280, 384)` — matches world bounds exactly.
Camera pans use `Phaser.Math.Easing.Cubic.InOut`, **400 ms default duration**,
**800 ms for cinematic hero-ticket-follow handoff** (the slower duration sells the journey).

---

## 7. Z-index / layer rules

Render order, bottom to top. Within a layer, insertion order applies.

| z   | Layer name           | Contents                                                                            |
| --- | -------------------- | ----------------------------------------------------------------------------------- |
| 0   | `floor-tiles`        | floor pattern (alternating tints), bottom strip texture                              |
| 10  | `walls-and-frames`   | outer walls, room walls, ceiling row, frosted/sealed wall tints, door frames, slot openings, shelf back |
| 20  | `furniture-static`   | desks, stations, scout desks, library shelves, QualityScore dial frame, retry-counter frame |
| 25  | `furniture-dynamic`  | desk lamps (lit / unlit state), monitor flicker layer, dial needle, counter digits  |
| 30  | `personas`           | persona sprites + their indicator badge                                              |
| 35  | `persona-overlays`   | codename labels on hero personas, thought bubbles (v1: indicator glyph only)         |
| 40  | `tickets`            | ticket sprites (carried, seated, in transit, in queue, on shelf)                     |
| 45  | `ticket-hero`        | the currently-hero ticket; promoted from `40`                                        |
| 50  | `effects`            | verdict scrolls in motion, corridor pulse, particles, trails, convergence rings, glow rings |
| 60  | `canvas-hud`         | numeric overlays inside the canvas: retry counter, round counter, score dial readout, queue depth, codename pops |

**React HUD** (`FloorIndicator`, `DeskDetailPanel`) continues to live in DOM
absolutely positioned above the canvas. It is **not** part of the Phaser
z-stack. The bridge between them is the scene emitter, unchanged.

---

## 8. Queue zones & stacking rules

Each open-entry room (Triage, Investigation, Dev, QA-input, Review, but **not** Done)
has a queue stack rendered at its corridor-side door / slot.

The **queue anchor** is distinct from the **slot exterior anchor**:

- queue anchor sits on the corridor walking lane (`py = 88`) — same `py` as walking personas; the stack reads as "items waiting in the hallway."
- exterior anchor sits at the slot/door lip (`py = 96`) — immediately adjacent to the wall.

Both anchors share the same `tx` (room door's tx); they differ only in `py`.

| Property               | Value                                                                       |
| ---------------------- | --------------------------------------------------------------------------- |
| Stack zone shape       | 2 × 3 tiles centered on the door tx, occupying `ty=4..6`                    |
| Stack anchor (origin)  | door center x, `py = 88` (the corridor walking lane)                        |
| Depth glyph            | one stylised card-stack sprite that swaps texture by tier                   |
| Tier 0 — depth 0       | no sprite                                                                   |
| Tier 1 — depth 1..2    | "1-card" stack, no number                                                   |
| Tier 2 — depth 3..6    | "2-card" stack, no number                                                   |
| Tier 3 — depth 7..15   | "3-card" stack, no number                                                   |
| Tier 4 — depth 16+     | "4-card" stack **plus** numeric badge `+N` (e.g. `+19`) anchored at `(stack.x + 12, stack.y − 18)` |
| Excludes               | the currently-hero ticket (rendered as its own sprite, regardless of state) |
| Update cadence         | recomputed on every `applyPlacements` cycle; no per-frame update            |
| Click zone             | rect `tile (door.tx − 2 .. door.tx + 2, 4..6)`; click opens "Queued at &lt;room&gt;" panel listing items |

For QA, only the **input** side has a queue stack. The output side surfaces
verdict scrolls as effects, not as queued items.

For Review, the stack reflects items waiting for the door to open. Once the
door opens on `review.converged`, items walk through one at a time;
the stack drains over the door-open animation duration.

For Done, no queue: ticket arrives via `mergeCelebration`, lands directly on a shelf slot.

---

## 9. Seal & slot primitives

Sealed rooms (Library, QA) and frosted rooms (Review) need first-class
implementation primitives in `lib/rooms.ts`.

### 9.1 SealedRoom contract

```
SealedRoom {
  interior: TileRect
  walls: { north: number, south: number, east: number, west: number }  // tile rows/cols
  slots: SlotSpec[]
}

SlotSpec {
  id: string
  side: 'north' | 'south' | 'east' | 'west'
  tileRange: [number, number]    // tx or ty inclusive endpoints along the side
  direction: 'inbound' | 'outbound' | 'bidirectional'
  queueAnchor: Point             // pixel point on the corridor walking lane (py=88 for north slots)
  exteriorAnchor: Point          // pixel point at the slot lip on the corridor side
  interiorAnchor: Point          // pixel point at the slot lip on the room side
  tint: 'frosted' | 'opaque'     // wall texture treatment around the slot
}
```

The three anchors are not interchangeable. A ticket traversing a slot
**must** pass through all three positions sequentially; collapsing them to a
single point breaks the "slot crossing" animation and removes the visual
signal that the room boundary is meaningful.

### 9.2 v1 slot inventory

| Slot id                          | Room          | Side  | Tile range  | Queue anchor    | Exterior anchor | Interior anchor | Direction   |
| -------------------------------- | ------------- | ----- | ----------- | --------------- | --------------- | --------------- | ----------- |
| `library.envelope-out`           | Library       | south | `tx=17..18` | n/a (no corridor on south side) | `(288, 200)` | `(288, 224)` | outbound    |
| `library.envelope-in` (reserved) | Library       | south | `tx=17..18` | n/a             | `(288, 200)`    | `(288, 224)`    | inbound (deferred — scouts emerge through walls in v1) |
| `qa.input`                       | QA            | north | `tx=49..50` | `(792, 88)`     | `(792, 96)`     | `(792, 136)`    | inbound     |
| `qa.output`                      | QA            | north | `tx=53..54` | `(856, 88)`     | `(856, 96)`     | `(856, 136)`    | outbound    |
| `review.door`                    | Review        | north | `tx=63..64` | `(1016, 88)`    | `(1016, 96)`    | `(1016, 136)`   | bidirectional (gated by door state) |

For the Library `envelope-out` slot, the absence of a `queueAnchor` reflects
that the slot opens south into the Investigation Lab interior, not into the
corridor. Envelopes emitted from this slot travel directly to the lead
investigator desk; no corridor pause.

### 9.3 FrostedRoom contract

```
FrostedRoom extends SealedRoom {
  silhouetteDimming: number      // 0..1, applied to persona sprites inside
  wallTint: ColorString
  doorState: 'closed' | 'opening' | 'open' | 'closing'
  doorAnimationMs: 1200          // total open-then-close cycle on review.converged
}
```

Review chamber uses this. QA does **not** — QA personas are fully silhouetted
but no door ever opens; v1 QA wall tint is treated as `frosted-blue` decorative
only.

---

## 10. Room-local interaction surfaces

All click zones from §4 collected here for `lib/rooms.ts` to enumerate:

| Zone id                | Room          | Tile rect              | World rect                 |
| ---------------------- | ------------- | ---------------------- | -------------------------- |
| `zone.triage.desk`     | Triage        | `(1..10, 11..14)`      | `(16..175, 176..239)`      |
| `zone.investigation.library` | Library | `(13..22, 9..12)`      | `(208..367, 144..207)`     |
| `zone.investigation.lead`    | Investigation | `(16..20, 16..19)` | `(256..319, 256..319)`     |
| `zone.dev.desk.0`      | Dev           | `(30..34, 13..16)`     | `(480..559, 208..271)`     |
| `zone.dev.desk.1`      | Dev           | `(34..38, 13..16)`     | `(544..623, 208..271)`     |
| `zone.dev.desk.2`      | Dev           | `(38..42, 13..16)`     | `(608..687, 208..271)`     |
| `zone.qa.face`         | QA            | `(46..57, 7..9)`       | `(736..927, 112..159)`     |
| `zone.review.face`     | Review        | `(59..68, 7..10)`      | `(944..1103, 112..175)`    |
| `zone.done.shelf`      | Done          | `(70..78, 10..13)`     | `(1120..1263, 160..223)`   |
| `zone.queue.triage`    | Triage queue  | `(3..6, 4..6)`         | `(48..111, 64..111)`       |
| `zone.queue.investigation` | Inv. queue | `(23..26, 4..6)`     | `(368..431, 64..111)`      |
| `zone.queue.dev`       | Dev queue     | `(34..37, 4..6)`       | `(544..607, 64..111)`      |
| `zone.queue.qa`        | QA queue      | `(48..51, 4..6)`       | `(768..831, 64..111)`      |
| `zone.queue.review`    | Review queue  | `(62..65, 4..6)`       | `(992..1055, 64..111)`     |

Per-sprite click zones (personas, tickets) are owned by the sprite itself
and not enumerated here; they layer **on top of** the zone above. Sprite-click
must `stopPropagation` on the pointer event, as `OfficeScene.ts:370`
already does.

---

## 11. Hero-task focus anchors

A ticket is promoted to **hero** when any of the following hold:

1. It is the subject of an active **critical-lane** or **primary-lane** timeline (see §15).
2. It is in transit between rooms (promoted for the walk duration only).
3. It was clicked by the user (sticky promotion until another ticket is clicked or 10 s elapse).
4. It is currently inside `room.qa` for a `qa.functional-failed` cinematic.

While hero:

- Ticket renders on layer `z=45` (`ticket-hero`).
- Ticket gains a glow ring effect (`z=50`).
- Carrier persona gets a **codename label** anchored at `(persona.x, persona.y − 28)`.
- Camera anchor switches to `hero-ticket-follow`; pan with 800 ms ease-in-out.
- Other tickets in motion stay on `z=40` (no demotion below their normal layer).

Constraints:

- **At most one hero ticket per frame.** Conflicts resolved by lane priority (critical &gt; primary; within a lane, earliest timeline-start wins).
- A ticket exits hero state when: its active timeline completes; the user clicks elsewhere; or 10 s sticky window elapses (whichever first).

---

## 12. Pure-library extension plan

This spec implies the following changes to the pure-libraries layer.
**These are spec-mandates, not implementation; phase 2 of the roadmap
performs the work.**

### 12.1 New: `lib/rooms.ts`

**Single source of truth for all room-floor coordinates.** Scene and layer
code consume this table and **must not duplicate coordinate literals.** A
coordinate appearing in any `apps/web/src/components/office/{game,components}/`
file that is not imported from `lib/rooms.ts` is a bug — see §18 acceptance
criterion.

Authoritative anchor table. Exports:

- `ROOM_IDS = ['triage','investigation','dev','qa','review','done'] as const`
- `roomBounds(id): TileRect` — interior tile range
- `roomDoor(id): { tile: [tx, ty], pixelCenter: Point }`
- `roomDeskAnchors(id): Point[]` — desks, stations, shelves
- `roomSlotAnchors(id): SlotSpec[]` — for sealed rooms
- `roomQueueAnchor(id): Point | null` — corridor-side stack anchor; `null` for Done
- `roomClickZones(id): Array<{ id: string, rect: PixelRect }>`
- `cameraAnchor(name): { center: Point, zoom: number }`
- `CORRIDOR_WALK_Y = 88`
- `FLOOR_WORLD = { width: 1280, height: 384 }`

### 12.2 Adjusted: `lib/layout.ts`

- `FLOOR_TILES_WIDE`: `30` → `80`
- `FLOOR_TILES_TALL`: `12` → `24`
- `FLOOR_PIXEL_WIDTH`: `480` → `1280`
- `FLOOR_PIXEL_HEIGHT`: `192` → `384`
- `FLOOR_GAP_PX`: keep (unused in v1 single-floor; preserve for future multi-floor)
- `deskPositions()` — **deprecated for v1**; callers route through `lib/rooms.ts`. Keep export to avoid churn; document as deprecated and unused.

### 12.3 Adjusted: `lib/pathfinding.ts`

- `corridorY(floorIndex)` — return `floorOriginY + TILE_SIZE * 5 + TILE_SIZE / 2` = `88` for floor 0. (Or rename to `corridorWalkY` in `lib/rooms.ts` and stub `corridorY` for back-compat. Decision: phase 2.)
- `sameFloorPath` — unchanged.
- `crossFloorPath` — unchanged but unused in v1.

### 12.4 Adjusted: `lib/agent-positions.ts`

- `AgentPlacement.role` becomes `roomId: RoomId | null` (renamed). The mapping
  from factory state → room is in `lib/state-to-room.ts` (new), replacing
  `lib/state-to-role.ts` (deprecated; keep export for v1 transition).
- Add `tickets: TicketPlacement[]` to the slice's derived state. Sprite split
  per §3 of the slice plan.

### 12.5 New: `lib/state-to-room.ts`

See §13 for the state → room mapping.

### 12.6 New: `lib/persona-codenames.ts`

Deterministic persona-codename derivation. Exports:

- `CODENAME_POOL: readonly string[]` — local list of ~30 codenames (e.g.
  "Grey Honker", "Cinder Drake"). Sourced from the canonical pool referenced
  in operational-model §1A.
- `codenameFor(seed: string): string` — deterministic hash of `seed` into
  `CODENAME_POOL`. v1 callers pass `seed = "${projectSlug}:${externalId}"` to
  derive a stable codename per work-item-instance until server-side
  `personaId` is plumbed (see §16 still-open item 2 — now resolved here).

This is a **visual-stability shim**, not a substitute for real persona
routing. When the server starts emitting `personaId` on `WorkItemDto`, the
scene switches its seed source; the codename list and hash function stay.

### 12.7 Project selection lives in React

`OfficeTab` selects `activeProject` before passing data to `OfficeGameMount`.
`OfficeScene.applyProjects` receives **exactly one** `OfficeProject` in v1; it
must not accept an array and silently drop the rest. The multi-project picker
(if any) is React's concern, not Phaser's.

---

## 13. State → room mapping (v1)

Single source of truth for "where does this work item live?"

This table is **read-only** from the scene's perspective. The scene observes
which state a work item is in and renders accordingly; it never writes to the
state. See §1.5.

| factory state                                                                                   | Room              | Indicator       | Notes                              |
| ----------------------------------------------------------------------------------------------- | ----------------- | --------------- | ---------------------------------- |
| `factory:triaging`                                                                              | `triage`          | `speech`        |                                    |
| `factory:accepted`                                                                              | `triage`          | `thought`       |                                    |
| `factory:grilling`                                                                              | `triage`          | `speech`        | discovery deferred → fold into triage in v1 |
| `factory:prd-drafting`                                                                          | `triage`          | `speech`        | "                                  |
| `factory:prd-review`                                                                            | `triage`          | `thought`       | "                                  |
| `factory:decomposing`                                                                           | `triage`          | `speech`        | "                                  |
| `factory:issues-created`                                                                        | `triage`          | `check`         | "                                  |
| `factory:research-pending`                                                                      | `investigation`   | `thought`       |                                    |
| `factory:research-complete`                                                                     | `investigation`   | `check`         |                                    |
| `factory:investigating`                                                                         | `investigation`   | `thought`       | wave fan-out fires from here       |
| `factory:investigation-complete`                                                                | `investigation`   | `check`         |                                    |
| `factory:dev-ready`                                                                             | `dev`             | `thought`       |                                    |
| `factory:spec-ready`                                                                            | `dev`             | `thought`       | M19 path; rendered same as dev-ready in v1 |
| `factory:in-progress`                                                                           | `dev`             | `speech`        | `agent.run-started` lights desk lamp |
| `factory:needs-fix`                                                                             | `dev`             | `speech`        |                                    |
| `factory:qa-failed`                                                                             | `dev`             | `bang`          | post-cinematic resting state       |
| `factory:needs-qa`                                                                              | `qa`              | `speech`        | persona silhouette inside chamber  |
| `factory:needs-review`                                                                          | `review`          | `speech`        | silhouettes through frosted glass  |
| `factory:approved`                                                                              | `review`          | `check`         |                                    |
| `factory:merge-conflict`                                                                        | `review`          | `bang`          |                                    |
| `factory:retrospecting`                                                                         | `dev`             | `speech`        | retro room deferred → fold into dev |
| `factory:done`                                                                                  | `done`            | `check`         | shelf slot                         |
| `factory:archived`                                                                              | `done`            | `check`         | "                                  |
| `factory:rejected`                                                                              | (drop)            | —               | not rendered                       |
| `factory:needs-human`                                                                           | (stay)            | `bang`          | persona freezes in place; spotlight overlay |
| `factory:gate-pending`                                                                          | (stay)            | `question`      | persona freezes in place; bell overlay |

The "stay-put" semantics from M17 (`role: null`) carry over with the same
contract: keep the sprite at its current room/desk and only swap the indicator.

---

## 14. Choreography lane → anchor mapping

Per the slice plan, three orchestration lanes coexist:
**critical**, **primary**, **ambient**. Each lane is bound to specific anchors
and primitives in this floor.

Every timeline below is **driven by real orchestration events** consumed
from the SSE `/events` stream by `OfficeTab`, mapped to `ChoreographyIntent`s,
and pushed into the scene as derived data (see §1.5). No timeline starts
because of a scene-internal heuristic; no timeline writes back to workflow
state on completion.

| Lane     | Driver events                                              | Anchors used                                                         | Visual primitives                                              |
| -------- | ---------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| critical | `qa.functional-failed`, `gate.awaiting-human`, `audit.autonomy-gate-fired` (deferred) | QA output slot `(856, 112)`, corridor walking lane `py=88`, Dev desk lamps, retry-counter overlay `(784, 96)` | red verdict scroll, corridor pulse (1 s east-bound red pulse), retry-counter increment, dev desk lamp re-light, ambient dimming |
| primary  | active hero-ticket journey: `state.transitioned`, `agent.run-started`, `swarm.wave-*`, `review.converged`, `pr.merged` for the current hero | walking-lane paths, room doors, slots, hero codename label anchor `(carrier.x, carrier.y − 28)` | persona walks, ticket attaches to desk, desk lamp on, monitor flicker, scout fan-out from library, verdict scrolls (non-failure), door open at review, Done shelf landing |
| ambient  | non-hero `state.transitioned`, queue pulses, idle indicators, merge particles for non-hero merges | queue stack anchors, idle desk indicators, shelf slots | stack tier swap, small particle burst on Done shelf for non-hero merges, idle indicator coffee → speech swaps |

### 14.1 Specific cinematic anchor sequences (for the v1 journey)

**Investigation wave fan-out (`investigationWave`):**

```
trigger: swarm.wave-started, payload { scoutCount = 3 }
1. lead-investigator persona stands at (280, 280). desk lamp on.
2. 3 scout personas spawn at library scout-desk anchors (232, 168), (280, 168), (328, 168).
3. each scout's desk lamp lights with a 100ms stagger.
4. after configured run-budget seconds (or on swarm.scout-completed events):
   - per scout: envelope sprite generated at slot interior anchor (288, 224).
   - envelope tweens south to lead-investigator desk (280, 280) over 600ms.
5. on swarm.wave-completed: convergence ring effect at (280, 280), 800ms.
6. lead investigator picks up consolidated report; ticket auto-promotes hero;
   journey continues to dev via state.transitioned → dev-ready.
```

**QA failure (`qaFailed`):**

```
trigger: qa.functional-failed for ticket T (and ticket T is current hero or promotes)
1. red verdict scroll generated at qa.output interior anchor (856, 136).
2. scroll tweens north through slot to exterior (856, 96), continues to (856, 88).
3. corridor red pulse: 1s east-to-west sweep along py=88, tx=854 → tx=36 (dev door).
4. retry-counter overlay at (784, 96) increments with a 200ms scale-bounce.
5. ticket T (if still inside qa visually) reroutes: ticket sprite generated at qa.output exterior (856, 96), follows corridor pulse to dev door (568, 88), descends to dev desk that previously owned it.
6. dev desk lamp at that desk re-lights with a flicker (200ms off→on→off→on).
7. review chamber wall tint dims 20% for the duration; restores on cinematic end.
8. cinematic duration cap: 3.5s total. Player can be promoted out by another critical event.
```

**Review converged (`reviewConverged`):**

```
trigger: review.converged for ticket T
1. review door state: closed → opening (200ms).
2. door open for 800ms.
3. ticket T tweens from review interior to door center (1016, 112), to corridor (1016, 88).
4. door state: open → closing (200ms).
5. ticket continues east along corridor to done door (1192, 88).
6. Total: 1.2s.
```

**Merge celebration (`mergeCelebration`):**

```
trigger: pr.merged for ticket T
1. ticket T at done door (1192, 88) descends to shelf slot 3 (1192, 168).
2. green pulse effect at (1192, 168), 600ms radial.
3. small particle burst (8 particles, fade 800ms).
4. Done-day badge increments.
5. If T is current hero, hero release on landing; camera returns to floor-overview over 800ms.
6. If T is NOT current hero, animation runs on ambient lane (no camera change, particle burst only).
```

---

## 15. Explicit non-goals for v1

Out of scope for this floor spec:

- Multi-floor stacking. Single floor only. M17 stair-nav replaced.
- Lobby (inbox, courier, budget board). Courier-arrival is stubbed by Triage's floor-inbox tile.
- Watchtower / auditor sprite / audit beacon. Critical lane has a slot for `audit.autonomy-gate-fired` but no anchors yet.
- Backstage corkboard / coach office.
- Discovery sub-rooms (grilling pit, PRD table, critique wall, decomposition bench). All discovery states fold into Triage in v1.
- Research lab (folded into Investigation).
- Spec booth + builder board + WorkPackage tethers. M19 parallel-build is a separate slice.
- Dev-Review nook. Reserved tile bounds only.
- Retro room. Retrospecting folds into Dev with an indicator.
- Archive cabinet. `factory:archived` shares the Done shelf in v1.
- Zoom modes other than `floor-overview` and `hero-ticket-follow`. All room/persona-zoom anchors are reserved but unused.
- TDD-heartbeat glyphs (RED / GREEN / REFACTOR / LINT). Tier-3 deferred.
- Tool-call micro-animations. Tier-3 deferred.
- Sprite-sheet walk cycles. Sprites still slide in v1.
- Sound / ambient audio.
- Cross-project navigation. Replaced for v1; may return when room semantics, choreography, persona identity, and runtime overlays are proven.

---

## 16. Resolved decisions & remaining open questions

### Resolved (frozen for v1)

1. **Banner content** — three cells: `Project Name | Mode | Active Hero Ticket`. See §3 banner-zone table.
2. **Persona codename source** — deterministic hash of `"${projectSlug}:${externalId}"` into a local `CODENAME_POOL` of ~30 names. See §12.6 `lib/persona-codenames.ts`. Visual stand-in only; replaced when server plumbs `personaId`.
3. **Library scout count** — hardcoded to 3 in v1. Anchors for 4..6 stay reserved. See §4.2.
4. **Done shelf overflow** — tickets pushed off either end fade outward over 800 ms, then despawn. See §4.6.
5. **Resize behaviour** — camera stays at `floor-overview` `(640, 192)` at zoom `1.0`. Accept letterbox / clipping at narrow viewports; user can switch to `hero-ticket-follow` for narrative focus. No auto-fit. See §6.

### Still open (defer to Phase 2 or later)

6. **QA tier-disagreement light wiring.** Anchor `(848, 96)` is reserved. Whether v1 wires the `qa.tier-disagreement` event to pulse it, or defers entirely, is unresolved. Suggested: defer to a post-v1 polish slice; v1 leaves the anchor unused.
7. **Banner & label fonts.** M17 uses `'JetBrains Mono, monospace'` system fallback. Spec assumes the same. Web font loading is out of scope for v1 but will likely come up when atmospheric polish lands.

---

## 17. Out-of-band notes

- This spec replaces — implicitly — the per-project-floor model from M17. **`OfficeTab` selects `activeProject` before passing data to `OfficeGameMount`. `OfficeScene.applyProjects` receives exactly one `OfficeProject` in v1.** Cross-project navigation is deferred per the slice plan (see §12.7).
- The image-prompt for this board (`image-prompt.md`) was written before this spec. It is consistent with the layout above but does not commit to specific tile coordinates. When the image is regenerated, use the prompt **plus** the ASCII diagram in §3 as visual references.
- The 12-panel storyboard in Board 03 (`03-ticket-lifecycle-storyboard/design-spec.md`, currently scaffolded) must align with the anchors in this spec. Phase 9 of the slice plan authors that board once the cinematic is real.

---

## 18. Acceptance

A future implementation of `lib/rooms.ts` satisfies this spec if and only if:

- Every coordinate in §3, §4, §6, §8, §10, §14 is encoded literally (no derivation).
- The state → room mapping in §13 is the single source of truth used by the scene.
- The lane / anchor mapping in §14 is the single source of truth used by the choreography player.
- No furniture, anchor, or click zone appears in code that is not enumerated here.
- No room from the operational-model canon outside the v1 six appears in code (Triage, Investigation+Library, Dev, QA, Review, Done).
- **No coordinate literal appears in any file under `apps/web/src/components/office/{game,components}/` except via import from `lib/rooms.ts`.** Lint hint: `grep -rE '\b(1280|1016|856|792|568|312|280|232|88|112|136|168|200|232|280)\b' apps/web/src/components/office/{game,components}/ | grep -v -F 'rooms.ts'` should return only comments and asset-key strings.
- **No scene method mutates workflow state.** No `OfficeScene`, layer, or sprite class issues a `fetch`, `postMessage`, or label write. Click events emit on the scene emitter; React handles workflow-aware side effects.
- **`OfficeScene.applyProjects` accepts exactly one `OfficeProject`** in v1 (not an array). The mount and tab enforce single-project selection upstream.
