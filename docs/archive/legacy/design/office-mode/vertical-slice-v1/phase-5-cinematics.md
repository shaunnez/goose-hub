# Office Mode Vertical Slice v1 — Phase 5: Cinematics

**Status:** Specified. Do not begin Phase 6 work in this phase.

**Goal:** Implement the four canonical v1 cinematics on the
choreography player that phase 4 produced.

The cinematics are:

1. `investigationWave` — Wave 1 scout fan-out + convergence.
2. `qaFailed` — verdict-scroll exit + corridor pulse + rerouted ticket.
3. `reviewConverged` — review door opens, ticket walks out to corridor.
4. `mergeCelebration` — ticket lands on Done shelf with green pulse.

Each cinematic is a single composed `Timeline` (a few extend to ≤ 10
intents). They consume the lane / preemption / coalescing system from
phase 4 unchanged. They add new intents (verdict scroll, slot transit,
camera, door, pulse, particle) and use existing intents from phase 4.

Phase 5 is the **payoff phase** for the slice. After phase 5, the v1
cinematic journey runs end-to-end. Phase 6 then adds runtime
observability on top.

---

## 1. Scope

### In scope

- Four named cinematics, each as a composed `Timeline` produced by
  `lib/choreography.ts` when the relevant trigger event fires.
- New intents (one file each in `game/choreography/intents/`):
  - `slotTransit` — three-anchor sequenced tween through a slot.
  - `spawnVerdictScroll` — creates a `TicketSprite` visual variant
    (scroll texture) at a slot interior anchor.
  - `spawnScoutEnvelope` — creates an envelope visual at the Library
    south slot.
  - `corridorPulse` — east- or west-bound coloured pulse along
    `corridorY=88`.
  - `doorState` — Review chamber door open/close animation (1.2s
    cycle).
  - `glowRing` — radial glow effect at a target anchor.
  - `particleBurst` — small particle effect at a target anchor.
  - `shelfLand` — snaps a ticket to a Done shelf slot and shifts
    neighbours outward.
  - `cameraTo` — pans camera to a Board 02 §6 anchor.
  - `swapWallTint` — frosted/sealed wall tint change for the
    duration of a cinematic (used by qaFailed + investigationWave for
    ambient dimming).
- Sprite texture variants for ticket: `card`, `scroll`, `envelope`.
- Hero promotion driven by primary-lane timelines (the `ticketId`
  field on `Timeline` from phase 4 now drives promotion).
- Ambient suppression: while a critical cinematic runs, the ambient
  lane pauses fully (no new ambient intents start; in-flight ambient
  cancels).
- Rollback expectation: each cinematic ends with the scene in a
  reconcilable state — the next `applyPlacements` corrects any drift.

### Out of scope (phase 6 and later)

- Runtime HUD overlays: hero labels (above sprite — partially in phase
  3 already; banner cell stays), queue depth badges, retry counter
  rendering, convergence counter rendering, room pressure overlays,
  blocked-state overlays, runtime event feed. **All phase 6.**
- TDD-heartbeat glyphs (RED / GREEN / REFACTOR / LINT) — Tier 3,
  deferred indefinitely.
- Tool-call micro-animations — Tier 3, deferred.
- Watchtower beacon, audit cinematic — Board 02 §15 reserves the
  critical-lane slot but no anchors.
- Sound / ambience — deferred.
- Atmospheric polish boards (09–12) — separate slice.
- Multi-floor, lobby, backstage, corkboard, building view — deferred.
- Persona variants beyond the M17 role-keyed body — deferred.
- Cross-project / WorkPackage tethers — separate slice.
- Generalised cinematic framework. The four cinematics are
  hand-composed. **Do not extract a "cinematic DSL."** v1 has four;
  YAGNI.

If you find yourself touching anything in "out of scope," stop.

---

## 2. Target file structure (after Phase 5)

```
apps/web/src/components/office/
  game/
    OfficeScene.ts               # may grow slightly to expose hero-promotion to player
    choreography/
      ChoreographyPlayer.ts      # ADJUSTED — adds ambient suppression flag
      Timeline.ts                # unchanged
      cinematics/                # NEW DIRECTORY
        investigationWave.ts     # NEW — Timeline factory
        qaFailed.ts              # NEW — Timeline factory
        reviewConverged.ts       # NEW — Timeline factory
        mergeCelebration.ts      # NEW — Timeline factory
      intents/
        walkToRoom.ts            # unchanged
        attachToDesk.ts          # unchanged
        swapIndicator.ts         # unchanged
        slotTransit.ts           # NEW
        spawnVerdictScroll.ts    # NEW
        spawnScoutEnvelope.ts    # NEW
        corridorPulse.ts         # NEW
        doorState.ts             # NEW
        glowRing.ts              # NEW
        particleBurst.ts         # NEW
        shelfLand.ts             # NEW
        cameraTo.ts              # NEW
        swapWallTint.ts          # NEW
    layers/
      RoomLayer.ts               # ADJUSTED — exposes door state primitive, wall-tint primitive
      PersonaLayer.ts            # ADJUSTED — exposes freezePersona / unfreezePersona
      TicketLayer.ts             # ADJUSTED — exposes setVariant('card'|'scroll'|'envelope'), shelf primitives
      types.ts                   # ADJUSTED — adds cinematic-related type aliases
  lib/
    choreography.ts              # ADJUSTED — adds cinematic factories to event→timeline map
    cinematic-timings.ts         # NEW — constants only (durations, easings); pure
  slice.test.ts                  # extended for cinematic factories + new intents
```

New code budget for phase 5: ~1200 lines including tests. If any
single intent grows past ~120 lines, split or simplify it before
merging.

---

## 3. The four cinematics

Each cinematic is defined here at the level of "what runs, in what
order, against which anchors, for how long." Implementation detail —
which Phaser tween calls produce which motion — lives in the intent
modules and is interchangeable as long as the visible result matches.

All timings are from `lib/cinematic-timings.ts`. All coordinates are
from `lib/rooms.ts` (per Board 02 §18). No literals appear in
cinematic factory code.

### 3.1 `investigationWave`

**Trigger:** `swarm.wave-started` event on the hero ticket. Lane:
`primary`.

**Subject:** the hero ticket. The cinematic must promote the ticket to
hero on entry (if not already).

**Sequence:**

| Step | Intent                  | Target                                | Duration | Notes                                                       |
| ---- | ----------------------- | ------------------------------------- | -------- | ----------------------------------------------------------- |
| 1    | `cameraTo`              | `library-zoom` anchor reserved? **No.** Use `room-investigation` only when phase 6 zoom lands. Phase 5 stays at `hero-ticket-follow` centered on lead investigator. | 600ms ease | Camera follows hero. |
| 2    | `attachToDesk`          | lead investigator desk `(280, 280)` (Board 02 §4.2) | 800ms     | Lead persona walks from corridor → lab → desk.            |
| 3    | `swapIndicator`         | lead persona → `thought` glyph        | 0ms      | Snap.                                                       |
| 4..6 | `spawnScoutEnvelope`×3 (parallel via Timeline.parallel — see §6) | Library scout slots 1, 2, 3 | 100ms stagger per scout | Each scout's "appearance" is rendering an `envelope`-textured ticket-prop at the scout desk. |
| 7..9 | `swapIndicator`×3       | each scout → `speech`                 | 0ms      | Indicates active scout run.                                 |
| 10   | (await `swarm.scout-completed` ×3 OR ttlMs cap) | —                       | up to 8s   | Player awaits; each scout-completed advances internal step counter (see §3.1.1). |
| 11..13 | `slotTransit` (south) | each envelope through `library.envelope-out` slot `(288, 200) → (288, 224)` | 600ms each | Envelopes emerge from Library through south slot. |
| 14   | `glowRing`              | lead investigator desk `(280, 280)`   | 800ms    | Convergence ring at the lead desk on `swarm.wave-completed`. |
| 15   | `swapIndicator`         | hero ticket → `check`                 | 0ms      | Signals investigation complete (ticket gets check glyph briefly). |

**Ambient suppression:** off (this is primary, not critical).
**Hero promotion:** on entry; release at step 15 +500ms.
**Camera:** stays on `hero-ticket-follow` throughout.
**Rollback:** if any step exceeds its TTL, the timeline aborts. Next
`applyPlacements` re-establishes the correct state (scouts disappear,
indicator clears, ticket re-positions per server state).

#### 3.1.1 Handling the await on `swarm.scout-completed`

The cinematic cannot block on external events from inside an intent —
intents are run-to-completion. To handle Wave-1 convergence, phase 5
introduces a small pattern: **incremental cinematic continuation.**

- The `investigationWave` factory in `lib/choreography.ts` runs at
  `swarm.wave-started` and produces steps 1..6 only.
- Each subsequent `swarm.scout-completed` event produces a small
  follow-up `Timeline` containing steps 11..13 for that single scout
  (one `slotTransit`), enqueued on the same lane.
- `swarm.wave-completed` produces steps 14..15.

The player's existing lane queue + preemption machinery handles this
naturally: serial timelines on the primary lane against the same hero
ticket complete in arrival order.

The factory module composes the cinematic; phase 5 does not extend the
player.

### 3.2 `qaFailed`

**Trigger:** `qa.functional-failed` event for the hero ticket (or for
a ticket that promotes to hero on this event — see §5). Lane:
`critical`.

**Subject:** the hero ticket.

**Sequence:** (timings strictly bounded; total ≤ 3.5s per Board 02 §14.1)

| Step | Intent                  | Target                                | Duration | Notes                                                       |
| ---- | ----------------------- | ------------------------------------- | -------- | ----------------------------------------------------------- |
| 1    | (hero promotion)        | ticket                                | 0ms      | If not already hero, promote now. Camera switches to `hero-ticket-follow` centered on QA output slot. |
| 2    | `spawnVerdictScroll`    | QA output interior anchor `(856, 136)` | 0ms      | Red-tinted scroll variant of `TicketSprite`. The ticket sprite swaps its body texture for the duration of this cinematic. |
| 3    | `slotTransit`           | scroll through `qa.output` (`856, 136 → 96 → 88`) | 600ms | Three-anchor sequence: interior → exterior → queue. |
| 4    | `corridorPulse`         | east-to-west, from `tx=854` to `tx=36`, along `py=88` | 1000ms | Red, 1-second sweep. Layer: `effects` (z=50). |
| 5    | (parallel) `swapWallTint` | `room.review` north wall tint dim 20% for 3500ms | 0ms enter, restore on cinematic end | Subtle ambient dim. Auto-restores when cinematic ends. |
| 6    | `walkToRoom`            | ticket — follows corridor pulse west; sub-step: corridor → dev door descent | 1200ms | Implemented as a single `walkToRoom` with destRoomId='dev'; layer fills in the corridor + descent. |
| 7    | (parallel) `swapIndicator` | hero ticket → `bang`               | 0ms      | Snap.                                                       |
| 8    | desk-lamp re-light at dev desk | (handled by layer primitive triggered by `attachToDesk` re-fire, no separate intent) | 200ms flicker | Phaser tween on lamp brightness. Implemented inside `attachToDesk` when target desk already has lamp on. |
| 9    | hero release            | ticket                                | 0ms after step 8 | Camera returns to `floor-overview` over 800ms via a follow-up `cameraTo` step. |

**Ambient suppression:** **on** for the duration. The ambient lane
queue continues to grow but does not run; resumes after step 9.
**Hero promotion:** force-promote at step 1; release at step 9 +500ms.
**Camera:** `floor-overview` → `hero-ticket-follow` at step 1; back at
step 9.
**Retry counter:** **not rendered in phase 5.** The counter is a phase
6 overlay. Phase 5 may emit a `'choreo.retry-incremented'` event on the
scene emitter so phase 6 hook can listen — but phase 5 does not render
the badge.
**Tier-disagreement light:** not wired (Board 02 §16 still-open
question; phase 5 leaves the anchor unused).
**Rollback:** if total exceeds 3.5s TTL, abort. The scene reconciles
on next placement diff. The wall-tint must restore on abort.

### 3.3 `reviewConverged`

**Trigger:** `review.converged` event for the hero ticket. Lane:
`primary`.

**Subject:** the hero ticket.

**Sequence:** (total ~1.2s per Board 02 §14.1)

| Step | Intent          | Target                                  | Duration | Notes                                          |
| ---- | --------------- | --------------------------------------- | -------- | ---------------------------------------------- |
| 1    | `doorState`     | `room.review.door`: `closed → opening`  | 200ms    | Tween door alpha + position.                   |
| 2    | (hold open)     | door: `open`                            | 800ms    | Implemented as a delay step (a `swapIndicator` no-op or explicit `delay` intent — see §6.2). |
| 3    | `slotTransit`   | hero ticket through `review.door` slot: interior `(1016, 136)` → exterior `(1016, 96)` → queue `(1016, 88)` | 600ms | Three-anchor sequenced tween. |
| 4    | `walkToRoom`    | hero ticket continues east in corridor toward `room.done` door `(1192, 88)` | 1000ms | Implemented as `walkToRoom(destRoomId='done')` on the ticket sprite (no carrier; ticket is autonomous in this phase per Board 02 §1.5). |
| 5    | `doorState`     | `room.review.door`: `open → closing`    | 200ms    | Door closes.                                   |

**Ambient suppression:** off (primary).
**Hero promotion:** the ticket is hero throughout; release on
`mergeCelebration` (which may follow within seconds, or never — if
the journey ends here, release at step 5 +500ms).
**Camera:** stays at `hero-ticket-follow` (already centered on
review door because the ticket has been hero since the wave).
**Convergence counter:** **not rendered in phase 5.** Phase 6.
**Rollback:** if door fails to open within TTL, abort; ticket remains
in `review` room visually. Next placement diff corrects.

### 3.4 `mergeCelebration`

**Trigger:** `pr.merged` event for the hero ticket. Lane: `primary`
(non-hero merges run on ambient — see §3.4.1).

**Subject:** the hero ticket.

**Sequence:** (total ~1.6s per Board 02 §14.1)

| Step | Intent           | Target                                  | Duration | Notes                                          |
| ---- | ---------------- | --------------------------------------- | -------- | ---------------------------------------------- |
| 1    | `walkToRoom`     | hero ticket from done door `(1192, 88)` descends to shelf slot 3 `(1192, 168)` | 600ms | Implemented as a vertical tween; layer handles. |
| 2    | `shelfLand`      | hero ticket → shelf slot 3 `(1192, 168)`; existing tickets shift outward; off-shelf tickets fade outward (800ms) | 800ms | Per Board 02 §4.6. |
| 3    | `glowRing`       | shelf slot 3 `(1192, 168)`              | 600ms    | Green pulse.                                   |
| 4    | `particleBurst`  | shelf slot 3 `(1192, 168)`              | 800ms    | 8 particles, fade.                             |
| 5    | (Done-day counter increment) | Done-day badge anchor `(1184, 296)` | 0ms      | **Phase 6 renders the badge.** Phase 5 fires a `'choreo.merge-celebrated'` event on the emitter; phase 6 reads it. Phase 5 does not draw the counter. |
| 6    | hero release     | ticket                                  | 0ms after step 4 | Camera returns to `floor-overview` over 800ms. |

#### 3.4.1 Non-hero merges

A `pr.merged` event for a ticket that is **not** the current hero
produces a smaller ambient timeline:

| Step | Intent          | Target                                  | Duration | Notes                                    |
| ---- | --------------- | --------------------------------------- | -------- | ---------------------------------------- |
| 1    | `shelfLand`     | non-hero ticket → next available slot   | 400ms    | Faster than hero version.                |
| 2    | `particleBurst` | shelf landing slot                      | 600ms    | Smaller, lower-z particle effect.        |

No glow, no camera move, no hero promotion. Pure ambient.

**Ambient suppression:** off (primary for hero; ambient for non-hero).
**Hero promotion:** force-promote at step 1 for the hero version;
release at step 6.
**Rollback:** if shelf positions can't be computed (e.g. shelf already
full and the new ticket has lower priority), the ticket snaps directly
into slot 3 and existing tickets fade out per the §4.6 overflow rule.

---

## 4. Timing ownership

Every duration above is a constant in `lib/cinematic-timings.ts`. Each
cinematic factory imports the constants it needs:

```ts
export const TIMING = {
  cameraEase: 400,
  cameraEaseSlow: 800,
  walkRoomMs: 800,
  walkCorridorMs: 1200,
  slotTransit3AnchorMs: 600,
  doorOpenMs: 200,
  doorHoldMs: 800,
  doorCloseMs: 200,
  corridorPulseMs: 1000,
  shelfLandHeroMs: 800,
  shelfLandAmbientMs: 400,
  glowRingMs: 600,
  particleBurstMs: 800,
  wallTintRestoreMs: 0,         // restore is part of cinematic-end, not its own tween
  qaFailedHardCapMs: 3500,
} as const;
```

No literal millisecond values anywhere in cinematic factory or intent
code. Pure module. Tests can import it for assertions.

Easings:
- All cinematic tweens use `Phaser.Math.Easing.Cubic.InOut` by default.
- Camera pans use the same.
- Particle alphas use `Quad.Out`.

This is fixed in `lib/cinematic-timings.ts`. Do not introduce
per-cinematic ease overrides unless a Board 02 §14 sequence demands it
(it does not).

---

## 5. Hero promotion behaviour

Phase 3 implemented click-driven sticky promotion (10s window). Phase
5 adds **cinematic-driven** promotion:

- A `Timeline` with non-null `ticketId` whose lane is `primary` or
  `critical` causes the ChoreographyPlayer to call
  `TicketLayer.promote(ticketId)` on timeline start and
  `TicketLayer.release(ticketId)` on timeline complete (or abort).
- Cinematic-driven promotion **overrides** click-sticky promotion. If
  click-sticky is active on a different ticket, that ticket releases
  immediately and the cinematic's subject promotes.
- After the cinematic completes, the player does **not** re-promote the
  previous click-sticky ticket. Click was a fleeting interaction; the
  cinematic event is the system's authoritative focus.
- Two simultaneous cinematics targeting different tickets is impossible
  by lane construction (one critical max, primary may queue but only
  one active). The active timeline's subject is always the unique hero.
- Banner Hero-Ticket cell (Board 02 §3 right cell) updates with the
  current hero — single source of truth via
  `RoomLayer.setHeroTicketCell` exactly as in phase 3. The player calls
  it, not React.

---

## 6. Composing cinematic timelines

### 6.1 Sequenced steps

Phase 4 timelines run steps strictly sequentially. Phase 5 keeps that
model.

### 6.2 Delay steps

Some cinematics include a "hold" (e.g. `reviewConverged` step 2:
hold the door open for 800ms after it finishes opening). Two options:

- **Option A (selected):** add a `delay(ms)` intent that resolves after
  `ms` via `scene.time.delayedCall`. Lightweight; ≤ 30 lines.
- **Option B (rejected):** extend `Timeline` to support inter-step
  delays declaratively. Rejected because it makes timelines
  serialisable in a way nothing else uses. Adding a `delay` intent is
  cheaper.

Implement Option A as a new intent in `game/choreography/intents/delay.ts`.
It is the simplest possible intent: `run = ({ ms }) =>
new Promise(r => scene.time.delayedCall(ms, r))`. `cancel` clears the
delayedCall.

### 6.3 Parallel steps

Some cinematics need parallel intent execution (e.g. `qaFailed` runs
the corridor pulse and the ticket walk concurrently; `investigationWave`
spawns 3 scout envelopes in parallel).

Phase 5 introduces a thin **timeline composition primitive**:
`Timeline.parallel(steps)` returns a single composite step that the
player runs as: dispatch all sub-steps simultaneously; resolve when the
last sub-step completes (or any sub-step cancels).

This is the **only** extension to the phase-4 player model. ~30 lines
in `Timeline.ts`. Tests cover: 3-parallel completion, 1-of-3 cancel,
ttl exceeded.

`Timeline.parallel` is **not** a generic concurrency primitive — it is
a specific composition rule. It does not nest indefinitely; cinematics
in phase 5 use at most one level of parallelism per timeline.

### 6.4 Cinematic factory shape

Each cinematic lives in its own module:

```ts
// game/choreography/cinematics/qaFailed.ts
import { TIMING } from '../../../lib/cinematic-timings';
import { roomDoor, roomSlotAnchors } from '../../../lib/rooms';

export function qaFailedTimeline(ticketId: string, devDeskSlot: number): Timeline {
  return {
    id: makeId(),
    lane: 'critical',
    ticketId,
    source: 'event',
    steps: [
      { id: 'cameraTo', target: { kind: 'camera', id: 'hero-ticket-follow' }, params: {} , lane: 'critical', ttlMs: TIMING.cameraEase + 100 },
      { id: 'spawnVerdictScroll', /* ... */ },
      { id: 'slotTransit', /* ... */ },
      // ...
    ],
  };
}
```

Factories are pure. They take the trigger event's payload and produce
a deterministic timeline. Tests cover each factory.

`lib/choreography.ts` imports the four factories and dispatches per
`timelinesForEvent`. The event allowlist grows:

| Event kind                | Maps to                                 |
| ------------------------- | --------------------------------------- |
| `swarm.wave-started`      | `investigationWaveTimeline()` part 1    |
| `swarm.scout-completed`   | `investigationWaveTimeline()` part 2 (per-scout follow-up) |
| `swarm.wave-completed`    | `investigationWaveTimeline()` part 3    |
| `qa.functional-failed`    | `qaFailedTimeline()`                    |
| `review.converged`        | `reviewConvergedTimeline()`             |
| `pr.merged` (hero)        | `mergeCelebrationTimeline()`            |
| `pr.merged` (non-hero)    | `mergeCelebrationAmbientTimeline()`     |

All others — same as phase 4 — produce phase-4 timelines or are
ignored.

---

## 7. Ambient suppression rules

While a **critical** cinematic is active:

- New incoming ambient timelines do not start. They enqueue.
- Active ambient timelines are cancelled immediately. They do not
  resume.
- This is enforced by the `ChoreographyPlayer` checking a single
  `criticalActive` flag set by the lane state.

While a **primary** cinematic is active:

- Ambient continues to run.
- Existing primary cinematics (none active because primary has one
  slot) are preempted by critical only.

Restoration:
- When the critical timeline completes (or aborts), the
  `criticalActive` flag clears, and the player resumes the ambient
  queue head normally.

Phase 5 implements the `criticalActive` gating in
`ChoreographyPlayer.process()`. ~10 lines.

---

## 8. Rollback expectations

Each cinematic ends in one of three states:

1. **Completed.** All steps ran. Camera at floor-overview (or
   hero-ticket-follow if a primary handoff is queued). All temporary
   visuals destroyed. Wall tints restored.
2. **Aborted (TTL).** A step exceeded its `ttlMs`. Player cancels the
   timeline. Cinematic factory must register a cleanup callback
   (`Timeline.onAbort?: () => void`) that:
   - Destroys any spawned scrolls / envelopes / glow rings / particles.
   - Restores wall tints.
   - Restores door state to closed.
   - Resets the camera to `floor-overview` over 400ms.
3. **Preempted (critical interrupt).** A primary cinematic was running
   when a critical event arrived. Active step cancels; the primary
   timeline pauses. The cleanup callback **does not** run on
   preemption — only on full abort.

After any of these end states, **the next `applyPlacements` is
authoritative.** It resets sprite positions per server truth, clears
indicators per current state, and re-renders queue stacks. This is the
final safety net; cinematics do not need to be exhaustively
"undoable" on their own.

`Timeline.onAbort` is the second of two extensions to the phase-4
timeline shape (the first was the optional `onComplete`).

---

## 9. Acceptance criteria

The PR is mergeable iff:

- [ ] `pnpm test` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` passes.
- [ ] `office-click-through.spec.ts` passes in CI.
- [ ] Four cinematic factories exist in `game/choreography/cinematics/`,
      each pure, each ≤ 200 lines.
- [ ] New intent modules exist in `game/choreography/intents/`:
      `slotTransit`, `spawnVerdictScroll`, `spawnScoutEnvelope`,
      `corridorPulse`, `doorState`, `glowRing`, `particleBurst`,
      `shelfLand`, `cameraTo`, `swapWallTint`, `delay`. Each ≤ 120
      lines.
- [ ] `lib/cinematic-timings.ts` exists with all durations as named
      constants. No literal `ms` values appear in cinematic factory or
      intent code.
- [ ] `Timeline.parallel` exists and is unit-tested.
- [ ] `Timeline.onAbort` exists and is invoked exactly on full aborts,
      never on preemption.
- [ ] Player's `criticalActive` flag implements ambient suppression.
- [ ] Banner Hero-Ticket cell updates from primary / critical timelines.
- [ ] Hero promotion is driven by `Timeline.ticketId` on the player.
- [ ] **No mutation of workflow state.** Grep across `game/` returns
      no `fetch`, `postMessage`, label-write calls.
- [ ] **No coordinate literals** in `game/` outside `lib/rooms.ts`
      imports.
- [ ] **No literal timing values** in `game/` outside `lib/cinematic-timings.ts`
      imports.
- [ ] No new dependencies in `apps/web/package.json` (Phaser's existing
      particle system suffices; if it doesn't, surface before adding
      anything).
- [ ] Manual verification (§11) all ticked.

---

## 10. Test surface

### Unit tests (`slice.test.ts`)

- Each cinematic factory:
  - Produces the expected sequence of intent ids in order.
  - Pulls anchors from `lib/rooms.ts` (mockable to assert).
  - Pulls timings from `lib/cinematic-timings.ts`.
  - Marks correct lane (`critical` for qaFailed; `primary` for the
    others).
- `Timeline.parallel`:
  - 3 sub-steps, all resolve → composite resolves.
  - 1 sub-step cancels → composite cancels.
  - ttl exceeded on one sub-step → composite cancels.
- Player ambient suppression:
  - Critical cinematic active → new ambient timeline does not start.
  - Critical completes → ambient queue resumes.
- Player onAbort:
  - TTL exceeded → `onAbort` runs.
  - Preempted by higher lane → `onAbort` does not run.
- Event → cinematic map:
  - `qa.functional-failed` → qaFailed factory called.
  - `swarm.scout-completed` → per-scout follow-up factory.
  - `pr.merged` hero / non-hero branches.

### Integration tests

- A scripted sequence of events: `state.transitioned(investigating)` →
  `swarm.wave-started` → 3× `swarm.scout-completed` →
  `swarm.wave-completed` → `state.transitioned(in-progress)` →
  `agent.run-started` → `agent.run-completed` →
  `state.transitioned(needs-qa)` → `qa.functional-failed` →
  `state.transitioned(in-progress)` → ... → `pr.merged`. Assert that
  the player's lane activity follows the expected pattern (intent
  observability events emitted in the expected order).

Phaser tween calls are mocked at the layer boundary — phase 5 tests
do not require a real WebGL context.

### E2E

- `office-click-through.spec.ts` continues to pass.
- Optional: a `phase-5-cinematics` opt-in spec
  (`RUN_SCREENSHOTS=1`) that runs the v1 journey end-to-end and
  captures screenshots at: investigation wave mid-fan-out, qaFailed
  corridor pulse, review door open, shelf landing. Not required for
  CI green.

---

## 11. Manual verification checklist

Before opening the PR, run a full v1 journey in the dev server:

- [ ] `factory:triaging` → ticket appears in Triage room with a persona.
- [ ] Transition to `factory:investigating`: persona walks across
      corridor to investigation lab; ticket follows (carry).
- [ ] Emit `swarm.wave-started`: 3 scout envelopes spawn at Library
      slots. Indicators light up.
- [ ] Emit `swarm.scout-completed` ×3: each envelope tweens south
      through the library slot to the lead investigator desk.
- [ ] Emit `swarm.wave-completed`: convergence glow at lead desk;
      ticket gets `check` glyph.
- [ ] Transition to `factory:dev-ready`: persona walks to Dev room;
      ticket follows.
- [ ] Emit `agent.run-started`: persona seats at a dev desk; indicator
      `speech`; desk lamp on.
- [ ] Emit `agent.run-completed`: indicator briefly `check`, then
      clears.
- [ ] Transition to `factory:needs-qa`: persona walks to QA queue
      anchor; ticket transits through QA input slot (queue → exterior →
      interior).
- [ ] Emit `qa.functional-failed`:
  - Red verdict scroll exits QA output slot.
  - Red corridor pulse sweeps east-to-west.
  - Review wall dims briefly.
  - Ticket returns to a dev desk.
  - Indicator becomes `bang`.
  - Camera centers on QA output at start; returns to floor-overview
    after.
  - Total ≤ 3.5s.
- [ ] During the qaFailed cinematic, fire a `state.transitioned` on
      another ticket (non-hero). Expected: it does not animate during
      critical; resumes after qaFailed ends.
- [ ] Transition through second QA pass, then `factory:needs-review`:
      persona walks to Review queue anchor; ticket waits (no door
      transit yet because Review is gated).
- [ ] Emit `review.converged`:
  - Review door opens.
  - Ticket transits through door slot.
  - Ticket walks east in corridor to Done door.
  - Door closes.
- [ ] Emit `pr.merged`:
  - Ticket descends to shelf slot 3.
  - Existing shelf tickets shift outward; off-shelf items fade.
  - Green glow + particle burst.
  - Camera returns to `floor-overview`.
  - Banner Hero-Ticket cell clears.
- [ ] No console errors throughout the journey.
- [ ] All intent observability events visible in DevTools
      (`scene.events_().on('choreo.intent-started', ...)` callable).

If a step fails visually, fix it. Do not ratify in tests.

---

## 12. Stop conditions

Stop and ask the human if any of the following occur:

- A cinematic exceeds its hard timing cap (qaFailed > 3.5s,
  mergeCelebration > 2s, etc.). The cap is the contract; speed up the
  implementation, do not raise the cap.
- The four cinematics share enough structure that a "cinematic DSL"
  starts to feel necessary. v1 has four; YAGNI. Surface and ask before
  abstracting.
- Phaser particles or graphics primitives do not suffice for a step
  (e.g. you find yourself wanting a shader). Surface — this is a v1
  scope-limit problem, not an implementation problem.
- Cinematic factories grow past ~200 lines each. They should not;
  most of the logic is in intents.
- An intent module needs to read from another layer it does not own.
  Restate the design — intents should call narrow primitive methods on
  exactly one layer.
- Hero promotion conflicts between click-sticky and cinematic produce
  visible flicker. Specifically: rapid cinematic start, end, click,
  cinematic start on a 3rd ticket. The override rule in §5 should
  produce a clean handoff; if it does not, debug before adding new
  rules.

---

## 13. Explicit non-goals

Restated:

- **No generalised cinematic framework.** Four named cinematics, hand
  composed.
- **No HUD overlays.** Hero label *above* a persona sprite exists from
  phase 3; the banner cell exists from phase 2; nothing new beyond
  that in phase 5.
- **No retry / convergence counter rendering.** Phase 5 emits the
  events; phase 6 draws the badges.
- **No watchtower / audit cinematic.** Critical lane has the slot but
  no anchors.
- **No TDD glyphs, monitor flicker, tool-call micro-animations.**
- **No sound, ambience, atmospheric polish.**
- **No multi-floor, building view, lobby, backstage, corkboard.**
- **No persona variants, no tier badges, no streaks / win counters.**
- **No procedural ambient motion** (janitor goose, coffee machine,
  etc.). These are atmospheric polish.
- **No new event kinds beyond the v1 catalogue.**
- **No mutation of workflow state.** Restated again because cinematic
  code is the place this invariant is most likely to be casually
  violated ("just emit a label write on merge complete..." — no.)

---

## 14. What happens after Phase 5

Phase 6 (next session, after Phase 5 PR merges):

- Author `lib/hud-overlays.ts` — pure module computing overlay state
  from current `applyPlacements` + intent observability events.
- Add a `HudLayer` (or extend `RoomLayer`'s canvas-hud band) for
  in-world overlays: queue depth badges, retry counter at QA, round
  counter at Review, QualityScore dial readout, Done-day badge.
- Add the runtime event feed: a small DOM-side feed (React) that
  subscribes to `'choreo.intent-started'` / `'choreo.intent-completed'`
  events on the scene emitter and renders a scrolling 5-line log.
- Surface room pressure overlays + blocked-state spotlight.
- Hero ticket camera state badge.

This plan only covers Phase 5.
