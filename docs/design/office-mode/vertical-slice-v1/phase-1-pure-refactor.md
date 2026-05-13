# Office Mode Vertical Slice v1 — Phase 1: Pure Refactor

**Status:** Implementation-ready. Do not begin Phase 2 work in this phase.

**Goal:** Split `apps/web/src/components/office/game/OfficeScene.ts` (556 lines)
into a thin scene + two layer files, behaviour-preserving. No new features.
Every existing test stays green. The Office tab looks and behaves identically
to before the refactor.

**Why this phase exists:** The scene is already over-sized; Phase 2
(rooms + persona/ticket split) and Phase 3 (choreography player) will each
add ~200 lines of new responsibility. Splitting now keeps each later phase
additive, not surgical. A pure refactor with green tests is also the
lowest-risk way to validate the boundary contracts before any cinematic
work lands.

---

## 1. Scope

### In scope

- Mechanical relocation of code currently inside `OfficeScene.ts` into two
  new layer files: `layers/FloorLayer.ts` and `layers/SpriteLayer.ts`.
- Introduction of a `BaseLayer` (or equivalent thin interface) that both
  layer files implement, owned by the scene as composition members.
- Replacement of direct `this.xyz` calls inside `OfficeScene` methods with
  delegating calls to the appropriate layer instance.
- Light renaming where the new file home makes a method name more sensible
  (e.g. `OfficeScene.spawnSprite` → `SpriteLayer.spawn`).

### Out of scope (Phase 2 and later, do not touch in Phase 1)

- Adding rooms, room anchors, or any `lib/rooms.ts` content. Floors stay
  as a row of 10 desks.
- Splitting `Sprite` into `PersonaSprite` + `TicketSprite`.
- Replacing M17 multi-floor stacking with single-floor. **Multi-floor
  navigation continues to work in Phase 1.**
- Adding event-direct SSE subscription. React Query invalidation stays as
  the only path.
- Adding `ChoreographyPlayer`, `Timeline`, or any choreography primitive.
- Changing the React side (`OfficeTab`, `OfficeGameMount`) **except** for
  type renames if a public scene API moves.
- Changing the pure libs (`lib/layout.ts`, `lib/pathfinding.ts`,
  `lib/agent-positions.ts`, `lib/state-to-role.ts`, `lib/state-indicators.ts`).
- Any change to `slice.test.ts` other than adjusting imports if a type
  moves files.
- Any change to e2e tests.
- Renaming `OFFICE_ROLES` or anything in the role/state mapping layer.

If you find yourself touching anything in "out of scope," stop. Either it's
genuinely required for the refactor to compile (rare; document why) or
you've drifted into Phase 2.

---

## 2. Target file structure (after Phase 1)

```
apps/web/src/components/office/
  components/
    OfficePage.tsx               # unchanged
    OfficeTab.tsx                # unchanged
    OfficeGameMount.tsx          # unchanged (imports may need adjustment if types move)
    FloorIndicator.tsx           # unchanged
    DeskDetailPanel.tsx          # unchanged
  game/
    OfficeScene.ts               # SHRUNK — target ~200 lines
    asset-loader.ts              # unchanged
    textures.ts                  # unchanged
    layers/                      # NEW DIRECTORY
      types.ts                   # NEW — shared layer interface + payload types
      FloorLayer.ts              # NEW — target ~220 lines
      SpriteLayer.ts             # NEW — target ~230 lines
  lib/
    agent-positions.ts           # unchanged
    layout.ts                    # unchanged
    pathfinding.ts               # unchanged
    state-indicators.ts          # unchanged
    state-to-role.ts             # unchanged
  slice.test.ts                  # unchanged (or imports-only)
```

**Naming note:** These layers are named `FloorLayer` and `SpriteLayer` to
reflect what they currently do, not what they will eventually become. Phase 2
will *rename* `FloorLayer` → `RoomLayer` (when desks become rooms) and *split*
`SpriteLayer` → `PersonaLayer` + `TicketLayer`. **Do not pre-name them now.**
Honest naming over aspirational naming.

---

## 3. What moves where

Line numbers below refer to the current `OfficeScene.ts` on
branch `claude/milestone-17-setup-BRII1` at commit `fbcb6ac`.
Re-verify line numbers before editing — they may shift if the file changes.

### 3.1 Stays in `OfficeScene.ts`

| Concern                              | Current location       |
| ------------------------------------ | ---------------------- |
| Imports + type exports               | top of file            |
| `OfficeProject`, `DeskClickPayload`, `FloorChangePayload` interfaces | top of file |
| `OfficeScene extends Phaser.Scene` class declaration | class scaffold |
| `emitter`, `events_()`, `'ready'` emit | scene lifecycle        |
| `setVerifiedAssets`, `preload`        | scene lifecycle        |
| `create()` — camera bg, `ensureOfficeTextures`, keyboard handlers, resize listener, `'ready'` emit | lines 108–127 |
| `shutdown()`                         | lines 129–133          |
| `applyProjects` — public API; delegates to FloorLayer + SpriteLayer.dropAll | thin wrapper |
| `applyPlacements` — public API; delegates to SpriteLayer | thin wrapper |
| `panToProject`, `panToFloor`, `navigateFloor`, `snapCameraToFloor`, `handleResize` | camera methods stay |
| `floorIndexFor` private helper       | scene-level coordination — stays |

Move the `WalkPixelsPerMs` constant (`WALK_PIXELS_PER_MS = 0.35`) into
`SpriteLayer` since only sprite logic uses it.

### 3.2 Moves into `layers/FloorLayer.ts`

| Concern                              | Current location       | New location                          |
| ------------------------------------ | ---------------------- | ------------------------------------- |
| `floorContainers: Container[]`       | scene field, line 81   | `FloorLayer.floorContainers`          |
| `deskClickZones: Map<string, Zone>`  | scene field, line 80   | `FloorLayer.deskClickZones`           |
| `buildFloor()`                       | lines 251–327          | `FloorLayer.buildFloor()` (private)   |
| Tile/wall/banner/desk/idle/stairs creation | inside buildFloor | same                                   |
| `refreshIdleDeskIndicators()`        | lines 455–476          | `FloorLayer.refreshIdleDeskIndicators()` (public — SpriteLayer triggers it) |
| `handleDeskClick()` desk-zone callback | lines 522–535         | stays on FloorLayer; emits via injected emitter |
| Stairs click handler                  | inside buildFloor      | stays on FloorLayer; calls injected `navigateFloor` callback |

`FloorLayer` does **not** know about sprites. It takes a project list,
builds containers, and registers click handlers. It exposes:

```
class FloorLayer {
  constructor(scene: Phaser.Scene, emitter: Phaser.Events.EventEmitter, callbacks: { navigateFloor: (delta: number) => void });
  applyProjects(projects: readonly OfficeProject[]): void;
  refreshIdleDeskIndicators(occupiedKeys: ReadonlySet<string>): void;
  destroyAll(): void;
}
```

Note: `refreshIdleDeskIndicators` previously read the scene's `sprites` map
directly. Phase 1 inverts the dependency — `SpriteLayer` computes the occupied
set (`floorIndex:role` keys) and passes it to `FloorLayer`. No new behaviour.

### 3.3 Moves into `layers/SpriteLayer.ts`

| Concern                              | Current location       | New location                          |
| ------------------------------------ | ---------------------- | ------------------------------------- |
| `SpriteEntry` interface              | lines 62–73            | `SpriteLayer` private type             |
| `sprites: Map<spriteId, SpriteEntry>`| scene field, line 79   | `SpriteLayer.sprites`                  |
| `placements: AgentPlacement[]` cache | scene field, line 78   | `SpriteLayer.placements`               |
| `WALK_PIXELS_PER_MS`                 | constant, line 60      | `SpriteLayer` constant                 |
| `spawnSprite()`                      | lines 329–384          | `SpriteLayer.spawn()` (private)        |
| `updateIndicator()`                  | lines 386–391          | `SpriteLayer.updateIndicator()` (private) |
| `walkSprite()`                       | lines 393–453          | `SpriteLayer.walk()` (private)         |
| `restackSpritesAtSharedDesks()`      | lines 478–511          | `SpriteLayer.restackAtSharedDesks()` (private) |
| `applyPlacements` diffing loop       | lines 171–207          | `SpriteLayer.applyPlacements()` (public) |
| Per-sprite `pointerdown` → `desk-click` emit | inside spawnSprite | same; emits via injected emitter      |

`SpriteLayer` exposes:

```
class SpriteLayer {
  constructor(scene: Phaser.Scene, emitter: Phaser.Events.EventEmitter, deps: { getProjects: () => readonly OfficeProject[] });
  applyPlacements(placements: readonly AgentPlacement[]): void;
  dropAll(): void;
  occupiedDeskKeys(): ReadonlySet<string>;
}
```

`getProjects` is a callback (not an injected snapshot) because
`applyPlacements` calls `floorIndexFor(p.projectSlug)` — the layer needs
fresh project state without re-implementing the lookup. Wire it in
`OfficeScene` as `() => this.projects`.

### 3.4 New `layers/types.ts`

Shared types so the two layer files and the scene agree on payload shapes
without cyclic imports:

```ts
export interface LayerCallbacks {
  navigateFloor: (delta: number) => void;
}
```

Plus any re-exports of `OfficeProject`, `DeskClickPayload`,
`FloorChangePayload`, `VerifiedAsset` *if* moving them out of `OfficeScene.ts`
helps. Default: leave them in `OfficeScene.ts` and have layers import from
there. (Less churn for the React side.)

---

## 4. Sequence of edits

Recommended order. Each step compiles independently if you stop after it.

1. **Create `game/layers/` directory + empty `FloorLayer.ts` + `SpriteLayer.ts`** with class stubs and constructor signatures matching §3.2 / §3.3. Do not move logic yet.
2. **Move `SpriteEntry`, sprite-map, and the four sprite methods** (`spawn`, `updateIndicator`, `walk`, `restackAtSharedDesks`) into `SpriteLayer`. Keep `OfficeScene.applyPlacements` calling `this.spriteLayer.applyPlacements(...)`. Verify `pnpm test` passes.
3. **Move `floorContainers`, `deskClickZones`, `buildFloor`** into `FloorLayer`. Keep `OfficeScene.applyProjects` calling `this.floorLayer.applyProjects(...)`. Verify `pnpm test` passes.
4. **Move `refreshIdleDeskIndicators`** to `FloorLayer` and switch the call sites in `SpriteLayer.applyPlacements` to pass the occupied-keys set up via the scene. Verify `pnpm test` passes.
5. **Trim `OfficeScene.ts`** of unused imports and dead helpers. Confirm line count target (~200). Verify `pnpm test` passes.
6. **Verify Office tab visually** in the dev server: project list loads, sprites appear, walk between desks animates, click opens detail panel, floor navigation works on both keyboard arrows and stair-image clicks.

If any step fails tests or visual verification, fix before moving on. Do not
batch fixes across multiple steps.

---

## 5. Test surface

### Unit tests (`apps/web/src/components/office/slice.test.ts`)

- 27 existing tests cover `agent-positions`, `layout`, `pathfinding`,
  `state-to-role`, `state-indicators`. None of these libs change in Phase 1,
  so the test file should not need edits. If imports break, fix imports only.

### E2E tests

- `apps/web/e2e/pipeline/office-click-through.spec.ts` — CI assertion that
  the office click-through (sprite → DeskDetailPanel → DetailPage link)
  works. **Must remain green.**
- `apps/web/e2e/pipeline/office-screenshots.spec.ts` — opt-in via
  `RUN_SCREENSHOTS=1`. Useful for manual visual diff if you want to confirm
  the refactor produces identical output. Not required for CI green.

### Manual verification checklist

Before opening the PR, in the dev server:

- [ ] Office tab loads at `/projects/:slug/office` with no console errors.
- [ ] Projects list renders as stacked floors (multi-floor preserved).
- [ ] Sprites appear at the correct desks for current work item state.
- [ ] State transition → sprite walks to new desk (trigger by manually
      changing an issue's `factory:*` label or via the SSE event stream).
- [ ] Idle desks show coffee indicator; populated desks hide it.
- [ ] Sprite click opens `DeskDetailPanel`; "Open full detail" link routes
      correctly.
- [ ] Floor navigation via keyboard ArrowUp/Down and via stair-image click
      both work and emit `floor-change`.
- [ ] FloorIndicator (top-right) shows current floor + project name.
- [ ] Resize the browser — canvas re-fits the container; no layout jumps.

If a behaviour differs from pre-refactor, that's a refactor bug. Fix it
rather than ratify it in tests.

---

## 6. Commit & PR shape

**Branch:** create a new branch from `claude/milestone-17-setup-BRII1`
(this branch holds the spec + plan). Suggested name:
`claude/office-phase-1-layer-split`.

**Commits:** Prefer one commit per step in §4. Acceptable to squash steps
1+2 (stubs + sprite move) and 3+4 (floor move + idle-indicator wiring)
if the working tree is in green state at each boundary.

**PR title:** `Office Phase 1: split OfficeScene into FloorLayer + SpriteLayer`

**PR body must include:**

- Link to the operational model: `docs/office-mode-operational-model.md`
- Link to the current-impl summary: `docs/office-mode-current-implementation.md`
- Link to this plan: `docs/design/office-mode/vertical-slice-v1/phase-1-pure-refactor.md`
- Link to the spec: `docs/design/office-mode/goose-hub-office-mode-design-pack/02-canonical-project-floor/design-spec.md`
- Acceptance checklist from §7 below.
- Explicit "no behaviour change" claim with manual verification ticks.

**Per the slice plan ownership invariant (spec §1.5):** the refactor must
not introduce any state mutation paths from the scene back to workflow
state. The current code doesn't have any, so this is verification, not work.

---

## 7. Acceptance criteria

The PR is mergeable if and only if:

- [ ] `pnpm test` passes (Vitest, 27 unit tests).
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` passes (Biome).
- [ ] `office-click-through.spec.ts` passes in CI.
- [ ] `OfficeScene.ts` is ≤ 250 lines (target ~200).
- [ ] `FloorLayer.ts` exists at `apps/web/src/components/office/game/layers/`.
- [ ] `SpriteLayer.ts` exists at `apps/web/src/components/office/game/layers/`.
- [ ] No imports of `Phaser` outside `game/` (i.e. layers don't leak Phaser into `lib/` or `components/`).
- [ ] No imports between `FloorLayer` and `SpriteLayer` directly — both depend only on the scene + emitter.
- [ ] React mount (`OfficeGameMount.tsx`) is unchanged or limited to type-import path adjustments.
- [ ] Manual verification checklist in §5 all ticked.
- [ ] No new tests added (this is a refactor); no tests removed.
- [ ] No new dependencies in `apps/web/package.json`.

---

## 8. Risks & mitigations

- **Tween reference loss on layer move.** `walkTween` lives on `SpriteEntry`. Make sure the `tweens.chain` call in `SpriteLayer.walk` runs against `this.scene.tweens`, not a stale reference. Test by triggering a sprite walk and verifying no console error.
- **Emitter ordering.** `OfficeGameMount` subscribes to `scene.events_()` on `'ready'`. If layer construction moves into `create()`, ensure the layers are constructed *before* the `'ready'` emit so click handlers attached by React are already wired when the first `applyProjects` lands.
- **Desk click-zone vs sprite click handler precedence.** Today the per-sprite `pointerdown` calls `evt.stopPropagation()` so the zone underneath doesn't fire twice (`OfficeScene.ts:370`). Preserve this in `SpriteLayer.spawn`. Cover with a manual click on a desk with a sprite — only one DeskDetailPanel should open.
- **Test isolation.** `slice.test.ts` mocks Phaser. The unit tests don't exercise the scene or layers directly — they cover only the pure libs. If a test starts importing layer code, that's a sign you've over-tested at the wrong layer.
- **Dev-only `window.__officeScene` debug hook** (`OfficeGameMount.tsx:91`). Preserve it. E2E tests rely on it for click-through assertions when Phaser hit-testing fails through synthetic events.

---

## 9. What happens after Phase 1

Phase 2 (next session, after Phase 1 PR merges):

- Author `lib/rooms.ts` from the spec.
- Rename `FloorLayer` → `RoomLayer`; replace 10-desk-per-floor geometry with
  the 6-room single-floor anchor table.
- Switch `OfficeScene.applyProjects` to accept a single project per §12.7.
- Update `OfficeTab` to pick `activeProject` and pass exactly one.
- Update `lib/agent-positions.ts` to derive `{ personas, tickets }`.
- Split `SpriteLayer` → `PersonaLayer` + `TicketLayer`.

Phase 3:

- Add SSE event-direct subscription in `OfficeTab`.
- Add `ChoreographyPlayer` + `Timeline` types.
- Implement `walkToRoom` choreography (replaces the M17 walk).

Phase 4+:

- `qaFailed`, `investigationWave`, `reviewConverged`, `mergeCelebration`
  cinematics, one per phase.

This plan only covers Phase 1.
