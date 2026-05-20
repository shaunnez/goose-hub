# Operator Interventions Runbook

Durable interventions are the operator control plane for stuck work items. They
explain why a work item is blocked, propose safe actions, record the operator
decision, and apply the decision server-side with audit evidence.

## How Interventions Are Created

The projector in `core/interventions/projector.ts` watches event-stream records
and opens or reopens rows in `work_item_interventions` for:

- `factory:needs-human` and `gate.awaiting-human` as `needs_human`.
- `factory:gate-pending` as `gate_pending`.
- `merge.conflict`, `merge.conflict-unresolvable`, and
  `factory:merge-conflict` as `merge_conflict`.
- `qa.tier-disagreement` as `qa_disagreement`.
- Direct web/API manual state transitions as synthetic `manual_override`.

Projection is idempotent. The root-cause signature dedupes repeated events, and
applier-caused events carry `interventionId` / `causedByInterventionId` so the
projector can ignore its own downstream effects.

## How To Inspect Them

Use the web UI first:

- `/interventions` shows `OPEN` and `PROPOSED` interventions across projects.
- The issue detail banner shows active issue-specific interventions and proposed
  decisions.
- The issue Timeline tab includes an intervention audit panel with lifecycle
  events and state-transition backlinks.

Use the API when diagnosing:

- `GET /projects/:slug/interventions?status=OPEN,PROPOSED`
- `GET /projects/:slug/issues/:id/interventions`
- `GET /interventions/:id`
- `GET /projects/:slug/issues/:id/legal-targets`

The full audit history is in `work_item_intervention_events`.

For a read-only operational report, run:

```sh
pnpm tsx scripts/report-interventions.ts
pnpm tsx scripts/report-interventions.ts goose-hub-self
```

The report summarizes active interventions by project/type, active rows whose
latest lifecycle state is terminal, repeated `proposalFailed` rows, and proposer
costs where the proposer run id is available in audit evidence.

## Recovery Behavior

The proposer worker leases `OPEN` rows, invokes `skills/intervention-proposer`,
and stores validated options as `PROPOSED`. Invalid proposer output leaves the
row `OPEN`, appends `proposalFailed` evidence, and backs off before retrying.
After the configured failure cap the row moves to `ABORTED` with the last error
in the audit payload.

See `docs/runbooks/operator-interventions-improvement-plan.md` for the hardening
plan covering stale-state guards, proposer backoff, and operational audits.

`POST /interventions/:id/decide` only records the decision and requires
`expectedVersion`. The applier worker leases `DECIDED` rows, validates the
action payload again, executes through existing server paths, records the
result, verifies, and resolves.

On startup the server recovers stale proposal leases back to `OPEN` and stale
`APPLYING` leases back to `DECIDED`, so decisions are retried rather than lost.
Failed apply moves the row to `FAILED` with evidence for manual recovery.

## Outside V1

Non-web workflow transitions are not all wrapped as interventions. They remain
audited through existing event-stream rows unless they hit one of the actionable
conditions above. Contributor authorization and multi-operator assignment are
also outside V1.
