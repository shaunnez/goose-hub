# framing slice

Consumes the `factory:framing` state for vague fresh features. The workflow invokes `feature-frame`, appends `framedContent` to the work-item body in memory, and then continues through existing Discover Lane contracts.

## Routing

- `stillNeedsGrilling: false` transitions to `factory:prd-drafting` and calls `runGrillAndPrdWorkflow({ skipGrill: true })` with the framed body and explicit `refinedIntent`.
- `stillNeedsGrilling: true` transitions to `factory:grilling` and calls grill-me through `runGrillAndPrdWorkflow` with the same framed in-memory body.

The original issue body is not rewritten by this slice.
