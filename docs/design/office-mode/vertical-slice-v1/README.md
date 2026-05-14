# Office Mode — Vertical Slice v1

**Status:** Phases 1–2 merged. Phases 3–6 specified, not yet implemented.

This directory is the authoritative implementation roadmap for the first
cinematic vertical slice of Goose Hub Office Mode. Future sessions should
start here.

The slice is **deliberately narrow.** It exists to prove one cinematic
journey end-to-end on one project floor, not to build the full operational
office described in `docs/office-mode-operational-model.md`. Anything not
called out below is out of scope.

---

## 1. What v1 proves

A single WorkItem, observed at the office, traversing:

```
factory:triaging → triage room
   → factory:investigating  → investigation room
       → Wave 1 fan-out (3 scouts, sealed library)
       → swarm.wave-completed
   → factory:dev-ready / factory:in-progress → dev room
       → builder seats; desk lamp on
   → factory:needs-qa → qa room (sealed)
       → qa.functional-failed (one retry)
       → ticket reroutes to dev via red corridor pulse
       → second pass passes
   → factory:needs-review → review room (frosted)
       → review.converged → door opens
   → factory:done → done shelf
       → mergeCelebration
```

This single journey, animated faithfully from real orchestration events on
the SSE `/events` stream, is the v1 deliverable. Everything in this
directory exists to deliver it.

When a player runs the dev server, picks one project, and watches the
office for the lifetime of one issue, they should see this journey as a
coherent cinematic. Nothing more.

---

## 2. Documents in this directory

| File                                       | Phase | Scope                                                          | Status      |
| ------------------------------------------ | ----- | -------------------------------------------------------------- | ----------- |
| `phase-1-pure-refactor.md`                 | 1     | Split `OfficeScene` into `FloorLayer` + `SpriteLayer`         | merged      |
| `phase-2-rooms-and-anchors.md`*            | 2     | Adopt Board 02 canon: 6 rooms on a single 1280×384 floor       | merged      |
| `phase-2.5-visual-canon-adoption.md`       | 2.5   | Repalette `textures.ts` to Board 06; expand PixelLab manifest  | specified   |
| `phase-3-persona-ticket-split.md`          | 3     | Split sprite rendering into `PersonaSprite` + `TicketSprite`   | specified   |
| `phase-4-event-choreography.md`            | 4     | Add `ChoreographyPlayer` + lane model + SSE-driven intents     | specified   |
| `phase-5-cinematics.md`                    | 5     | Implement 4 canonical v1 cinematics                            | specified   |
| `phase-6-runtime-hud.md`                   | 6     | Minimum runtime overlays — physically integrated into the world | specified   |

\* Phase 2 plan was not authored as a standalone file; its contract is the
spec at `docs/design/office-mode/goose-hub-office-mode-design-pack/02-canonical-project-floor/design-spec.md`
(Board 02). Phase 2 implementation landed in PR #770. Future phase docs
should reference Board 02 for floor geometry rather than restating it.

Phase 2.5 was inserted retroactively after Phases 1–2 merged. It closes
the visual-fidelity gap that Board 02's geometry-only spec did not
address: the runtime had been using an ad-hoc palette and an
under-scoped PixelLab manifest. It may run in parallel with Phase 3
because the two phases touch disjoint code.

Each phase doc is self-contained and consumable in isolation. They share
the invariants listed in §6.

---

## 3. Roadmap status table

| Phase | Title                            | Output                                                   | Depends on |
| ----- | -------------------------------- | -------------------------------------------------------- | ---------- |
| 1     | Pure refactor                    | `FloorLayer`, `SpriteLayer` siblings; behaviour preserved | —          |
| 2     | Rooms & anchors                  | `lib/rooms.ts`, 6-room single-floor geometry              | 1          |
| 2.5   | Visual canon adoption            | Board 06 palette wired into `textures.ts`; PixelLab manifest expanded to ~30 sprites | 2 |
| 3     | Persona/ticket split             | `PersonaSprite`, `TicketSprite`, carry semantics          | 2          |
| 4     | Event choreography               | `ChoreographyPlayer`, lanes, intent registry              | 3          |
| 5     | Cinematics                       | 4 named cinematics: wave, qaFailed, reviewConverged, mergeCelebration | 4 |
| 6     | Runtime HUD                      | Overlay layer integrated into the world                   | 5          |

Each phase ships behind its own PR. Phases do not skip; phase 5 cannot
land before phase 4 because it consumes the choreography player; phase 4
cannot land before phase 3 because it dispatches intents to the persona /
ticket sprite contracts.

Phase 2.5 has no downstream dependency — Phases 3–6 animate against
whatever assets exist, and the procedural fallback in `textures.ts`
keeps everything renderable if Phase 2.5 hasn't landed. Running it
before Phase 5 is strongly recommended so cinematic visuals match the
canon out of the gate.

---

## 4. The cinematic journey, in order of phase landing

Phase 1 — refactor only; visually identical to M17.
Phase 2 — the single-floor 6-room geography exists; tickets and personas
still render as combined sprites; sprites still slide.
Phase 3 — personas and tickets are visually separate; tickets follow
personas via the carry contract; queue stacks read at each room doorway.
Phase 4 — SSE events flow into intents flow into the player; the simplest
intents (`walkToRoom`, `attachToDesk`) animate. No multi-step cinematics
yet.
Phase 5 — the four canonical cinematics run end-to-end on the v1 journey.
Phase 6 — overlays surface hero labels, queue depth, retry counts,
convergence progress, room pressure. The slice is shippable.

---

## 5. Architectural seams to preserve

These seams exist because later milestones will expand them. Future
sessions must not collapse them during v1 work.

### 5.1 React ↔ Phaser boundary

React owns:
- Data ingestion (TanStack Query for issues, EventSource for SSE).
- `activeProject` selection.
- Derived `placements` (pure function of work items).
- DOM-layer HUD (`FloorIndicator`, `DeskDetailPanel`).
- Routing.

Phaser owns:
- Rendering only.
- Scene-local sprite, layer, anchor, and effect state.
- A scene `EventEmitter` for scene → React events (`'ready'`, `'desk-click'`, `'floor-change'`).

React pushes via `applyProjects`, `applyPlacements`, `applyChoreography`*,
`panToProject`. Phaser pushes back only via the emitter.

\* `applyChoreography` is introduced in phase 4 as a new push channel for
event-derived intents. It is parallel to `applyPlacements`, not a
replacement.

### 5.2 Scene-local ownership

Each layer (`FloorLayer`, `SpriteLayer` → splitting in phase 3 to
`PersonaLayer` + `TicketLayer`) owns its own containers, sprites, anchors,
and event handlers. Cross-layer reads go through the scene; cross-layer
writes do not exist. Layers do not import each other.

### 5.3 Pure libs

`lib/rooms.ts`, `lib/agent-positions.ts`, `lib/layout.ts`,
`lib/pathfinding.ts`, `lib/state-indicators.ts`, `lib/state-to-room.ts`,
`lib/persona-codenames.ts` are pure modules with no Phaser import. They
are unit-tested in isolation in `slice.test.ts`. New choreography logic
(phase 4) and HUD computation (phase 6) extend this pattern with new pure
modules — they do not introduce Phaser into existing libs.

### 5.4 Visualisation-only invariant

The Phaser office reads orchestration truth and renders it. It does not
mutate it. No scene method, layer method, sprite method, or choreography
node may issue a `fetch`, `postMessage`, label write, or any other
side-effecting call against workflow state. Click events emit on the
scene emitter; React handles workflow-aware side effects.

This invariant is enforced by Board 02 §1.5 and is restated in every
later phase doc because it is the single most important constraint of
the slice.

### 5.5 Single project per scene

`OfficeScene.applyProjects` accepts exactly one `OfficeProject` in v1.
Multi-project rendering and cross-project navigation were valid M17
behaviours; they are explicitly deferred (see §7). The mount and tab
select `activeProject` upstream.

### 5.6 Coordinates live in one place

All world coordinates — room interior bounds, door centers, desks,
station anchors, slot anchors (queue / exterior / interior), shelf
slots, queue stack anchors, camera anchors — live in `lib/rooms.ts`.
Scene, layer, and component code consume the table; no coordinate
literal appears in `apps/web/src/components/office/{game,components}/`
except via `lib/rooms.ts` import. Phase 4 and 5 add cinematic timings
and event mappings; these live in their own pure module
(`lib/choreography.ts`), not in `lib/rooms.ts`.

---

## 6. Invariants every phase must preserve

Restated here so future sessions read them once, then again in each phase.

1. **Office is visualisation only.** No scene/layer/sprite mutates
   workflow state. See §5.4.
2. **React ↔ Phaser boundary is one-way push + emitter-back.** See §5.1.
3. **Scene-local ownership.** Layers don't import each other. See §5.2.
4. **Pure libs stay pure.** No Phaser import in `lib/`. See §5.3.
5. **Single project per scene.** See §5.5.
6. **All coordinates in `lib/rooms.ts`.** See §5.6.
7. **All cinematic timings / event mappings in `lib/choreography.ts`**
   (introduced phase 4). Same single-source-of-truth rule as rooms.
8. **No ECS.** The choreography system is a lightweight intent dispatcher
   on top of Phaser's existing scene graph, not a generic entity-component
   framework. Phase 4 spells this out.
9. **Holdout sealing is visible.** Library, QA, and Review walls and
   slots render their seal/frost. A persona never visually walks through
   a sealed wall. Verdict scrolls and envelopes use slot anchors.
10. **Phaser as renderer.** No game-logic AI, no agent autonomy inside
    Phaser. Personas move because an intent told them to move; intents
    come from events; events come from the server.

If a future change makes any of these invariants harder to honour, the
change is wrong, not the invariant. ADR it before proceeding.

---

## 7. Deferred systems

Out of scope for v1. Each one is a real system in the operational model;
none belongs in this slice.

| System                              | Why deferred                                                |
| ----------------------------------- | ----------------------------------------------------------- |
| Multi-floor stacking                | One project at a time; floor nav unnecessary for slice      |
| Building view (multiple projects)   | Same                                                        |
| Lobby (inbox, courier, budget board) | Funnel visualisation is a later milestone                  |
| Watchtower / auditor sprite         | Audit gate is a critical-lane slot but no anchors yet      |
| Backstage corkboard / coach office  | Meta-loop visualisation requires Retro room first          |
| Discovery sub-rooms                 | Grilling / PRD / decomposition fold into Triage in v1       |
| Research lab                        | Folded into Investigation                                   |
| Spec booth + builder board          | M19 parallel-build is a separate slice                      |
| Dev-Review nook                     | Reserved tile bounds in Board 02; no v1 furniture          |
| Retro room                          | Folds into Dev with a `retrospecting` indicator            |
| Archive cabinet                     | `factory:archived` shares Done shelf                        |
| Sprite-sheet walk cycles            | Sprites still slide                                         |
| TDD-heartbeat glyphs (RED / GREEN / REFACTOR / LINT) | Tier-3 micro-animation; deferred             |
| Tool-call micro-animations          | Same                                                        |
| Full simulation AI / autonomous geese | Not in scope, ever — Phaser is renderer-only              |
| Procedural generation               | Floors are hand-designed                                    |
| Sound / ambient audio               | Deferred to atmospheric polish slice                        |
| Ambient layer (non-work-item motion) | Atmospheric; not in cinematic core                         |
| Cross-project WorkPackage tethers   | Parallel-build slice                                        |
| Zoom modes beyond floor-overview + hero-ticket-follow | All room/persona-zoom anchors reserved     |
| Multiplayer                         | Not in scope, ever                                          |
| Cross-project building stacks       | Not in scope; v1 is one floor                               |

These are intentionally deferred. The purpose of the slice is **implementation
clarity, not exploration.** If a phase doc surfaces a useful follow-on,
file it as a new milestone-scoped issue. Do not absorb it into v1.

---

## 8. Relationship between the canon documents

This slice draws on three documents that future sessions must keep in
sync:

### 8.1 Operational model — `docs/office-mode-operational-model.md`

The operational model describes the entire Goose Hub orchestration as a
simulation: every entity class, every workflow phase, every archetype,
every wave, every mode, every event tier, every visual abstraction the
office *could* eventually render. It is intentionally larger than v1.

The slice reads it for vocabulary and intent — for example, "ticket as a
physical object that gets carried," "scout fan-out is the cinematic
core," "QA is a sealed holdout." It does not read it for implementation
detail; the slice implements a subset.

### 8.2 Visual canon — the design pack

`docs/design/office-mode/goose-hub-office-mode-design-pack/` holds 12
boards. Of those, the slice consumes:

- **Board 01 — Building blueprint.** Reference only. The slice does not
  build the building; it builds one floor.
- **Board 02 — Canonical project floor.** The **spatial canon for v1.**
  Every coordinate the slice renders is bound to this spec. Phase 2 of
  the roadmap consumed this directly; phases 3–6 honour it.
- **Board 03 — Ticket lifecycle storyboard.** Reference for the journey;
  the slice's cinematic sequencing must align panel-to-panel with this
  board.
- **Board 04 — Zoom semantics.** Reference only; v1 uses two camera
  anchors (`floor-overview`, `hero-ticket-follow`) and reserves the
  rest.
- **Board 05 — Holdout chambers.** Reference for Library / QA / Review
  seal semantics. Phase 5 cinematics consume the slot anchors.
- **Boards 06 — Visual system.** Palette, iconography, animation
  language. Style reference; not coordinate-bearing.
- **Boards 07 — Dynamic choreography.** Reference for phase 4 and 5
  movement grammar.
- **Boards 08 — Runtime HUD.** Reference for phase 6 overlay design.
- **Boards 09–12 — Atmospheric boards.** Reference only; v1 does not
  implement atmospheric polish.

When a coordinate, anchor, or sequencing rule is needed, **Board 02 is
the source.** When a *meaning* is needed (why scouts are sealed in a
library, why QA is holdout, why Review uses frosted glass), the
operational model is the source.

### 8.3 Spatial canon — `lib/rooms.ts`

The pure-library form of Board 02. It is the only place in code that
holds floor coordinates. Future phases extend (e.g. add cinematic
durations) in a sibling module (`lib/choreography.ts`) — never duplicate
coordinate literals.

### 8.4 Implementation roadmap — these phase docs

The phase docs in this directory are the **operational contract** for
the slice. They describe what each phase produces, what it must not
touch, what its acceptance criteria are, and what the next phase
consumes. They reference the canon above but do not duplicate it.

---

## 9. How a future session continues safely

When invoked to work on Office Mode v1:

1. **Read this README.** Identify the current phase (the next one with
   status "specified" and all prior phases "merged").
2. **Read the phase doc for the current phase.** It is self-contained.
3. **Read Board 02 spec** if the phase touches coordinates.
4. **Read the operational model only for vocabulary**, never for
   implementation detail.
5. **Stay in scope.** Acceptance criteria are the contract. Anything
   outside them is out of scope unless you file an ADR and adjust this
   README first.
6. **Honour the invariants in §6.** If a step in the phase doc seems to
   conflict with an invariant, the invariant wins. Stop and surface the
   conflict.
7. **One PR per phase.** Phase docs explicitly forbid bundling.

When a phase merges, mark its status in §2 and §3 of this README and
proceed to the next.

---

## 10. What "done with v1" means

The slice is complete when, in the dev server, picking one project that
has an active WorkItem flowing through the canonical journey produces:

- The full single-floor 6-room geography rendered (phase 2).
- A `PersonaSprite` per active persona, named by codename when hero
  (phase 3).
- A `TicketSprite` carried correctly by personas, parked at desks, and
  travelling through slots as scrolls and envelopes (phase 3).
- The four canonical cinematics firing on real events from the server
  (phases 4 + 5).
- Queue stacks, retry counters, convergence counters, hero labels, and
  the runtime event feed surfacing as overlays integrated into the
  world (phase 6).

Anything else is post-v1.
