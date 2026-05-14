# components/office

Goose Mode skin: a pixel-art top-down view of every project as a stacked office, with one floor per project and one desk per role. Lives next to the Kanban as a glanceable view of agent activity. Closes M17.01 (#351), M17.02 (#352), M17.03 (#353), M17.04 (#356), M17.05 (#355), M17.06 (#354).

Mounted at `/projects/:slug/office`. Sidebar entry "Office" between Kanban and Inbox.

## Files

- `components/OfficePage.tsx` — AppShell wrapper; route entry.
- `components/OfficeTab.tsx` — data + SSE host. Loads projects + per-project issues, derives `AgentPlacement[]`, renders the canvas + floor indicator + click-through panel.
- `components/OfficeGameMount.tsx` — React ↔ Phaser bridge. Boots `Phaser.Game` once per mount; pushes prop diffs into the scene; surfaces scene events back to React via callbacks.
- `components/FloorIndicator.tsx` — out-of-canvas DOM overlay (floor number, project name, up/down buttons).
- `components/DeskDetailPanel.tsx` — slide-in panel that opens when a desk is clicked. Links out to the full DetailPage.
- `game/OfficeScene.ts` — the only Phaser scene. Owns the floors, desks, sprites, indicators, walks, click zones, stair navigation, camera pans.
- `game/textures.ts` — canonical colour registry (`PALETTE` 13 entries, `ROLE_TINTS` 12 entries, `CINEMATIC_TINTS` 8 entries, `HUD_TINTS` 8 entries) plus `TEXTURE_KEYS` (20 entries) and procedural pixel-art fallback generators (16×16 tiles, 32×24 desks, 12×16 sprites, 14×14–14×16 indicators). All colours derived from the 28-code Board 06 visual system.
- `game/asset-loader.ts` — optional preload of `/office/<key>.png` files via `pngManifest()` (20 entries, exported); missing files are silently ignored so procedural textures take over.
- `lib/state-to-role.ts` — `factory:*` state → role-desk mapping; `shouldWalk()` predicate.
- `lib/state-indicators.ts` — `factory:*` state → indicator glyph (speech / thought / question / coffee / bang / check).
- `lib/layout.ts` — pure floor/desk/stairs world-coordinate math. Tiles are 16 px; floors are 30 × 12 tiles.
- `lib/pathfinding.ts` — same-floor and cross-floor (via stairs) waypoint paths. `pathLength()` scales tween duration; `facingFromMovement()` flips the sprite.
- `lib/agent-positions.ts` — derives one `AgentPlacement` per active issue from `WorkItemDto[]`.
- `slice.test.ts` — unit tests covering all pure logic including Phase 2.5 visual-canon assertions. Phaser scene + React mount are exercised by Playwright e2e.

## Data flow

```
fetchProjects() ──┐
                  ├─► OfficeTab derives AgentPlacement[]
fetchIssues(...)──┘                │
                                   ▼
                          OfficeGameMount.applyPlacements()
                                   │
                                   ▼
                          OfficeScene.applyPlacements()
                          ├─► spawn new sprite at desk
                          ├─► walk existing sprite (state changed desks)
                          └─► swap indicator (state changed within desk)

EventSource('/events')
  state.transitioned ──► invalidateQueries(['office-issues'])
                          (placements re-derive on next render)

OfficeScene.emitter
  desk-click   ──► OfficeTab opens DeskDetailPanel
  floor-change ──► OfficeTab updates FloorIndicator + activeSlug
```

## State → desk mapping

| factory:* states                                                                             | desk         |
| -------------------------------------------------------------------------------------------- | ------------ |
| triaging, accepted                                                                           | triager      |
| grilling                                                                                     | griller      |
| prd-drafting, prd-review                                                                     | prd-writer   |
| decomposing, issues-created                                                                  | decomposer   |
| research-pending, research-complete                                                          | researcher   |
| investigating, investigation-complete                                                        | investigator |
| dev-ready, spec-ready, in-progress, needs-fix, qa-failed                                     | developer    |
| needs-qa                                                                                     | qa           |
| needs-review, approved, merge-conflict                                                       | reviewer     |
| retrospecting                                                                                | retrospector |
| done, archived, rejected, needs-human, gate-pending                                          | (no walk)    |

`needs-human` and `gate-pending` keep the sprite at its current desk and only swap the indicator (`!` and `?` respectively) — that's the "blocked" signal.

## Pixel art assets

The repo ships **zero** binary assets. The Phaser scene generates everything procedurally at boot via `Graphics.generateTexture()` so a fresh checkout works immediately.

To upgrade visual quality with PixelLab:

1. Get an API key at <https://api.pixellab.ai/mcp>.
2. Set `PIXELLAB_API_KEY=<key>` in `.env` (already gitignored at the repo root).
3. Run `pnpm gen:office-assets`. PNGs land in `apps/web/public/office/` (also gitignored — they're regenerable).
4. Reload the Office tab — the scene's preload pulls PNGs from `/office/<key>.png` and skips the procedural fallback for any key that loaded successfully.

The 20-asset manifest (`MANIFEST`, exported) is in `scripts/generate-office-assets.ts`. Every prompt references at least one Board 06 hex code. Edit prompts there if you want a different style. The 3 Phase 2.5 additions are `wall-frosted-blue.png`, `wall-frosted-grey.png`, and `scout-desk.png`.

## Phaser version

We use Phaser 4.x (installed at `apps/web/package.json`). The scene uses standard `Phaser.GameObjects.Image`, `Phaser.GameObjects.Container`, `Phaser.Tweens.chain`, and `Phaser.Cameras.Scene2D.Camera.pan()` — all stable across 3.x → 4.x. If you downgrade, only `tweens.chain` API needs review.

## Performance notes

- Procedural textures generate once per scene boot; subsequent renders reuse the texture cache.
- `applyPlacements` does naive diffing (Map keyed on `spriteId`); fine up to a few hundred concurrent issues. Beyond that, batch in chunks.
- One Phaser instance per page mount. The instance is reused across React re-renders; only data flows in via prop effects.
- Tab switch (Kanban ↔ Office) currently rebuilds the Phaser game. Preserving the instance across route changes would require lifting the mount above the router (out of scope for M17).

## What's intentionally not here

- No mobile layout — the canvas is desktop-first.
- No sound or music.
- No persona-history overlays — that's the Roster's job.
- No drag-to-rearrange desks — desk positions are deterministic from `OFFICE_ROLES`.
