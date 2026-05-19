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

### [ ] Slice 1 - Implement output repair gate

Run a repair gate after implement output validation and observed-facts assembly.

Acceptance criteria:

- Safe path repairs are applied before evidence and surface checks.
- Ambiguous path repairs block with a clear event.
- Model-declared files are reconciled against observed changed files.
- The run can continue when model path drift is repaired and observed facts satisfy policy.

### [ ] Slice 2 - Evidence requirement gate

Evaluate frontend evidence requirements against observed changed files, not only `filesWritten`.

Acceptance criteria:

- Any observed `apps/web/` change requires `evidenceSpecPath` unless project setting disables evidence or a valid blocker summary exists.
- Package-relative model paths cannot bypass the evidence requirement.
- Missing or non-existent evidence spec blocks evidence-post and emits a precise event.

### [ ] Slice 3 - Wrong-surface gate rewrite

Compare investigation key files to observed changed files first, then repaired model output as fallback.

Acceptance criteria:

- Reading an investigated file and changing an unrelated file is distinguishable.
- Changing an investigated file with a package-relative reported path passes after repair.
- Missing observed changes produces a separate "no changed files" reason.

### [ ] Slice 4 - Implement-wp ownership gate

Repair and validate WP-owned paths before sandbox setup, commit, and revert operations.

Acceptance criteria:

- `filesOwned` are canonical before being passed to `wp-file-guard`.
- Ambiguous `filesOwned` block before a builder starts.
- `orchestratorCommitWp()` and `revertWpChanges()` receive canonical paths only.

### [ ] Slice 5 - Spec-author output gate

Validate and repair `filesOwned`, interface contract files, migration paths, and verification script paths before parallel implementation consumes the spec.

Acceptance criteria:

- Duplicate ownership is checked after normalization.
- Typos and ambiguous package-relative paths are reported before WP dispatch.
- The gate emits enough evidence for a human to repair the spec.

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

