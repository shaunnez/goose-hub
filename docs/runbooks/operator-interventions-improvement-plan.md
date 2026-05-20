# Operator Interventions Improvement Plan

## Goal

Prevent intervention rows from becoming stale, noisy, or expensive after the
underlying work item has already moved on.

## Current Failure Mode

Issue `#899` moved from `factory:needs-human` to `factory:archived` through a
manual override. The manual override intervention resolved correctly, but the
older `needs_human` intervention stayed `OPEN`. The proposer worker only checks
for `OPEN` rows with no active lease, so it repeatedly leased the stale row,
invoked `skills/intervention-proposer`, failed output validation, cleared the
lease, and retried.

## Slice 1: Close Stale Rows On Manual Resolution

Status: implemented.

When a manual transition exits an intervention-backed state or lands in a
terminal state, supersede all other active interventions for the same work item.
The manual override row remains the audit record for the operator action; older
rows move to `SUPERSEDED` and stop feeding the proposer worker.

Regression coverage:

- Existing stale `needs_human` row.
- Manual `factory:needs-human -> factory:archived` transition.
- Stale row becomes `SUPERSEDED`.
- Manual override row becomes `RESOLVED`.

## Slice 2: Add Proposer Stale-State Guard

Before leasing an `OPEN` row, compare the intervention type with the latest
work-item state:

- `needs_human` is applicable only while state is `factory:needs-human`.
- `gate_pending` is applicable only while state is `factory:gate-pending`.
- `merge_conflict` is applicable only while state is `factory:merge-conflict`.
- Terminal states must not receive proposer runs.

If the row is stale, supersede it with actor `intervention-proposer` and audit
the current state in the payload. This handles stale rows created before the
manual-transition cleanup existed and protects non-web state changes.

## Slice 3: Backoff And Failure Cap

`proposalFailed` currently clears the lease immediately, so the same bad row is
eligible again on the next worker tick. Add retry control:

- Track consecutive proposal failures per intervention.
- On failure, set `leaseExpiresAt` to a future retry time instead of clearing it.
- Use exponential backoff with a small cap.
- After a configured failure limit, move the row to `ABORTED` with the last
  validation error in evidence.

This should make schema drift visible without spending continuously.

## Slice 4: Worker Scope Hygiene

The server currently starts the proposer worker globally. Add a startup guard so
local/dev test projects cannot flood the live worker:

- Default worker scope to registered non-test projects.
- Add an explicit env override for all-project repair runs.
- Exclude project ids matching generated e2e/test prefixes unless the override
  is set.

## Slice 5: Operational Audit

Add a small diagnostic command or admin endpoint that reports:

- Active interventions by project and type.
- Rows whose work item is terminal but intervention is active.
- Rows with repeated `proposalFailed` events.
- Estimated proposer cost by intervention id.

This gives the operator a single place to spot future loops before they become
timeline noise.
