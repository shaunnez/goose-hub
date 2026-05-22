# ADR 0047 - Spec-first PRD lifecycle

**Status:** Accepted
**Date:** 2026-05-22

## Context

The Discover lane uses Matt Pocock-style grilling and PRD writing to clarify
feature intent. The older post-approval path immediately decomposed the
approved PRD into child GitHub issues with `decompose-prd`, then let those
children enter development independently.

That mixed two planning models. The child issues were thin projections of the
PRD, so they could lose parent context, rediscover sibling scope, and drift
before `spec-author` had produced the Engineering Spec that actually defines
file ownership, work packages, dependency batches, and verification commands.

## Decision

Keep grill/write-prd as the discovery front-end, then switch to the Engineering
Spec lifecycle after PRD approval.

The default lifecycle is:

```text
grill -> write-prd -> approve PRD -> parent dev-ready -> spec-author -> EngineeringSpec WPs -> parallel-implement
```

PRD approval moves the parent issue from `factory:prd-review` to
`factory:dev-ready`. It emits `prd.lifecycle-routed` to make the skipped
pre-spec decomposition explicit. With the multi-agent pipeline enabled,
`dispatchFixIssue` routes the parent to `spec-author`; `parallel-implement`
then dispatches the Engineering Spec work packages.

`decompose-prd` remains available as a manual/backcompat workflow, but it is no
longer the automatic post-PRD approval path.

`spec-author` receives a compact `prdContext` built from `resolveLatestPrd()`.
The inline context contains implementation-relevant PRD sections, while large
raw PRDs are stored in `agent_artifacts` and passed as `ArtifactRef` metadata.

Child GitHub issues are tracking projections only. If enabled, they are created
after `spec-author` from `EngineeringSpec.workPackages[]`; they must not run
grill, write-prd, decompose-issues, or spec-author as independent planning
roots. Their implementation authority remains the parent Engineering Spec.

## Consequences

- The parent PRD issue remains the planning root through spec-author and
  parallel implementation.
- Work package builders receive only their WP, relevant acceptance criteria,
  parent PRD summary, and artifact refs, not sibling implementation scope.
- Optional child issues remain useful for GitHub tracking, but they are derived
  after the Engineering Spec and are not lifecycle authorities.
- The settings workflow map shows PRD approval routing to Dev ready, with
  legacy decomposition as a manual/backcompat branch.
- Large PRD payloads follow the existing artifact-backed progressive
  disclosure pattern instead of being duplicated through prompts.
