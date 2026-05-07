# slices/discover-lane-e2e

M13.10: End-to-end integration test for the Discover Lane (#321).

## What this slice tests

This is the **M13 exit-criterion integration test**. It wires the two
Discover-Lane workflows together and verifies every required state transition
across the full lane:

```
factory:grilling
  → runGrillAndPrdWorkflow (round 1 — question posted)
    → factory:gate-pending
      → user reply (simulated)
        → factory:grilling
  → runGrillAndPrdWorkflow (round 2 — second question)
    → factory:gate-pending
      → user reply (simulated)
        → factory:grilling
  → runGrillAndPrdWorkflow (round 3 — ready for PRD)
    → write-prd → factory:prd-review
  → human approve (transitionState prd-review → prd-review)
  → runDecomposePrdWorkflow
    → 2 child issues created
    → sibling refs resolved
    → factory:issues-created
  → child lifecycle stub (× 2 children)
    accepted → dev-ready → in-progress → needs-qa → needs-review → approved → retrospecting → done
  → sprint-review skill invoked (mocked runtime)
    → SprintReviewOutput validates
    → sprint-review artefact issue created
```

## Deferrals

### Child lifecycle (M5–M9 workflows)
The child-issue lifecycle traversal in Phase 8 is **stubbed**: it calls
`transitionState` directly for each state hop without invoking the real QA,
Review, Fix, or Retro workflows. This is intentional — those workflows are
covered by their own slices (`slices/qa`, `slices/review`, `slices/fix-issue`,
etc.). The stub confirms that the state-machine edges are legal and that
`factory:done` is reachable; it stands in for full M5–M9 execution.

### Sprint-review workflow trigger
The sprint-review **skill** (`skills/sprint-review/`) is fully implemented
(shipped in M13 wave 1). The **workflow trigger** that fires it automatically
at milestone end is **out of scope for #321** and will be implemented in a
future issue. This slice exercises the skill integration (mock runtime →
`SprintReviewOutputSchema` validation) and creates the artefact issue, but the
automatic end-of-milestone invocation is deferred.

### PRD comment parser boundary
The inline PRD parser in `slice.test.ts` (`parsePrdFromComment`) is a local
helper rather than an import of
`apps/web/src/components/detail/lib/parse-prd-comment.ts`. The web app lives in
`apps/web/` which is not a pnpm workspace package that this test can import
across the monorepo boundary (FACTORY_RULES rule 28a). The helper is under 20
lines and faithfully reproduces the marker check and JSON-fence extraction; the
full `parsePRDComment` from `parse-prd-comment.ts` is exercised by
`slices/grill-prd-ui`.

## Playwright UI integration test
The UI-side integration test is already shipped in wave 5:
`apps/web/e2e/grill-prd-flow.spec.ts`

That spec runs a real browser against the dev server and covers the PRD/Grill
tabs, comment rendering, and the approve-PRD action. The vitest slice here
covers the workflow/state-machine layer; the Playwright spec covers the
presentation layer.

## Scenario list (10 phases)

| # | Phase | Key assertion |
|---|-------|---------------|
| 1 | Seed a vague feature issue; force into `factory:grilling` | `workItem.state === 'factory:grilling'` |
| 2 | Round 1 grill — not ready; one question posted | Comment with `<!-- factory:grill-question -->` + `Round 1`; state → `factory:gate-pending`; `grill.question-posted` event |
| 3 | User reply; re-enter `factory:grilling` | Comment posted by non-bot author; state forced back |
| 4 | Round 2 grill — still not ready | Second question posted; two total `grill.question-posted` events |
| 5 | Round 3 grill → ready; write-prd; advisor skipped (priority=medium) | `phase=prd-review`; `<!-- factory:prd -->` comment; PRD round-trips via inline parser; `prd.advisor-skipped` reason=priority |
| 6 | Human approves PRD | `transitionState(prd-review → decomposing)` succeeds |
| 7 | Decompose — 2 child issues; sibling dep resolved | Children created; child 2 body contains `#<child1>`; parent → `factory:issues-created`; `## Child issues` comment; `decompose.completed` event |
| 8 | Child lifecycle stub | Each child traverses `accepted → … → done`; `factory:done` confirmed |
| 9 | Sprint review skill | `listOpenWork()` returns `[]`; `SprintReviewOutputSchema` validates; sprint-review artefact issue created |
| 10 | Final event log assertions | `agent.run-started` ≥ 3; `grill.question-posted` = 2; `grill.completed` = 1; `prd.drafted` = 1; `prd.advisor-skipped` = 1; `decompose.completed` = 1 |

## Running the tests

```bash
# This slice only
pnpm vitest run slices/discover-lane-e2e

# Full Discover-Lane suite
pnpm vitest run core/workflows slices/grill-and-prd slices/decompose-prd slices/discover-lane-e2e
```

## Surfaces touched

This slice adds no new implementation. It exercises:
- `core/workflows/grill-and-prd.ts` (`runGrillAndPrdWorkflow`)
- `core/workflows/decompose-prd.ts` (`runDecomposePrdWorkflow`)
- `core/state-source/in-memory-labels.ts` (`InMemoryLabelsSource`)
- `core/event-stream/store.ts` (`eventStore.replay`)
- `core/state-machine/transitions.ts` (via `InMemoryLabelsSource.transitionState`)
- `skills/sprint-review/schema.ts` (`SprintReviewOutputSchema`)
