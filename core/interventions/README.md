# core/interventions

Durable operator intervention control plane for stuck work items.

This module owns the operational SQLite reducer, projector, proposer worker,
applier worker, action registry, and repository helpers for interventions. It
does not own lifecycle state authority; source labels and
`core/state-machine/transitions.ts` remain the state machine authority.

Key files:

- `types.ts` — intervention statuses, types, rows, and action option schema.
- `actions.ts` — action registry and payload validation.
- `reducer.ts` — compare-and-set status transitions plus audit events.
- `projector.ts` — deterministic projection from actionable event-stream rows.
- `proposer.ts` — leases `OPEN` rows and invokes `skills/intervention-proposer`.
- `applier.ts` — leases `DECIDED` rows and executes validated decisions.
- `repository.ts` — SQLite persistence for rows and audit events.
