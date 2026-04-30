---
id: "0003"
title: Priority-ordered conflict resolution for GitHub label state
status: accepted
date: 2026-04-30
milestone: M1
---

## Context

GitHub labels are mutable by humans at any time. An issue can end up with zero, one, or multiple `factory:*` state labels, including unknown ones. The orchestrator needs a deterministic rule for recovering a single canonical state from any label combination.

## Decision

`resolveState(labels)` applies five rules in priority order:

1. Unknown `factory:*` labels (not in STATES) — ignored, `unknown-factory-label` conflict recorded.
2. Zero known state labels — default to `factory:triaging`, `zero-factory-labels` conflict recorded.
3. `factory:archived` + any other state — archived wins, `archived-wins` conflict recorded.
4. Two or more known state labels — highest canonical index (per `STATES` array) wins, `multiple-state-labels` conflict recorded.
5. Single known state label — no conflict.

`checkTransition(from, to)` is a separate function handling the `from === null` case (first-ever transition is always legal) and delegating to `isLegalTransition` otherwise.

## Consequences

- All conflict reasons are typed (`ConflictReason`) so callers can branch on specific cases.
- `archived-wins` is checked before `multiple-state-labels` — archived is a terminal state and must not be overridden by any active state label regardless of canonical index.
- The "highest index wins" rule makes conflict resolution deterministic and stable across concurrent label edits.
- `checkTransition` is separate from `resolveState` so the CLI (read-only) can call `resolveState` without importing transition logic.
