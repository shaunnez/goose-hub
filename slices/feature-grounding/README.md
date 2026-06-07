# feature-grounding slice

## What this slice does

Orchestrates multi-scout investigation to ground a feature request in the existing codebase. Dispatches scouts to identify existing implementation surfaces, public entry points, dependencies, reusable patterns, and test coverage. Synthesizes findings into a feature grounding payload that informs downstream workflow routing and development readiness.

## Files

- `workflow.ts` — Main workflow orchestration; dispatches feature scouts (code-path, dependency, pattern, test-inventory), synthesizes findings into `FeatureGroundingPayload`, and routes to next state based on confidence level
- `slice.test.ts` — Unit tests for workflow behavior including scout dispatch, grounding synthesis, and state transitions

## Tests

- `slice.test.ts` — Tests scout execution, grounding payload assembly, route selection (dev-ready, grilling, prd-drafting, needs-human), and feature enhancement runner integration

## Usage

Called by `spec-author` workflow to ground feature context before authoring the PRD. Feature grounding payload is passed through the spec-author workflow to inform development planning.
