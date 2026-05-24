# Handoff — 1021–1023 Failure Cascade: delivery vs plan

**Plan:** [`docs/cost-performance-improvements/1021-1023-failure-cascade-plan.md`](docs/cost-performance-improvements/1021-1023-failure-cascade-plan.md)
**Status:** All three goals (G1/G2/G3) shipped and merged to `main`. Integration test merged.

This doc maps every plan goal/task/AC to the delivered code so a reviewer can audit the work against the plan rather than re-reading diffs cold.

## PRs that delivered the plan

| Plan PR | Title | Tasks | GitHub | Merged? |
|---|---|---|---|---|
| PR A — G1 | M20.10: fix codex resources/read converter + demote blocking pattern | 1,2,3 | [#1028](https://github.com/shaunnez/goose-hub/pull/1028) | yes (`f83fb108`) |
| PR B — G2 | M20.11: ground spec-author with existing-file manifest + per-file check | 4,5,6 | [#1029](https://github.com/shaunnez/goose-hub/pull/1029) | yes (`484b7709`) |
| PR C — G3 | M20.12: forward priorEvidenceSpecPath through fix-feedback | 7 | [#1030](https://github.com/shaunnez/goose-hub/pull/1030) | yes (`a845a344`) |
| (extra) | M19.XX: test: add integration test exercising G1+G2+G3 | cross-cutting test | [#1033](https://github.com/shaunnez/goose-hub/pull/1033) | yes (`2d3eaab7`) |

`main` tip = `2d3eaab7` (#1033). #1033 also re-touched G1/G3 surfaces, which collided with A/C; the conflicts were resolved at merge (see "Merge note" below).

## Goal-level verdict

| Goal | Plan intent | Delivered | Verdict |
|---|---|---|---|
| **G1** | `resources/read -32603 Invalid URL` aborts runs | Converter widened + SDK URL parsing bypassed + surface demoted to advisory | ✅ met, exceeded |
| **G2** | spec-author hallucinates file paths | Existing-file manifest injected from investigation/scout file evidence + per-file grounded check with `status:new` opt-in | ✅ met |
| **G3** | fix-feedback loses `evidenceSpecPath` across cycles | Prior `evidenceSpecPath` forwarded into repair context; emitted on completion | ✅ met |

## Task-by-task audit

### G1

**Task 1 — widen `resources/read` URI converter** ✅
`core/tool-layer/mcp/tools/resources.ts:15-26` — `uriToWorkspaceRelative` returns tagged `ResourceOp` (`{op:'read'|'exists', path}`); handles `read_file?path=`, `file_exists?path=`, `factory://`, `file://`, bare path; URL-decodes.
- **Deviation:** regex is `/^(read_file|file_exists)\?path=([^&]+)/` (stops at `&`, no `$` anchor) vs plan's `/…(.+)$/`. Tolerates trailing query params — acceptable/stronger.

**Task 2 — low-level `setRequestHandler`** ✅
`core/tool-layer/mcp/server.ts:140-151` — `resources/list` + `resources/read` (and `resources/templates/list`) registered via `server.server.setRequestHandler(...)`, owning URI parsing before SDK `new URL()`. High-level `server.resource(...)` removed.

**Task 3 — demote `resources/read failed` to advisory** ✅ (exceeded plan)
`core/agent-runtime/codex-cli.ts` — `ADVISORY_RUNTIME_SURFACE_PATTERNS` + `appendRuntimeAdvisoryEvent` emit `agent.runtime-advisory`.
- **Deviation (intentional, richer):** plan kept `BLOCKED_RUNTIME_SURFACE_PATTERNS` and added a parallel advisory emitting `{surface, source}`. Delivered version **removes the blocked-pattern machinery entirely** and emits a richer payload `{runId, skill, surface, stderr, toolName, requestedPath}`, with a broader regex matching `?path=` and `transient stderr`. `emitForbiddenRuntimeSurfaceBlocked` retained for the genuine forbidden-surface path.
- **Reviewer check:** confirm the richer payload + full removal of `BLOCKED_*` is desired over the plan's leaner shape.

### G2

**Task 4 — `collectScopeManifest`** ✅
`core/workspaces/scope-manifest.ts:20` — capped at `MANIFEST_CAP=800`, skips `.git/node_modules/.factory/dist/build/.pnpm`, rejects absolute/traversal scopeRoots outside repoRoot, returns `{path, kind}` entries. Test: `core/workspaces/scope-manifest.test.ts`.
- **Relocated from plan:** plan placed this in `skills/spec-author/manifest.ts`. It's a generic worktree walker with zero spec-author coupling, and fix-feedback (which drives `implement`, not spec-author) needs it too. Moved to `core/workspaces/` so both the spec-author skill and the fix-feedback slice import it through `core/` rather than reaching cross-domain into another skill's folder.

**Task 5 — wire manifest into spec-author context** ✅
`skills/spec-author/skill.config.ts:71` adds `existingFileManifest` + allowlist entry (`:91`). `slices/spec-author/workflow.ts:228` `deriveSpecScopeRoots`, `:425-439` collects + injects (only when non-empty). Prompt documents the contract.
- **Scope decision:** manifest roots are derived from code-bearing evidence (`investigationSynthesis.keyFiles` and scout digest `filesReferenced` / finding `file` fields). PRD vertical slices are intentionally not used because their schema carries title/goal/estimatedSize/journeyRefs, not repo paths.

**Task 6 — per-file `self-check-grounded-in-code`** ✅
`skills/spec-author/schema.ts:76` `FileOwnedEntrySchema` (string | `{path, status}`), helpers `fileOwnedPath`/`fileOwnedStatus`. `skills/spec-author/validate.ts:375-...` `GROUNDABLE_SCOPE_RE = /^(apps|core|slices|skills)\//`, `EXEMPT_SUFFIX_FOR_GROUNDING` for test/spec/config/.d.ts; errors on missing prod file unless `status:'new'`.

### G3

**Task 7 — forward `priorEvidenceSpecPath`** ✅
`slices/fix-feedback/workflow.ts:207` `findPriorEvidenceSpecPath`, `:438` computed (`?? undefined`), `:505` injected into implement context, `:521` allowlisted, `:569` `evidenceSpecPath` re-emitted on `agent.fix-feedback-complete`. Implement skill: `skills/implement/skill.config.ts:31` schema field + `:123` allowlist; `skills/implement/prompt.md:105` reuse-or-SKIP_GATE bullet.

## Integration test (#1033)

`slices/fix-feedback/slice.test.ts:611` — `it('covers the G1 G2 G3 cascade together in a fix-feedback run')` asserts in one run:
- G3: `context.priorEvidenceSpecPath` forwarded from prior `agent.implement-complete`.
- G2: `context.existingFileManifest` populated from investigation keyFiles + allowlisted.
- G1: `appendRuntimeAdvisoryEvent` produces `agent.runtime-advisory` (surface `resources/read failed`, stderr includes `?path=`), and **no** `agent.run-blocked` emitted.

`fix-feedback` now reuses the shared `core/workspaces/scope-manifest.ts` collector for its implement context manifest, so the same cap, skipped directories, and traversal guards apply outside spec-author too.

## Plan "Eval" table — measurability

The plan's post-deploy targets require live telemetry; not verifiable from code. Status:

| Metric | How to verify | Status |
|---|---|---|
| `resources/read` `status:"failed"` `Invalid URL` → 0 | event stream after next codex fix-feedback runs | ⏳ pending live runs |
| `agent.run-blocked` `blocked-runtime-surface: resources/read failed` → 0 | event stream | ⏳ pending (machinery removed — structurally 0) |
| `agent.runtime-advisory` `resources/read failed` → non-zero advisory | event stream | ⏳ pending live runs |
| spec-author grounded-in-code failures → ~0 | spec-author run outcomes | ⏳ pending live runs |
| fix-feedback contract-gate `evidenceSpecPath required` → 0 when prior spec exists | event stream | ⏳ pending live runs |

**Recommend:** after the next batch of codex-driven fix-feedback runs, query the event stream for these five and append actuals to this table.

## Verification gate (plan §"Verification across all three fixes")

Run on `main` (`2d3eaab7`) at handoff:

| Check | Result |
|---|---|
| `pnpm typecheck` | ✅ clean |
| `pnpm audit-docs` | ✅ `clean. No drift detected.` |
| `pnpm lint` | ✅ clean (run during merge resolution) |
| `pnpm test` | ✅ 4862 passed / 3 skipped (run during merge resolution) |
| `pnpm manifest --check` | ✅ `docs/inventory.md is up to date.` |

## Merge note (why #1033 conflicted)

#1033 carried its own copies of G1/G3 changes that overlapped #1028/#1030 after they landed. Resolution kept the richer G1 advisory implementation, deduped the G3 `priorEvidenceSpecPath` additions (kept the canonical `#1030` versions), and deduped duplicate `agent.runtime-advisory` event-kind registrations in `core/event-stream/kinds.ts` and `core/workflows/timeline-sections.ts`. Detail: see `git show 2d3eaab7` (the #1033 merge).

## Open items for the reviewer

1. **G1 payload shape** — confirm richer `agent.runtime-advisory` payload + full `BLOCKED_*` removal is intended (deviates from plan).
2. **Eval table** — populate with live telemetry after next codex runs.
3. **Scout-only G2 telemetry** — confirm spec-author runs with scout evidence but no investigation keyFiles now receive a useful `existingFileManifest`.
