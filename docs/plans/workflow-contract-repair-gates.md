# Workflow contract repair gates

## Goal

Add workflow-boundary checks that repair safe model-output drift and block unsafe drift before Factory transitions state.

The workflow should not fail just because a model used a repairable path shape, but it also should not open a PR, start QA, or commit WP changes when critical facts are ambiguous.

## Depends On

- Repo-relative path normalization.
- Workflow-owned observed facts packet.

## Non-goals

- Do not make every warning fatal.
- Do not retry agents automatically for all contract drift.
- Do not hide ambiguity by picking a candidate silently.

## Gate Model

Each gate classifies drift:

- `repaired`: workflow normalized or derived the correct fact.
- `warning`: mismatch exists but observed facts satisfy the workflow contract.
- `blocking`: ambiguity or missing required fact makes the next transition unsafe.

## Slices

### [x] Slice 1 - Implement output repair gate

Run a repair gate after implement output validation and observed-facts assembly.

Acceptance criteria:

- Safe path repairs are applied before evidence and surface checks.
- Ambiguous path repairs block with a clear event.
- Model-declared files are reconciled against observed changed files.
- The run can continue when model path drift is repaired and observed facts satisfy policy.

Completed:

- Added an implement output repair gate after normalized output assembly and observed changed/write fact derivation.
- Safe model path drift now emits `agent.output-repaired` with compact raw/normalized field evidence and continues into existing schema, evidence, mismatch, and surface checks.
- Ambiguous model path repair now emits `agent.contract-gate-blocked` with bounded candidate paths and blocks before PR or evidence work.
- Reconciliation continues to use observed changed files and observed write-tool paths for `agent.output-fact-mismatch`.
- Event payloads use repo-relative paths or sanitized `<worktree>/...` placeholders instead of absolute user paths.

Files changed:

- `slices/fix-issue/implement-phase.ts`
- `slices/fix-issue/slice.test.ts`
- `core/event-stream/store.ts`
- `apps/web/src/components/detail/lib/timeline.ts`

Verification:

- `pnpm vitest run slices/fix-issue/slice.test.ts core/workspaces/path-normalization.test.ts core/workspaces/observed-changes.test.ts core/tool-layer/path-contract.test.ts` — passed, 48 tests.
- `pnpm lint` — passed.

Slice 1 status: complete.

### [x] Slice 2 - Evidence requirement gate

Evaluate frontend evidence requirements against observed changed files, not only `filesWritten`.

Acceptance criteria:

- Any observed `apps/web/` change requires `evidenceSpecPath` unless project setting disables evidence or a valid blocker summary exists.
- Package-relative model paths cannot bypass the evidence requirement.
- Missing or non-existent evidence spec blocks evidence-post and emits a precise event.

Completed:

- Added an evidence requirement contract gate in the implement workflow after path repair and observed-fact assembly.
- Observed `apps/web/` git changes now require `evidenceSpecPath` unless evidence-post is disabled or a valid evidence blocker summary exists.
- Package-relative frontend paths are repaired before the evidence gate runs, so `src/...` model output cannot bypass the frontend evidence requirement.
- Declared evidence specs must exist in the worktree before PR/evidence-post work starts; missing specs emit `agent.contract-gate-blocked` with `gate: evidence-requirement` and a precise reason.
- Updated evidence-post workflow tests so cases that expect evidence-post to run create the declared spec file.

Files changed:

- `slices/fix-issue/implement-phase.ts`
- `slices/fix-issue/slice.test.ts`
- `core/event-stream/store.ts`
- `apps/web/src/components/detail/lib/timeline.ts`
- `docs/plans/workflow-contract-repair-gates.md`

Verification:

- `pnpm vitest run slices/fix-issue/slice.test.ts core/workspaces/path-normalization.test.ts core/workspaces/observed-changes.test.ts core/tool-layer/path-contract.test.ts` — passed, 50 tests.
- `pnpm lint` — passed.

Slice 2 status: complete.

### [x] Slice 3 - Wrong-surface gate rewrite

Compare investigation key files to observed changed files first, then repaired model output as fallback.

Acceptance criteria:

- Reading an investigated file and changing an unrelated file is distinguishable.
- Changing an investigated file with a package-relative reported path passes after repair.
- Missing observed changes produces a separate "no changed files" reason.

Completed:

- Rewrote the implement wrong-surface guard to evaluate observed git changes first when they exist.
- Changed unrelated observed files now block with `observed-changes-missed-investigation-surface`, even when the run read or model-reported an investigated file.
- Git worktrees with no observed changes now block with `no-observed-changed-files` instead of silently trusting model-declared paths.
- Non-git/unavailable observed facts still fall back to repaired model output, so uniquely repaired package-relative paths can pass the guard.

Files changed:

- `slices/fix-issue/implement-phase.ts`
- `slices/fix-issue/slice.test.ts`
- `docs/plans/workflow-contract-repair-gates.md`

Verification:

- `pnpm vitest run slices/fix-issue/slice.test.ts core/workspaces/path-normalization.test.ts core/workspaces/observed-changes.test.ts core/tool-layer/path-contract.test.ts` — passed, 52 tests.
- `pnpm lint` — passed.

Slice 3 status: complete.

### [x] Slice 4 - Implement-wp ownership gate

Repair and validate WP-owned paths before sandbox setup, commit, and revert operations.

Acceptance criteria:

- `filesOwned` are canonical before being passed to `wp-file-guard`.
- Ambiguous `filesOwned` block before a builder starts.
- `orchestratorCommitWp()` and `revertWpChanges()` receive canonical paths only.

Completed:

- Added a builder-level implement-wp ownership gate that normalizes `filesOwned` before spawn context, sandbox env, sandbox setup, and revert paths are built.
- Ambiguous `filesOwned` now emit `agent.contract-gate-blocked` with `gate: implement-wp-ownership` and fail before the WP builder runtime starts.
- Safe `filesOwned` repairs emit `agent.output-repaired` and pass canonical paths into `FACTORY_WP_FILESOWNED`, `wp.filesOwned`, and `revertWpChanges()`.
- Existing parallel implement spec normalization continues to pass canonical `filesOwned` into `orchestratorCommitWp()`.

Files changed:

- `slices/parallel-implement/wp-builder.ts`
- `slices/parallel-implement/slice.test.ts`
- `docs/plans/workflow-contract-repair-gates.md`

Verification:

- `pnpm vitest run slices/parallel-implement/slice.test.ts core/workspaces/path-normalization.test.ts core/tool-layer/path-contract.test.ts` — passed, 42 tests.
- `pnpm lint` — passed.

Slice 4 status: complete.

### [x] Slice 5 - Spec-author output gate

Validate and repair `filesOwned`, interface contract files, migration paths, and verification script paths before parallel implementation consumes the spec.

Acceptance criteria:

- Duplicate ownership is checked after normalization.
- Typos and ambiguous package-relative paths are reported before WP dispatch.
- The gate emits enough evidence for a human to repair the spec.

Completed:

- Added a spec-author output gate that emits `agent.output-repaired` for safe path repairs across `filesOwned`, interface contract files, migration paths, and verification script paths.
- Ambiguous spec-author path repairs now emit `agent.contract-gate-blocked` with `gate: spec-author-output` and field/candidate evidence before the spec is persisted or dispatched.
- Duplicate `filesOwned` ownership is checked after normalization and blocks before structural validation/persistence with owner evidence for human repair.
- Added regression coverage for repaired package-relative paths across all spec path-bearing surfaces, ambiguous package-relative ownership, and duplicate ownership after normalization.

Files changed:

- `slices/spec-author/workflow.ts`
- `slices/spec-author/slice.test.ts`
- `docs/plans/workflow-contract-repair-gates.md`

Verification:

- `pnpm vitest run slices/spec-author/slice.test.ts core/workspaces/path-normalization.test.ts` — passed, 29 tests.
- `pnpm lint` — passed.

Next unchecked slice: none; workflow contract repair gates plan is complete.

## Resume state

Completed in this run: Slices 1-5. Current code changes are concentrated in implement repair/evidence/wrong-surface gates, implement-wp ownership gate, spec-author output gate, event-kind labels, and focused tests. Verification after each completed slice has passed with `pnpm lint` plus the relevant focused Vitest commands. Next action is final focused verification across all completed gate changes.

Final verification:

- `pnpm vitest run slices/fix-issue/slice.test.ts slices/parallel-implement/slice.test.ts slices/spec-author/slice.test.ts core/workspaces/path-normalization.test.ts core/workspaces/observed-changes.test.ts core/tool-layer/path-contract.test.ts core/tool-layer/mcp/slice.test.ts` — passed, 154 tests.
- `pnpm lint` — passed.
- `pnpm typecheck` — passed.

## Events

Use compact workflow events:

- `agent.output-repaired`
- `agent.output-fact-mismatch`
- `agent.contract-gate-blocked`

Payloads should include field names, raw values, normalized values, and blocking reasons. Keep them bounded and avoid absolute user paths in user-facing payloads.

## Verification

- Tests for each drift classification.
- Regression for issue 868 style `src/...` test path.
- Parallel-implement test where two package-relative `src/index.ts` candidates block as ambiguous.
- Evidence gate test using observed git diff rather than model `filesWritten`.
