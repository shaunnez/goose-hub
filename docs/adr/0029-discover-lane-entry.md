# ADR 0029: Discover Lane entry point — triage → grilling for fresh features

**Status:** Accepted, 2026-05-07

## Context

M13 shipped the Discover Lane skills and workflows (`runGrillAndPrdWorkflow`,
`runDecomposePrdWorkflow`) and the full UI surface. However, no automatic entry
point was wired. The only ways `factory:grilling` was ever set were:

1. Manual label application by a human.
2. The `rejectPRD` path inside `runGrillAndPrdWorkflow` (re-enters grilling if
   the advisor rejects the PRD draft).

PR #598 flagged this as the single remaining gap before M13 could be considered
closed. Issue #592 captured the work item.

Without automatic routing, the Discover Lane is dormant by default. Every
`type:feature` issue filed by the owner lands at `factory:dev-ready` after
triage, bypassing grilling entirely. That defeats the purpose of the lane.

A naive fix — routing all `type:feature` issues through grilling — breaks
`decompose-prd`: child issues produced by `runDecomposePrdWorkflow` are
themselves `type:feature` and would enter grilling, causing an infinite loop.

## Options considered (from issue #592)

### 1. `factory:from-prd` marker label + triage routing
Decompose-prd applies `factory:from-prd` to every child it creates.
Triage routes `type:feature && !factory:from-prd` → `factory:grilling`;
everything else (including from-prd children and chores) keeps the current path.

**Pros:** explicit, queryable, opt-out-able by human (remove the label to
force a re-grill). No new schema fields. Triage logic is a single conditional.

**Cons:** requires a new canonical label; label must be applied by decompose-prd.

### 2. `needsGrilling: boolean` slot in triage skill verdict
Add a new field to `TriageOutputSchema` so the agent decides per-item whether
grilling is warranted.

**Pros:** nuanced per-item decisions possible.

**Cons:** adds agent non-determinism to a binary structural decision. Requires
prompt-engineering the agent to understand the loop risk. Harder to test.

### 3. Heuristic body-length check
Route `type:feature` issues with short bodies (< N chars) to grilling; assume
longer bodies are sufficiently specified.

**Pros:** zero new labels or schema fields.

**Cons:** brittle. A well-specified one-liner still deserves grilling. A verbose
but vague description would bypass it. Threshold is arbitrary.

### 4. decompose-prd skips triage for children entirely
Decomposed children land at `factory:accepted` (already done in PR #598) and
never pass through triage at all.

**Pros:** simpler — no marker needed if children never reach triage.

**Cons:** children that fall back to `factory:needs-human` and then
`factory:triaging` (a legal recovery path) would hit the routing gap again.
Option 4 alone is fragile.

## Decision

**Option 1 + 4 hybrid.**

- `runDecomposePrdWorkflow` already lands children at `factory:accepted` (PR
  #598, Option 4). Children additionally receive `factory:from-prd` so that
  any future recovery path through `factory:triaging` (needs-human → triaging)
  is also handled correctly.
- `runTriageBatch` routes `type:feature && !factory:from-prd` →
  `factory:grilling`; `type:feature && factory:from-prd` → `factory:dev-ready`
  (existing behaviour).
- The `factory:from-prd` label is added to the canonical label set in
  `core/bootstrap/labels.ts`.
- `StateSource` gains an optional `listLabels?(itemId): Promise<string[]>`
  method. Optional (not required) to avoid breaking legacy mock sources that
  predate this ADR (e.g. `retro-batch.test.ts`). `runTriageBatch` calls it
  with `?? []` fallback.

## Consequences

- **Fresh `type:feature` issues** filed against any project automatically enter
  the Discover Lane via triage. The lane is no longer dormant.
- **Decomposed children** carry `factory:from-prd` and skip grilling regardless
  of how they enter triage. Their grilling was already done at the parent level.
- **Bugs, chores, research** are unaffected.
- **Manual override:** a human can remove `factory:from-prd` from a child to
  force it through grilling if desired.
- **Recovery path safe:** if a child lands at `factory:needs-human` and a human
  resets it to `factory:triaging`, the `factory:from-prd` label ensures it
  still skips grilling on the next triage tick.
- **Tests:** two new routing tests in `triage-batch.test.ts`, one updated label
  assertion in `slices/decompose-prd/slice.test.ts`, one new entry-point
  integration test in `slices/discover-lane-e2e/slice.test.ts`.
