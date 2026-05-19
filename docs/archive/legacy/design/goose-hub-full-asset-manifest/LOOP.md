
# Goose Hub Asset Generation Loop — single iteration

You are running ONE iteration of an asset generation loop. **Your context is cleared after this turn — assume zero prior knowledge.** Everything you need is in this file and the three siblings beside it.

## Goal

Generate, register, and validate the next batch of 4 pixel-art assets for Goose Hub Office Mode. Commit + push. End the turn. The loop will fire the next iteration.

## Inputs to read first

1. `docs/design/goose-hub-full-asset-manifest/opus-loop-prompt.md` — overall directive.
2. `docs/design/goose-hub-full-asset-manifest/prompt-pack.md` — global style + per-type prompts (Tile / Wall / Desk / Goose / Ticket / HUD / Effect).
3. `docs/design/goose-hub-full-asset-manifest/asset-manifest.md` — the ledger. Source of truth for progress.
4. `docs/design/goose-hub-full-asset-manifest/README.md` — pipeline order and target resolutions.

Do NOT redesign the manifest, prompt-pack, or office layout.

## Hard constraints

- One commit per iteration.
- No PRs.
- Only Phaser-compatible, pixel-perfect, 16x16-tile-aligned outputs.
- Only the Board 06 canonical palette — see `BOARD06_HEX` in `apps/web/src/components/office/slice.test.ts:1391`. Prompts that introduce non-canonical hex codes are forbidden.
- Do NOT modify governance files (`MISSION.md`, `FACTORY_RULES.md`, `CLAUDE.md`, `target-projects/*/project.config.ts`, `target-projects/*/personas/`).
- Do NOT touch the Phaser scene logic (anything in `apps/web/src/components/office/game/` other than `asset-loader.ts`). Scene composition is a deliberate later pass — not your job.
- Skip `## 10 — Optional Later Assets (DEFERRED)` in `asset-manifest.md`.
- Skip entries marked `- [!]` (previously failed; only a manual rerun pass flips them back).
- Skip entries marked `- [x]` (already done).

## Pre-populated state you can rely on

- All 122 non-deferred assets already have a `MANIFEST` entry in `scripts/generate-office-assets.ts` under the export `ASSET_MANIFEST`. **Do not edit `ASSET_MANIFEST`** — the prompts and sizes are fixed. Your only job is to run the generator for the chosen filenames.
- `PIXELLAB_API_KEY` is in `.env` (gitignored). The generator reads it automatically.
- The Playwright validator `apps/web/e2e/pipeline/office-texture-load.spec.ts` exists and runs against the pipeline mock harness (`MOCK_AGENTS=true` etc).

## Iteration steps

### 1. Pick the batch (4 assets)

Read `asset-manifest.md`. Find the first 4 entries marked `- [ ]`, preferring all within the same `###` subsection so the commit is coherent. If there are fewer than 4 left in the subsection, fill from the next subsection (do not cross section `## 10`).

If zero `- [ ]` entries remain pre-section-10: stop. Write a single console message "Asset manifest complete." and end the turn — no commit, no push.

### 2. Register the texture keys in the loader

Edit `apps/web/src/components/office/game/asset-loader.ts`. For each of the 4 filenames, append one entry to the `pngManifest()` return array, in the same style as the existing entries. Use a raw `office:<filename-without-extension>` key. Example for `floor_tile_01.png`:

```ts
{ key: 'office:floor_tile_01', url: `${ASSET_BASE}/floor_tile_01.png` },
```

Group new entries with a comment marking the manifest section (e.g. `// 01 — Core Tiles / Floors`). Keep the legacy block intact at the top.

### 3. Generate the PNGs

Run from the repo root:

```
pnpm gen:office-assets <file1> <file2> <file3> <file4>
```

The script:
- Has `--force` flag if you need to overwrite an existing PNG (rare — only use it during manual `- [!]` recovery, not normal iteration).
- Runs requests with concurrency=4 against `api.pixellab.ai/v1/generate-image-pixflux`.
- Writes PNGs to `apps/web/public/office/<filename>`.
- Exits non-zero if any generation failed.

### 4. Verify outputs

For each of the 4 files, check that `apps/web/public/office/<filename>` exists and is `> 0` bytes.

- For files that pass: flip the matching `- [ ]` to `- [x]` in `asset-manifest.md`.
- For files that fail (missing, 0 bytes, or generator returned non-zero for them): flip to `- [!]`, and **revert the corresponding entry you added to `pngManifest()` in step 2**. Leave a brief stderr-style note in the commit body listing failures.

### 5. Sanity checks

```
pnpm lint
pnpm --filter @goose-hub/web test -- slice.test.ts
```

If either fails because of your `pngManifest()` edit: revert your `pngManifest()` edits for this batch, mark the affected entries `- [!]` in `asset-manifest.md`, and continue to commit (progress markers are still valuable).

If lint/test fail for unrelated reasons (e.g. someone else broke the build): stop. End turn with the failure noted in stdout. Do NOT commit.

### 6. Playwright validation

Run:

```
pnpm --filter @goose-hub/web exec playwright test \
  --config playwright-e2e-pipeline.config.ts office-texture-load.spec.ts
```

The test asserts every `pngManifest()` entry whose PNG file exists on disk has been loaded into Phaser's texture cache by key. It also fails on Phaser console-load errors. A screenshot lands in `apps/web/test-results/office-texture-load/`.

If it fails:
- For each `office:<filename>` key reported missing: flip the manifest checkbox to `- [!]`, revert the `pngManifest()` entry.
- Re-run the test to confirm the rollback unblocks it.
- Still commit (so the manifest marker progresses).

### 7. Commit + push

```
git add docs/design/goose-hub-full-asset-manifest/asset-manifest.md \
        apps/web/src/components/office/game/asset-loader.ts \
        apps/web/public/office/
git commit -m "office-assets: <section> — <file1>, <file2>, <file3>, <file4>"
git push -u origin claude/milestone-17-setup-brii1-VZQiR
```

If push fails on network error, retry up to 4 times with exponential backoff (2s, 4s, 8s, 16s).

### 8. End the turn

Print a one-line summary: "Generated N of 4. Manifest progress: X/122." Then stop. The loop fires the next iteration.

## Failure recovery — manual

If you (the human reviewing) see `- [!]` entries piling up, they're failures kept for later. To retry: flip `- [!]` back to `- [ ]` in `asset-manifest.md`, ensure the `pngManifest()` entry is absent, and let the next loop iteration pick it up.
