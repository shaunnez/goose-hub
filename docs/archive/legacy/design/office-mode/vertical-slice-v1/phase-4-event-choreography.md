# Office Mode Vertical Slice v1 — Phase 4: Event Choreography

**Status:** Specified. Do not begin Phase 5 work in this phase.

**Goal:** Introduce the lightweight event → choreography pipeline that
takes orchestration events from the SSE stream, maps them to declarative
**intents**, and dispatches those intents to the `PersonaLayer` and
`TicketLayer` primitives that phase 3 produced.

Phase 4 is the **glue** between server events and rendered motion. It
does not introduce the four named cinematics (those are phase 5); it
introduces the *machinery* that phase 5's cinematics compose against.

The system is deliberately **lightweight and deterministic.** It is
not an ECS, not a behaviour tree, not a generic timeline framework.
It is a small intent dispatcher with three priority lanes, a single
queue per lane, and a 1-frame coalescing window.

---

## 1. Scope

### In scope

- A direct SSE subscription in the scene (or in the tab and forwarded to
  the scene — see §5). React Query invalidation continues to drive
  data; phase 4 adds an event-direct path **in parallel**.
- `lib/choreography.ts` — pure module defining the intent registry,
  event-to-intent mapping table, lane assignment, and timing constants.
- `ChoreographyPlayer` — a scene-owned dispatcher that runs intents on
  three lanes with deterministic priority + queueing.
- `Timeline` — a simple sequenced container of intents. Phase 4
  supports timelines with at most 3 sequenced steps; phase 5 may extend
  to longer cinematics in code (each cinematic is itself ≤10 steps).
- A v1 event catalogue: a fixed allowlist of event kinds the player
  reacts to. Other event kinds are ignored.
- Three concrete intent implementations:
  - `walkToRoom(personaId, destRoomId)` — wraps phase 3's persona walk.
  - `attachToDesk(personaId, deskSlot)` — wraps phase 3's seat-at-desk.
  - `swapIndicator(personaId | ticketId, glyph)` — wraps phase 3's
    indicator update.
- Interruption + queueing semantics per lane.
- A scene → React channel for **per-intent observability** (for the
  phase 6 event feed). Lane-name + intent-name + status only; no
  workflow reasoning.

### Out of scope (phase 5 and later)

- The four named cinematics (`investigationWave`, `qaFailed`,
  `reviewConverged`, `mergeCelebration`). Phase 4 ships the runtime
  for them; phase 5 ships the cinematics themselves.
- Verdict scrolls, envelopes, particles, glow rings, convergence rings,
  corridor pulses. Phase 5 visuals.
- Camera switches. The `floor-overview` → `hero-ticket-follow`
  transition is a phase 5 concern. Phase 4 may *expose* a camera intent
  in the registry but does not fire one.
- Tier-3 micro-animations (TDD glyphs, tool-call flickers).
- Door-state animation on the Review chamber. The `door.open` /
  `door.close` intents are placeholders in the registry; they snap-on /
  snap-off in phase 4 and animate in phase 5.
- HUD overlays. Phase 6.
- Sound, ambience, atmospheric polish.
- Multi-floor, building view, lobby, watchtower, backstage.
- Procedural generation, simulation AI, ECS-style world model.

If you find yourself touching anything in "out of scope," stop.

---

## 2. Target file structure (after Phase 4)

```
apps/web/src/components/office/
  components/
    OfficeTab.tsx                # ADJUSTED — adds SSE subscription wiring (see §5)
    OfficeGameMount.tsx          # ADJUSTED — exposes new applyChoreography channel
    OfficePage.tsx, FloorIndicator.tsx, DeskDetailPanel.tsx   # unchanged
  game/
    OfficeScene.ts               # ADJUSTED — adds ChoreographyPlayer; exposes applyChoreography
    asset-loader.ts              # unchanged
    textures.ts                  # unchanged (phase 5 adds scroll / envelope)
    choreography/                # NEW DIRECTORY
      ChoreographyPlayer.ts      # NEW — lane dispatcher, ~250 lines
      Timeline.ts                # NEW — sequence container, ~120 lines
      intents/
        walkToRoom.ts            # NEW — wraps PersonaLayer.walk
        attachToDesk.ts          # NEW — wraps PersonaLayer.seat
        swapIndicator.ts         # NEW — wraps swap
    layers/
      RoomLayer.ts               # unchanged
      PersonaLayer.ts            # ADJUSTED — exposes seat(personaId, deskSlot) primitive
      TicketLayer.ts             # unchanged (phase 5 adds slot transit)
      types.ts                   # ADJUSTED — adds IntentResult, IntentStatus
  lib/
    choreography.ts              # NEW — intent registry, event→intent map, lane table, timings
    rooms.ts                     # unchanged
    agent-positions.ts           # unchanged
    state-to-room.ts             # unchanged
    state-indicators.ts          # unchanged
    persona-codenames.ts         # unchanged
    ticket-carry.ts              # unchanged
    pathfinding.ts               # unchanged
  slice.test.ts                  # extended for choreography + event→intent map
```

Total new code budget: ~700 lines including tests. If a phase 4 file
exceeds ~300 lines, split it before merging.

---

## 3. Choreography timeline model

### 3.1 The smallest unit: `Intent`

```ts
export type LaneId = 'critical' | 'primary' | 'ambient';

export interface IntentBase {
  id: IntentName;            // 'walkToRoom' | 'attachToDesk' | 'swapIndicator' | (phase 5 adds more)
  target: { kind: 'persona' | 'ticket' | 'room' | 'door' | 'camera'; id: string };
  params: Record<string, unknown>;  // intent-specific
  lane: LaneId;
  ttlMs: number;             // hard upper bound on running time
}

export type IntentStatus = 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
export interface IntentResult { status: IntentStatus; reason?: string; }
```

A single intent describes one declarative motion: "walk persona X to
room R," "attach ticket T to desk D," "swap indicator on persona P to
`speech`."

Intents are **never created inside Phaser.** They are created by
`lib/choreography.ts` from incoming events and pushed to the player.

### 3.2 The composition unit: `Timeline`

```ts
export interface Timeline {
  id: string;                  // unique per timeline instance
  lane: LaneId;
  ticketId: string | null;     // hero subject if any (drives hero promotion in phase 5)
  steps: Intent[];             // sequenced; one runs at a time
  onComplete?: () => void;     // optional; phase 5 cinematics use this
  source: 'event' | 'placement' | 'click';   // diagnostic only
  startedAt?: number;          // ms timestamp; set by player
}
```

In phase 4, timelines are **at most 3 steps long**:

- For `state.transitioned`: a single step — `walkToRoom`.
- For `agent.run-started`: 2 steps — `attachToDesk` + `swapIndicator`.
- For `agent.run-completed`: 2 steps — `swapIndicator(check)` then a
  delayed `swapIndicator(null)` (250ms tween-as-delay).

Phase 5 cinematics extend this to ≤ 10 steps each. The model does not
change; the depth of the step list does.

### 3.3 Determinism

The player runs intents in **stable order** within a lane:

1. By lane priority: `critical` > `primary` > `ambient`.
2. Within a lane: by `startedAt` ascending (earlier first).
3. Within identical `startedAt` (same SSE tick): by `id` string sort.

There is no per-frame randomness. There is no animation easing variance.
A given input event stream always produces the same intent order.

### 3.4 What a timeline is *not*

- Not an ECS. Intents do not declare components on entities; they call
  named methods on layer primitives.
- Not a state machine. Intents do not transition between states; they
  run to completion or cancel.
- Not a tween graph. Each intent owns its own tween (or none) via the
  layer primitive it wraps.
- Not a generic effect system. Each intent has a single, fixed,
  declarative motion. New motions require new intents in the registry.

This is intentional. v1 needs four cinematics, not a framework.

---

## 4. `ChoreographyPlayer` responsibilities

The player is a single class instantiated by `OfficeScene` in `create()`,
**after** the three layers exist.

### 4.1 Responsibilities

- Receive `Timeline` instances via `scene.applyChoreography(timelines)`.
- Assign each timeline to its lane queue (declared on the timeline).
- Run each lane's queue head:
  - Run the first `Intent`; await completion or `ttlMs` timeout.
  - Advance to the next step. Repeat until the timeline has no more
    steps; emit `IntentResult{ status: 'completed' }` on its
    `onComplete`.
- Coalesce timelines arriving within the same SSE tick: see §4.4.
- Honour interruption rules per lane: see §4.5.
- Emit per-intent observability events on the scene emitter
  (`'choreo.intent-started'`, `'choreo.intent-completed'`,
  `'choreo.intent-cancelled'`). These carry only:
  `{ lane, intentName, target: {kind, id}, status }`. No reasoning,
  no workflow content. Phase 6 consumes them for the event feed.

### 4.2 Lane queues

```ts
class ChoreographyPlayer {
  private queues: Record<LaneId, Timeline[]>;
  private active: Record<LaneId, Timeline | null>;
  // ...
}
```

Three queues, one active timeline per lane. Lanes are independent:
- `critical` can preempt `primary` and `ambient` (see §4.5).
- `primary` and `ambient` run concurrently. A primary intent on
  persona P and an ambient indicator swap on the same persona do not
  conflict if they target different sub-renderables; if they conflict
  (both target `persona.position`), primary wins, ambient is
  cancelled.

Concurrency rule simplified for v1: **each persona / ticket sprite has
at most one active position-changing intent at a time.** The player
tracks a per-sprite "owned by lane" flag; conflicting intents are
either queued behind the current owner (same lane) or preempt (higher
lane).

### 4.3 Per-intent execution

Each intent module exports:

```ts
export function run(intent: Intent, ctx: ChoreographyCtx): Promise<IntentResult>;
export function cancel(intent: Intent, ctx: ChoreographyCtx): void;
```

`ChoreographyCtx` holds references to the three layers (read + narrow
write) and the scene timer. The `run` function wires up a tween or
single-call mutation, returns a promise that resolves on tween-complete
or `ttlMs` timeout. `cancel` aborts the in-flight tween cleanly.

Intent implementations live in `game/choreography/intents/`. Each is
≤ 50 lines and references only its layer + `lib/rooms.ts`.

### 4.4 Coalescing window

The player coalesces multiple `applyChoreography` calls within the same
animation frame. If the React side dispatches 3 timelines in rapid
succession (e.g. an SSE event arrives, React Query refetches, both
push within ms), the player merges them in a single tick. Coalescing
rules:

- Within a tick, multiple timelines on the **same lane targeting the
  same sprite** drop all but the latest. (Latest wins.)
- Within a tick, timelines on the **same lane targeting different
  sprites** all enqueue.
- Across ticks, no merging — separate `applyChoreography` calls in
  different frames produce separate enqueues even on the same target.

Coalescing prevents jitter when state and event arrive within ms of
each other.

### 4.5 Interruption semantics

| Active lane | Incoming lane | Action                                                                   |
| ----------- | ------------- | ------------------------------------------------------------------------ |
| critical    | critical      | enqueue incoming behind active; FIFO                                     |
| critical    | primary       | enqueue incoming on the primary lane queue; do not preempt critical     |
| critical    | ambient       | enqueue incoming on the ambient lane queue; do not preempt              |
| primary     | critical      | **preempt** primary: cancel active primary intent; primary timeline pauses at the current step; critical runs; on critical completion, primary resumes (re-runs the cancelled step from scratch) |
| primary     | primary       | enqueue incoming; FIFO                                                   |
| primary     | ambient       | enqueue incoming                                                         |
| ambient     | critical      | preempt and cancel ambient; ambient does not resume (it's ambient)       |
| ambient     | primary       | preempt and cancel ambient                                               |
| ambient     | ambient       | enqueue if targeting a different sprite; coalesce / drop if same         |

Rules of thumb:
- **Critical is sacred.** It runs immediately and to completion.
- **Primary is resumable.** Cancelled steps re-run from scratch on
  resume.
- **Ambient is disposable.** Cancelled, never resumed.

### 4.6 Queueing semantics

Within a lane queue:

- FIFO by `startedAt`.
- A queued timeline may be **dropped** before it ever runs if a coalesce
  rule (§4.4) replaces it.
- Maximum queue depth per lane in v1: **8**. Beyond 8, oldest pending
  timeline drops with `IntentResult{ status: 'cancelled', reason:
  'queue-overflow' }`. Should not occur on a single-ticket journey;
  if it does, log it.

### 4.7 TTL behaviour

Every intent declares a `ttlMs`. If `run` does not resolve within `ttlMs`,
the player calls `cancel` and emits
`IntentResult{ status: 'failed', reason: 'ttl-exceeded' }`. The
containing timeline then aborts (no remaining steps run); its
`onComplete` is *not* called. This is a safety hatch, not a feature —
v1 does not depend on it firing.

Suggested baselines:
- `walkToRoom`: `ttlMs = 5000`.
- `attachToDesk`: `ttlMs = 1000`.
- `swapIndicator`: `ttlMs = 500`.

---

## 5. SSE subscription wiring

### 5.1 Current state after phase 3

`OfficeTab` opens `EventSource('/events')` and uses each event purely
to invalidate React Query for the affected project. The scene reacts
only to the resulting `applyPlacements` diff.

### 5.2 Phase 4 wiring

Phase 4 **does not remove** the React Query invalidation path. It is
the data-truth path; it stays.

In **parallel**, the same `EventSource` handler invokes a new pure
function:

```ts
// lib/choreography.ts
export function timelinesForEvent(
  event: OrchestrationEvent,
  context: { hero: string | null; rooms: typeof ROOM_IDS; }
): Timeline[];
```

The returned timelines are pushed to the scene via
`scene.applyChoreography(timelines)`. The scene's `ChoreographyPlayer`
consumes them.

This dual path is deliberate:
- React Query holds the **state**.
- The choreography player holds the **motion**.
- A reconciliation pass (the next `applyPlacements`) corrects the scene
  if the choreography missed an event or got a stale state.

### 5.3 Where the subscription lives

Two acceptable approaches; pick one in implementation:

- **Tab-driven (default):** `OfficeTab.tsx` continues to own the
  `EventSource`. It calls `timelinesForEvent` and routes the result
  through `OfficeGameMount` → `scene.applyChoreography`. Keeps the
  scene boundary clean.
- **Scene-driven (rejected for v1):** the scene opens its own
  EventSource. Rejected because it duplicates connections and crosses
  the React ↔ Phaser boundary in a new direction. Do not implement.

### 5.4 Event ordering

Events arrive in stream order. `timelinesForEvent` is pure and stateless,
so it cannot reorder them. The player processes them in arrival order
within each lane (see §3.3 determinism).

If two events arrive in the same React batch (rare), they both produce
timelines; both enqueue; lane priority resolves their interleaving.

---

## 6. Lane system

### 6.1 `critical`

**Purpose:** events that interrupt the player's attention. The lane
preempts primary and cancels ambient.

**v1 driver events:**
- `qa.functional-failed` — surfaces a red verdict scroll exit + corridor
  pulse + retry counter bump. Wires the qaFailed cinematic in phase 5.
- `gate.awaiting-human` — freeze persona in place with `?` indicator;
  ambient dimming overlay (phase 6).
- `audit.autonomy-gate-fired` — placeholder. Anchors reserved (Board
  02 §15). Phase 4 ignores; phase 5+ may wire when the watchtower
  exists.

**Lane characteristics:**
- Max one active intent at a time (cannot subdivide critical events).
- Runs to completion even if higher-priority data arrives.
- TTL strict: a critical intent that times out logs a system note;
  recovery is automatic via next `applyPlacements`.

### 6.2 `primary`

**Purpose:** events that drive the **current hero ticket's** journey.
Visible, narrative motion. Camera focus moves with primary lane in
phase 5.

**v1 driver events:**
- `state.transitioned` for the hero ticket → produces `walkToRoom`.
- `agent.run-started` on the hero ticket's persona → produces
  `attachToDesk` + `swapIndicator(speech)`.
- `agent.run-completed` on the hero ticket's persona → produces
  `swapIndicator(check)` + delayed `swapIndicator(null)`.
- `swarm.wave-started`, `swarm.scout-completed`, `swarm.wave-completed`
  — produce timelines for the `investigationWave` cinematic (phase 5
  consumes; phase 4 maps to placeholder intents that snap until phase 5).
- `review.converged` — produces a placeholder timeline (snap door open /
  closed; phase 5 animates).
- `pr.merged` for the hero — placeholder; phase 5 mergeCelebration.

**Lane characteristics:**
- Can be preempted by critical; cancelled steps re-run from scratch.
- Sole owner of camera-anchor changes (phase 5).
- Hero promotion bound to whichever ticket is the subject of the
  current primary timeline (phase 5 implements this binding; phase 4
  only marks the `ticketId` field on the timeline so phase 5 has the
  hook).

### 6.3 `ambient`

**Purpose:** motion that should be visible but never demands attention.
Cancelled freely.

**v1 driver events:**
- `state.transitioned` for any ticket that is **not** the current hero
  → `walkToRoom` on ambient lane.
- `agent.run-started` / `-completed` for non-hero personas →
  `swapIndicator` on ambient lane.

**Lane characteristics:**
- May be cancelled at any time, never resumes.
- No camera changes.
- No hero promotion.
- Coalesces aggressively (latest indicator swap on a given target wins).

### 6.4 Lane assignment table

`lib/choreography.ts` exports the canonical mapping:

```ts
export const LANE_FOR_EVENT: Record<OrchestrationEventKind, LaneId | null> = {
  'qa.functional-failed': 'critical',
  'gate.awaiting-human': 'critical',
  'audit.autonomy-gate-fired': 'critical',          // phase 5+ may map
  'state.transitioned': 'primary',                   // demoted to ambient if non-hero
  'agent.run-started': 'primary',                    // demoted to ambient if non-hero
  'agent.run-completed': 'primary',                  // demoted to ambient if non-hero
  'swarm.wave-started': 'primary',
  'swarm.scout-completed': 'primary',
  'swarm.wave-completed': 'primary',
  'review.converged': 'primary',
  'pr.merged': 'primary',
  // all other event kinds → null (ignored in v1)
};
```

The "demoted to ambient if non-hero" rule is implemented in
`timelinesForEvent` by inspecting `context.hero`.

---

## 7. Supported v1 event catalogue

The fixed allowlist of events the player reacts to. Anything not in
this table is ignored.

| Event kind                       | Lane     | Resulting timeline                                                    |
| -------------------------------- | -------- | --------------------------------------------------------------------- |
| `state.transitioned` (hero)      | primary  | `walkToRoom(persona, destRoomId)`                                     |
| `state.transitioned` (non-hero)  | ambient  | `walkToRoom(persona, destRoomId)`                                     |
| `agent.run-started` (hero)       | primary  | `attachToDesk(persona, deskSlot)` → `swapIndicator(persona, speech)`  |
| `agent.run-started` (non-hero)   | ambient  | `swapIndicator(persona, speech)`                                      |
| `agent.run-completed` (hero)     | primary  | `swapIndicator(persona, check)` → delay → `swapIndicator(persona, null)` |
| `agent.run-completed` (non-hero) | ambient  | `swapIndicator(persona, check)` → delay → `swapIndicator(persona, null)` |
| `qa.functional-failed`           | critical | (phase 5 fills cinematic; phase 4: `swapIndicator(ticket, bang)`)     |
| `gate.awaiting-human`            | critical | `swapIndicator(persona, question)` + freeze flag                       |
| `swarm.wave-started`             | primary  | (phase 5; phase 4: no-op timeline; logged)                            |
| `swarm.scout-completed`          | primary  | (phase 5; phase 4: no-op)                                              |
| `swarm.wave-completed`           | primary  | (phase 5; phase 4: snap `swapIndicator(ticket, check)`)               |
| `review.converged`               | primary  | (phase 5 animates door; phase 4: snap door open/closed)               |
| `pr.merged`                      | primary  | (phase 5; phase 4: snap ticket to shelf via `TicketLayer` primitive)  |

**Everything else** — `agent.tool-call`, `agent.decision-summary-live`,
`agent.log`, `tool.*`, `coach.*`, `retrospective.*`, `decompose.*`,
`prd.*`, `grill.*`, `merge.conflict*`, `parallel-implement.*`,
`audit.*`, `cost.*`, `project.*` — is **ignored** by the player in v1.
React Query invalidation still runs for these (data path).

The ignored set is intentionally large. The slice is one ticket
through one journey; nothing else needs choreographing.

---

## 8. Sequencing model

### 8.1 Timeline construction (per-event, pure)

```ts
function timelinesForEvent(event, context) {
  // 1. Look up lane (LANE_FOR_EVENT).
  // 2. If hero context matters, demote to ambient if event.ticketId !== context.hero.
  // 3. Map (event.kind, event.payload) to a sequence of intent specs.
  // 4. Wrap as Timeline { id: uuid, lane, ticketId, steps, source: 'event' }.
  // 5. Return.
}
```

Pure. No side effects. Tests assert: same event + context → same
timeline sequence (id is mockable for tests).

### 8.2 Player loop

```
on applyChoreography(timelines):
  for each timeline:
    coalesce(timeline) into queues[lane]
  process()

process():
  for each lane in [critical, primary, ambient]:
    if active[lane] is null and queue[lane] is non-empty:
      active[lane] = queue[lane].shift()
      runNextStep(active[lane])

runNextStep(timeline):
  step = timeline.steps[i]
  if no step: complete(timeline); active[lane]=null; process()
  intent.run(step).then(result => {
    if result.cancelled: handlePreempt(timeline); return
    if result.failed: abort(timeline); return
    advance; runNextStep(timeline)
  })
```

This is the entire player. ~80 lines. Anything more elaborate is
overdesign for v1.

### 8.3 Lane preemption flow

```
critical timeline arrives:
  if active[primary] exists:
    save (timeline, stepIndex) for resume
    intent.cancel(active[primary].steps[stepIndex])
    active[primary] = null
  if active[ambient] exists:
    intent.cancel(active[ambient])
    active[ambient] = null  // no resume save
  enqueue critical, process()

on critical completion:
  if saved primary exists:
    primary queue.unshift(saved)
    process()
```

### 8.4 Timing ownership

The player **does not own animation durations.** Each intent runs its
own Phaser tween with its own duration. The player only knows:
- Did the tween resolve, or did it not?
- Did ttlMs elapse?

Animation timing values live in `lib/choreography.ts` constants
(per-intent). Each intent imports its own duration constant; the player
is opaque to them.

This separation lets phase 5 tune cinematic timing without touching the
player.

---

## 9. Ownership boundaries

| Concern                              | Owner                                | Reads from                          |
| ------------------------------------ | ------------------------------------ | ----------------------------------- |
| SSE connection                       | `OfficeTab` (React)                   | `/events`                            |
| Event → Timeline mapping             | `lib/choreography.ts` (pure)          | event payload + hero context        |
| Timeline → Player dispatch           | `OfficeScene.applyChoreography`       | React calls                         |
| Lane queueing, coalescing            | `ChoreographyPlayer`                  | own state                            |
| Intent execution                     | `game/choreography/intents/*.ts`      | layer primitives + `lib/rooms.ts`   |
| Persona walk tween                   | `PersonaLayer`                        | `lib/pathfinding.ts`, `lib/rooms.ts` |
| Ticket carry follow                  | `TicketLayer`                         | `PersonaLayer.getCarrierPosition`    |
| Indicator swap                       | `PersonaLayer` / `TicketLayer`        | `lib/state-indicators.ts`            |
| Camera                               | `OfficeScene` (unchanged from phase 3)| —                                    |

**Phaser tween ownership** rule: a tween is created and destroyed by the
layer that owns the sprite it animates. The player never creates a
tween directly; intents create tweens by calling layer methods. This
keeps tween lifetimes scoped to sprite lifetimes (a destroyed sprite
auto-cancels its tweens).

---

## 10. Event → intent mapping (detailed)

The mapping in `lib/choreography.ts` is a single exported table plus
small per-event functions for non-trivial payload-derived intent
parameters. The functions are pure.

Example:

```ts
function intentsForStateTransitioned(event, context): Intent[] {
  const isHero = event.ticketId === context.hero;
  const lane: LaneId = isHero ? 'primary' : 'ambient';
  const destRoom = stateToRoom(event.toState);
  if (destRoom == null) return [];
  return [{
    id: 'walkToRoom',
    target: { kind: 'persona', id: event.personaId },
    params: { destRoomId: destRoom },
    lane,
    ttlMs: 5000,
  }];
}
```

All such functions live next to the table. No conditional logic outside
this file decides lane assignments or intent shapes. Tests cover each
function with at least: hero case, non-hero case, missing payload case
(returns empty array).

---

## 11. Acceptance criteria

The PR is mergeable iff:

- [ ] `pnpm test` passes. New tests cover lib + player + intents.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` passes.
- [ ] `office-click-through.spec.ts` passes in CI.
- [ ] `game/choreography/ChoreographyPlayer.ts` exists; ≤ 300 lines.
- [ ] `game/choreography/Timeline.ts` exists; ≤ 150 lines.
- [ ] `game/choreography/intents/` contains three intent modules:
      `walkToRoom.ts`, `attachToDesk.ts`, `swapIndicator.ts`. Each ≤
      80 lines.
- [ ] `lib/choreography.ts` exists with `timelinesForEvent`,
      `LANE_FOR_EVENT`, and per-event helper functions. Pure (no
      Phaser imports).
- [ ] `OfficeScene` exposes `applyChoreography(timelines: Timeline[])`.
- [ ] `OfficeTab` opens SSE, calls `timelinesForEvent`, dispatches
      through `OfficeGameMount`. React Query invalidation **also**
      still happens for the same events.
- [ ] No imports between `ChoreographyPlayer` and `PersonaLayer` /
      `TicketLayer` directly — intents go through layer primitive
      methods only.
- [ ] No Phaser imports in `lib/choreography.ts`.
- [ ] No event-kind strings appear in code outside
      `lib/choreography.ts` (single source of truth for event names
      the scene cares about).
- [ ] Per-intent observability events (`'choreo.intent-started'`,
      `'choreo.intent-completed'`, `'choreo.intent-cancelled'`) emit
      on the scene emitter. They carry only `{ lane, intentName,
      target: {kind, id}, status }`.
- [ ] **No mutation of workflow state.** Grep for `fetch`, `postMessage`,
      label-write calls in `apps/web/src/components/office/game/`
      returns no matches.
- [ ] **No coordinate literals** in `game/` outside `lib/rooms.ts`
      imports (grep check from Board 02 §18).
- [ ] No new dependencies in `apps/web/package.json`.
- [ ] Manual verification (§13) all ticked.

---

## 12. Test surface

### Unit tests (`slice.test.ts`)

- `timelinesForEvent`:
  - `state.transitioned` hero → primary `walkToRoom`.
  - `state.transitioned` non-hero → ambient `walkToRoom`.
  - `agent.run-started` hero → primary `attachToDesk` + `swapIndicator`.
  - `qa.functional-failed` → critical.
  - Unsupported event kind → empty array.
- `LANE_FOR_EVENT` allowlist is the only declaration; assertion that
  every event handled in tests is in the table.
- Coalescing: two timelines on the same lane targeting the same sprite
  in one tick collapse to the latter.

### Integration / player tests

- Player runs a single primary timeline to completion → emits
  `intent-started` → `intent-completed` events in order.
- Critical preempts primary: primary step cancels, critical runs,
  primary resumes from same step.
- Ambient cancelled by critical does not resume.
- TTL exceeded → intent failed → timeline aborts.

Phaser tween calls can be mocked. The player itself does not need a
running scene to test.

### E2E

- `office-click-through.spec.ts` continues to pass.
- Optional: an opt-in spec that emits a synthetic SSE event through
  the dev EventSource shim and asserts the scene moved a persona.
  Not required for CI.

---

## 13. Manual verification checklist

Before opening the PR, in the dev server:

- [ ] Office tab loads without console errors.
- [ ] Trigger a state transition (manually label an issue
      `factory:in-progress`). Expected: persona walks into Dev room
      via the corridor; ticket follows (carry contract from phase 3).
- [ ] Trigger `agent.run-started`. Expected: persona seats at a dev
      desk; indicator becomes `speech`.
- [ ] Trigger `agent.run-completed`. Expected: indicator briefly
      becomes `check`, then clears after ~250ms.
- [ ] Trigger `qa.functional-failed`. Expected (phase-4 placeholder):
      ticket gets `bang` indicator immediately; critical-lane event is
      visible via the per-intent observability emitter (DevTools shows
      `choreo.intent-completed` for `swapIndicator` on the critical
      lane). No cinematic yet.
- [ ] Trigger two transitions in rapid succession on the same persona.
      Expected: coalescing — only the second walk plays; the first is
      dropped or shadowed.
- [ ] Trigger `qa.functional-failed` while a primary walk is in flight.
      Expected: primary walk pauses (its step cancels); critical runs;
      primary resumes (re-walks from start). Visible as a single
      restart at the persona's starting position.
- [ ] Verify SSE subscription is alive after 5 minutes idle (the
      EventSource auto-reconnects per existing M17 wiring; nothing to
      add in phase 4 beyond preserving it).

If any behaviour differs, fix it. Do not ratify in tests.

---

## 14. Stop conditions

Stop and ask the human if any of the following occur:

- The lane-priority rule produces visible jitter (e.g. primary keeps
  preempt-resuming on every critical event). The rule is right; if it
  fights the data, the data interpretation is wrong. Surface and
  re-think.
- You find yourself wanting to add per-frame `update()` loops.
  Choreography is intent-driven, not frame-driven. If the design needs
  per-frame logic, restate the design.
- `timelinesForEvent` becomes longer than ~300 lines including
  per-event helpers. The event allowlist is small; the file should be
  small.
- You need to introduce a new event kind not in the allowlist for the
  v1 journey. Ask first; the allowlist is deliberately narrow.
- The intent registry grows beyond the three v1 intents in phase 4. New
  intents are a phase 5 concern.

---

## 15. Explicit non-goals

Restated for clarity:

- **No full ECS.** Intents are not components; entities are not
  registered.
- **No generic effect framework.** Each intent is a fixed wrapper
  around a layer primitive.
- **No camera intent firing.** A `cameraTo(anchor)` intent may exist
  in the registry to make the phase 5 type signatures cleaner, but
  phase 4 never enqueues it.
- **No door animations.** Snap on/off only.
- **No verdict scrolls, envelopes, particles, glow rings,** convergence
  rings, corridor pulses.
- **No HUD rendering.** Phase 6.
- **No sound. No ambience.**
- **No multi-floor, watchtower, lobby, corkboard.**
- **No simulation AI, autonomous behaviour, procedural movement.**
- **No mutation of workflow state.** Restated again because it remains
  the load-bearing invariant.

If a future phase needs work that *feels* like it belongs in phase 4,
move it. Phase 4 must stay narrow.

---

## 16. What happens after Phase 4

Phase 5 (next session, after Phase 4 PR merges):

- Author the four cinematics (`investigationWave`, `qaFailed`,
  `reviewConverged`, `mergeCelebration`) as composed `Timeline`s of
  new + existing intents.
- Add new intents: `slotTransit` (3-anchor tween), `spawnVerdictScroll`,
  `spawnScoutEnvelope`, `cameraTo`, `doorState`, `corridorPulse`,
  `glowRing`, `particleBurst`, `shelfLand`.
- Switch camera to `hero-ticket-follow` during primary cinematics; back
  to `floor-overview` at completion.
- Ambient suppression: while a critical cinematic is in flight, ambient
  lane is paused.

Phase 6: HUD overlays consume the per-intent observability events to
power the event feed; queue depth, retry counters, convergence counters,
hero labels surface as canvas-hud or DOM-hud per Board 02 §7.

This plan only covers Phase 4.
