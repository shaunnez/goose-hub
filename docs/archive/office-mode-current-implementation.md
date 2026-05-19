# Goose Hub Office Mode — Current Implementation Summary

What actually exists in `apps/web/src/components/office/` as of commit `c7d48e8`. No future architecture, no aspirational claims — just the runtime as it sits.

---

## 1. Current Scene Structure

**Scenes**: One. `OfficeScene` extends `Phaser.Scene`. Single `Phaser.Game` per mount, created in `OfficeGameMount.tsx`. No scene swaps, no parallel scenes.

**Cameras**: One — `this.cameras.main`. RESIZE scale mode (`Phaser.Scale.RESIZE`), `pixelArt: true`, `banner: false`. Camera bounds: `(0, 0, FLOOR_PIXEL_WIDTH, worldH)` — vertical-only scroll. No secondary cameras, no minimap, no HUD camera.

**Layers**: None explicit. Phaser's default render order is used; floor containers are added in floor-index order. Within a floor container: tiles → wall row → banner → desks → idle indicators → click zones → stairs. Sprites are *not* parented to floor containers — they live as top-level children of the scene, positioned in world coordinates.

**Containers**:
- `floorContainers: Phaser.GameObjects.Container[]` — one per project, holds all decorative + interactive objects for that floor. Owned by the scene; destroyed on `applyProjects`.
- Per-sprite ad-hoc `Phaser.GameObjects.Container` — holds body image + indicator image. Lives in `SpriteEntry.container`. Owned by the `sprites` Map.

**Tilemaps**: None. Floor tiles are individual `add.image()` calls in a 30×12 loop (`FLOOR_PIXEL_WIDTH / TILE_SIZE` × `FLOOR_PIXEL_HEIGHT / TILE_SIZE`). Two alternating tile keys (`floorTile` / `floorTileAlt`) for a checkered look. No `Phaser.Tilemaps.Tilemap` usage.

**Rendering strategy**: Phaser auto / WebGL with software fallback. `pixelArt: true` disables anti-aliasing. Procedural textures generated once via `ensureOfficeTextures()` in `game/textures.ts`; PixelLab PNGs replace them when probed successfully. Constants: `TILE_SIZE = 16`, `FLOOR_PIXEL_WIDTH = 480` (30 tiles), `FLOOR_PIXEL_HEIGHT = 192` (12 tiles), `FLOOR_GAP_PX = 32`.

---

## 2. Entity Model

What runtime entities exist:

### Floor (per project)
- **Ownership**: `floorContainers[]` on the scene.
- **Lifecycle**: created in `buildFloor()` during `applyProjects()`. Destroyed wholesale on the next `applyProjects()` call. No partial updates.
- **Update loop**: none — static once built.
- **Rendering**: a `Phaser.GameObjects.Container` containing: floor tiles, top wall row, project banner (`Phaser.GameObjects.Text`, JetBrains Mono fallback), 10 desks (images), 10 idle indicators (coffee cups), 10 desk click zones, 1 stairs image.

### Desk (per role per floor)
- 10 per floor, one per `OFFICE_ROLES` entry. Static. No "occupied" state on the desk itself — occupancy is derived from sprite presence.
- Positioned by `deskPositions(floorIndex)` in `lib/layout.ts`: `slotWidth = FLOOR_PIXEL_WIDTH / 10`, `deskRowY = floorOriginY + 0.66 × FLOOR_PIXEL_HEIGHT`.

### Idle indicator (coffee cup)
- One per desk. `Phaser.GameObjects.Image` with `kind: 'idle-indicator'`, `floorIndex`, `role` set via `setData()`.
- Visibility toggled by `refreshIdleDeskIndicators()` based on the live sprite map.

### Desk click zone
- `Phaser.GameObjects.Zone` covering `3 × 4` tiles centered on the desk. Interactive. `pointerdown` → `handleDeskClick(floorIndex, role)`.
- Indexed in `deskClickZones: Map<"floorIndex:role", Zone>`.

### Stairs
- One per floor. `Phaser.GameObjects.Image` on the right edge. Interactive. `pointerdown` → `navigateFloor(±1)`.

### Sprite (per active work item)
- `SpriteEntry { workItemId, externalId, projectSlug, role, floorIndex, container, body, indicator, walkTween? }`.
- **Ownership**: `sprites: Map<spriteId, SpriteEntry>` keyed by `"projectSlug:externalId"`.
- **Lifecycle**: spawned by `spawnSprite()` when a placement appears for the first time. Walked by `walkSprite()` when its role or floor changes. Updated by `updateIndicator()` when only the indicator changes. Destroyed by `applyPlacements()` cleanup loop when the placement disappears.
- **Update loop**: only on `applyPlacements()` (React effect on prop change). No per-frame update.
- **Rendering**: container at desk anchor, with body image (`spriteTextureKeyForRole`) and indicator image (`indicatorTextureKey`). Container is interactive — its own `pointerdown` emits `desk-click` with the specific work-item id.

### "Banner" / "wall" / "floor tile" / "indicator"
- All flat images, no behaviour.

**Not present**: rooms, queues, in-trays, props, plants, weather, ambient NPCs, persona codename labels, work-package tethers, scroll/envelope artifacts, watchtower, corkboard.

---

## 3. State Management

Three coexisting state stores:

### React (TanStack Query + useState) — in `OfficeTab.tsx`
- `useQuery(['projects'])` for project list.
- `useQuery(['issues', slug])` per project, multiplexed across all known projects.
- `useState`: `activeSlug`, `floorIndex`, `deskPayload`.
- `useMemo` for `placements = placementsFromItems(allItems)`.
- `useMemo` for `officeProjects = projects.map(...)`.

### Phaser scene-local state — in `OfficeScene.ts`
- `projects: OfficeProject[]`
- `placements: AgentPlacement[]`
- `sprites: Map<string, SpriteEntry>`
- `deskClickZones: Map<string, Zone>`
- `floorContainers: Container[]`
- `currentFloorIndex: number`
- `verifiedAssets: VerifiedAsset[]` (PNG manifest probed at boot)

### Phaser emitter — `this.emitter = new Phaser.Events.EventEmitter()`
- Used for scene→React events: `'ready'`, `'desk-click'`, `'floor-change'`.
- React side subscribes via `scene.events_()`.

**No ECS, no Redux, no Zustand, no MobX, no derived render store.** The only "derived render state" is `placements` (pure function of work items) computed in React and pushed down imperatively.

**Direct sprite mutation**: yes. Walks tween `entry.container.x/y`; indicator swaps via `entry.indicator.setTexture()`; visibility toggled via `setVisible()`. No declarative diffing inside the scene — `applyPlacements` does the diffing itself by comparing the incoming placement list to the existing `sprites` Map.

---

## 4. Event Flow

How orchestration events reach Phaser today:

1. **Ingestion**: `OfficeTab.tsx:92` opens `new EventSource('/events')`. The handler listens to a small whitelist of event types (`state.transitioned`, `agent.run-completed`, etc.) and on each one calls `queryClient.invalidateQueries(['issues', slug])` for the affected project.

2. **Mapping**: there is no direct event → animation mapping. SSE events trigger React Query invalidations; the cache refetches; the new `WorkItemDto[]` flows through `placementsFromItems()` → `placements` → prop → `applyPlacements()` effect.

3. **Dispatch**: in `OfficeScene.applyPlacements()`. For each incoming placement, the scene looks up the existing sprite by `spriteId` and picks one of: spawn (new), walk (role or floor changed), update-indicator-only (same role, indicator changed), stay-put (role: null, blocked state). Sprites no longer in the placement list are destroyed.

4. **Animation triggering**: the walk tween is the only animation actually fired by event-equivalent input. Spawn / update / destroy are instant. There is no animation queue, no delay, no choreography.

5. **Timing**: entirely synchronous within one React render cycle. SSE event → query invalidation → fetch → React re-render → useEffect → `applyPlacements()` → all sprite changes in one tick. No frame-based queuing, no easing on indicator swaps. Camera pans are the only timed thing (400ms cubic).

**No backpressure, no event ordering, no event coalescing.** A burst of state transitions will trigger a burst of refetches, which will produce a single "latest snapshot" applyPlacements call.

---

## 5. Animation System

What's actually implemented:

- **Walks**: `walkSprite()` builds a chained tween via `tweens.chain({ tweens: [...] })`. Inputs come from `planWalk()` in `lib/pathfinding.ts`, which returns a list of waypoints. Speed is `WALK_PIXELS_PER_MS = 0.35` (so a one-floor walk of ~480px takes ~1.4s). Direction inferred via `facingFromMovement()` which flips `body.flipX`.
- **Floor camera pan**: `cameras.main.pan(centerX, floorCenterY, 400, Cubic.InOut)` in `panToFloor()`.
- **Snap (initial position)**: `cameras.main.centerOn()` — instant.
- **Indicator swap**: `entry.indicator.setTexture(indicatorTextureKey(p.indicator))` — instant, no fade.
- **Multi-sprite stack offset**: `restackSpritesAtSharedDesks()` repositions multiple sprites at the same desk by setting `container.x` directly. No tween.

**Not present**:
- Sprite sheets (single static frame per role).
- Walk cycle animation (no leg movement; the sprite slides).
- Idle / talking / working animation states.
- State-machine-driven animation graph.
- Particle systems.
- Tween easing on indicator swaps.
- Coordinated cinematic sequences (e.g. "spawn → walk → wave →...").

---

## 6. Current Zoom / Camera Model

- **Zoom**: none. `cameras.main.zoom` is the Phaser default (1.0); never changed.
- **Scale mode**: `Phaser.Scale.RESIZE` — canvas fills its container; world units stay 1:1 with screen pixels.
- **Bounds**: `(0, 0, FLOOR_PIXEL_WIDTH=480, worldH)` where `worldH = floorCount × 192 + (floorCount−1) × 32`. Camera can scroll vertically across floors; cannot scroll horizontally beyond one floor width.
- **Navigation**: keyboard ArrowUp/Down → `navigateFloor(±1)` → `panToFloor()`. Programmatic `panToProject(slug)` available on the scene.
- **No LOD**: every sprite renders at full detail at every floor position.
- **Resize**: `scene.scale.on('resize', this.handleResize)` is wired but the handler is a no-op in the current code — the camera doesn't re-center on resize.

---

## 7. Current UI / HUD Structure

All HUD lives in **React**, layered over the `<div data-testid="office-canvas">` via CSS positioning.

- **FloorIndicator** (`components/FloorIndicator.tsx`): `position: absolute`, top-right of the office tab. Shows `floorIndex+1 / totalFloors`, project name, two arrow buttons (Up / Down). Wired to React `floorIndex` state, which is updated by the scene's `floor-change` event.
- **DeskDetailPanel** (`components/DeskDetailPanel.tsx`): `<aside>` with `fixed top-0 right-0 z-40 h-full w-[320px]`. Renders when `deskPayload != null`. Contains: issue number, title, generic description, "Open full detail →" link (routes to `/projects/<slug>/items/<n>`). Close via X button or backdrop click. Escape via window listener — works in real browser, captured by Phaser keyboard manager in canvas-focused tests.
- **"No projects" empty state**: a centered message when `projects.length === 0`.
- **Suspense fallback**: "Loading office…" while the lazy chunk loads.

**Inside the Phaser canvas**, the only "HUD-like" elements are the project banner (`Phaser.GameObjects.Text`) on each floor — that's it. No score panel, no event log, no per-sprite tooltip, no minimap.

The React HUD layer does **not** know what Phaser is currently doing; it only knows what's in React state (`floorIndex`, `deskPayload`). Bridging happens through the scene's emitter.

---

## 8. Technical Constraints (problems / limitations)

What's actually broken or limiting in the current code:

- **Destructive `applyProjects`**: rebuilds every floor container + destroys every sprite + clears every click zone. Triggered any time the projects array changes. Made fragile during M17 work — fixed once for the floor-nav rebuild, but the destructive primitive remains.
- **Canvas hit-testing through Playwright**: synthetic mouse events don't reliably hit Phaser interactive objects. Worked around with a dev-only `window.__officeScene` debug hook (`import.meta.env.DEV` gated).
- **Phaser captures Escape**: when the canvas has focus, Phaser's keyboard manager catches Escape before the window listener runs. The DeskDetailPanel's Esc-to-close works in real-browser usage but not in tests with the canvas focused.
- **Asset probe vs SPA fallback**: HEAD requests against `/office/*.png` get 200 + `text/html` from Vite's catch-all. Probe must verify `content-type: image/*` or Phaser tries to decode HTML as PNG.
- **No event-level subscription**: Phaser only updates on React re-render. A high-frequency event burst (tool-call events) would not show as ambient motion — only the final placement diff would render.
- **No persona rendering**: a "developer" desk shows one generic sprite even when three persona instances are doing different runs. Codenames are not surfaced. Persona round-robin is invisible.
- **One sprite frame per role**: no idle / walking / working / talking distinction. Walking sprites slide.
- **No queue representation**: a project with 100 issues across 30 in-flight + 70 queued shows 30 sprites and nothing for the 70. No in-tray, no badge, no count.
- **No zoom / LOD**: at ~50+ sprites per floor, the visual collapses into a row of overlapping figures.
- **State drift potential**: `scene.currentFloorIndex` and React `floorIndex` can diverge if the scene fires `floor-change` mid-walk and React's effect re-fires `panToProject`. The existing code is careful (refs, deps split), but there's no enforced invariant.
- **HUD vs canvas isolation**: the React HUD is fixed-position over the canvas; the canvas doesn't know how much space the HUD is consuming. Causes minor layout issues at narrow widths.
- **Banner text uses system font fallback**: `'JetBrains Mono, monospace'` — falls back to whatever the system has. No web-font loading.
- **Phaser bundle size**: 1.6MB raw / 380KB gzip. Now lazy-loaded via React.lazy in `OfficeTab.tsx`, but the chunk is still large.
- **No camera shake / flash / cinematic primitives**: nothing to express "audit-gate fired" or "merge merged" beyond mounting/unmounting React HUD elements.
- **`refreshIdleDeskIndicators` walks every floor container's children** to find idle indicators. O(floors × children) per applyPlacements call. Fine at current scale, not at 50+ projects.

---

## 9. Current Strengths

What's worth keeping:

- **Clean React ↔ Phaser boundary**: React owns the data; pushes via `applyProjects` / `applyPlacements` / `panToProject`. Phaser pushes events back via a dedicated emitter. No leaky abstractions.
- **Stable `spriteId` keying**: `"projectSlug:externalId"` survives state transitions, persona changes, and re-renders. The diff in `applyPlacements` is robust against partial updates.
- **Pure-logic libraries**: `lib/agent-positions.ts`, `lib/layout.ts`, `lib/pathfinding.ts`, `lib/state-indicators.ts`, `lib/state-to-role.ts` are all pure functions, fully covered by `slice.test.ts` (28 unit tests). The scene can be reasoned about independently of the geometry.
- **Stay-put placement contract**: `role: null` in `AgentPlacement` preserves the sprite at its current desk and only swaps the indicator. Encodes the "blocked but alive" semantics cleanly.
- **Per-sprite click handlers**: each sprite is independently hit-testable. Multiple sprites at the same desk (rare today, common in the future) are reachable via the dev hook *or* per-sprite pointerdown.
- **Texture probe + procedural fallback**: works with zero external assets; upgrades transparently when PixelLab PNGs are dropped into `/public/office/`.
- **Lazy-loaded Phaser chunk**: initial bundle dropped from 2.4MB → 743KB; Office tab pays its own cost.
- **Dev-only debug hook**: `window.__officeScene` enables e2e + manual debugging without polluting prod.
- **State-machine + indicator mapping isolated**: `deskForState()` and `indicatorForState()` are the single source of truth for "where does this work item live and what does it show?" — both pure, both swappable.
- **E2E coverage**: M17.05 click-through (`office-click-through.spec.ts`) runs in CI; screenshot demo gated behind `RUN_SCREENSHOTS=1`.
- **Path-planning module**: `planWalk()` returns waypoint lists with elevation-aware transitions for cross-floor walks. Currently underused (no cross-floor walks happen yet), but the contract is correct.

---

## 10. Current Weaknesses

Where the existing code does not — and likely cannot — support the canonical Office Mode design without refactor:

- **One-goose-per-role**: data layer treats personas correctly (round-robin stored in `personaRouting`); rendering layer collapses them. The scene needs per-persona sprites.
- **No room concept**: 10 desks in a row per floor. Adjacent states share no spatial proximity. Walks are along a straight line.
- **No layering / z-order control**: everything in the floor container renders at the same z-level. Adding rooms, walls, doors, props requires explicit layer management that doesn't exist yet.
- **No animation states**: walks slide; sprites have one frame. The TDD heartbeat (RED → GREEN → REFACTOR) has no current visual surface. DecisionKind glyphs not rendered.
- **No swarm primitives**: there is no "wave" abstraction, no flock formation, no fan-out animation. A Wave-1 scout burst would currently render as 6 sprites teleporting in and out — meaningless.
- **No tether / link rendering**: parallel-build work packages tethered to the same parent issue have no visual representation. Adding lines/ribbons between sprites requires either a `Phaser.GameObjects.Graphics` layer per tether or a custom render hook — neither exists.
- **No queue or in-tray**: items not currently on a desk are invisible. The kanban shows everything; the office shows ~10% of it. Aggregation primitives need to be added at the layout level.
- **No zoom modes**: a single fixed scale precludes the building / floor / room / persona zoom contract.
- **No HUD ↔ canvas event channel**: the React HUD knows React state. It doesn't know which sprite is animating, which goose is "looking at" the camera, which event just fired. Cross-layer interactions (e.g. hover sprite → highlight HUD log entry) have no plumbing.
- **No backstage / watchtower / corkboard surfaces**: the building today has only `FLOOR_PIXEL_WIDTH × worldH` of world. Adding a watchtower (top), backstage (basement / side), lobby (ground) requires expanding world bounds and rethinking the single-vertical-axis camera model.
- **No holdout sealing**: the QA / Review / Library rooms are just desks like any other. The frosted-glass / envelope / verdict-scroll metaphor has no current implementation hook.
- **No event-direct subscription**: the scene reacts to placement diffs, not to events. A cinematic "merged!" moment can't fire today because the merge event is consumed by React Query, not by the scene.
- **Floor-container rebuild on project change**: any change to the project list teardown-rebuilds the entire scene. Adding ambient persistent decorations (a janitor goose, plants, a coffee machine) requires either making those decorations re-buildable or shifting them out of floor containers.
- **No ambient layer**: there is no concept of "background motion that doesn't represent a work item." All sprites are 1:1 with placements.
- **No camera anchors**: room-zoom and persona-zoom need named camera positions per floor. The scene has only `floorIndex → centerY` mapping; no x-axis anchors, no zoom presets.

---

## Summary

The M17 implementation is a **solid, well-typed, well-tested kanban-state visualizer with a Phaser canvas and procedural pixel-art primitives**. It correctly renders the *current state* of work items at the *role abstraction* level, with diff-based sprite management and a clean React boundary.

It is **not** a simulation. There is no time, no ambient motion, no choreography, no animation graph, no zoom, no room geography, no persona identity, no swarm primitives, no event-level cinematic surface. Most of the canonical Office Mode model would require new code rather than refactor — but the layout / pathfinding / placement libraries, the state→role mapping, and the React-Phaser boundary are strong enough to keep and extend rather than rewrite.
