# ADR 0046 - Durable operator interventions

**Status:** Accepted
**Date:** 2026-05-20

## Context

Some Goose Hub work can strand in states that require an operator decision: a
workflow asks for human input, a gate is pending, QA and deterministic evidence
disagree, or merge conflict automation cannot proceed. Today some of that is
surfaced through frontend state heuristics such as `GatePendingBanner`, while
the actual lifecycle authority remains GitHub labels and
`core/state-machine/transitions.ts`.

That split is fragile. The browser can guess that a label is actionable, but it
cannot explain why the item is blocked, dedupe repeated terminal events, audit a
human decision, or safely validate an action proposed by an LLM.

## Decision

Add a durable intervention control plane backed by SQLite.

### Tables

The current intervention row lives in `work_item_interventions`. Its full audit
history lives in `work_item_intervention_events`.

`work_item_interventions` is operational state, not lifecycle source of truth.
It stores the current status, dedupe/root-cause signature, correlation ID,
proposed options, decided action, application result, verification evidence, CAS
version, and optional lease fields for workers.

`work_item_intervention_events` is append-only audit history for reducer
transitions. Event-stream records may additionally mirror important moments for
UI/event consumers, but the table is the complete intervention audit log.

### Status enum

V1 statuses are:

- `OPEN` - actionable blockage exists, no proposal yet.
- `PROPOSED` - a proposer produced structured safe options.
- `DECIDED` - an operator or server policy selected an action.
- `APPLYING` - a server applier has leased and is executing the action.
- `APPLIED` - side effects completed and are ready for verification.
- `FAILED` - application failed; evidence is recorded and the item is
  actionable again.
- `VERIFIED` - post-application verification succeeded.
- `RESOLVED` - the blockage is closed.
- `ABORTED` - an operator cancelled the intervention.
- `SUPERSEDED` - another intervention replaced this one.

Reducer functions are compare-and-set transitions:
`open`, `propose`, `decide`, `markApplying`, `recordApplicationResult`,
`verify`, `resolve`, `reopen`, `abort`, and `supersede`.

### Dedupe and reopen

The projector computes a deterministic `root_cause_signature` from project,
work item, intervention type, triggering event kind, and salient payload fields.
If an active intervention with the same signature exists, projection is a no-op.
If the latest matching intervention is closed and the same condition recurs, the
reducer reopens it with a new event and incremented version instead of creating
an unlinked duplicate.

### Event projection

Projection is deterministic and side-effect-light. It may open or reopen
interventions and enqueue proposer work, but it must not run an LLM inline while
replaying events. Proposer/applier workers read durable rows, recover after
restart, and handle stale `APPLYING` leases.

Applier-caused downstream events carry `interventionId` or
`causedByInterventionId`. Projectors must ignore those events for the same
root-cause family so appliers do not reopen their own actions.

### Manual overrides

Direct web/operator transitions are represented as synthetic
`manual_override` interventions. The V1 claim is intentionally narrow: all
operator manual transitions through Goose Hub web/API routes are audited. It is
not yet a claim that every server workflow transition is intervention-backed.

### Action registry

Every `action_type` has an explicit Zod schema. LLM-proposed payloads are data,
not authority: the registry validates payload shape, and the server applier
performs legal-transition checks against `core/state-machine/transitions.ts`
before executing any side effect.

### Relationship to GitHub labels

GitHub labels remain lifecycle state authority. Interventions explain, propose,
audit, and execute operator decisions; they do not bypass the state machine.
When an intervention applies a state transition, it uses existing source
transition functions and records correlation IDs on the emitted events.

## V1 stuck-state audit

| Stranding state/event | Intervention type | V1 handling |
| --- | --- | --- |
| `factory:needs-human` or `gate.awaiting-human` | `needs_human` | Open/reopen intervention; proposer suggests legal next states or no-op. |
| `factory:gate-pending` | `gate_pending` | Open/reopen intervention for operator question/gate decisions. |
| `merge.conflict` / `factory:merge-conflict` | `merge_conflict` | Open/reopen intervention; applier may dispatch existing conflict resolver. |
| `qa.tier-disagreement` | `qa_disagreement` | Open/reopen intervention for human adjudication. |
| Direct web/API manual transition | `manual_override` | Synthetic intervention created, decided, applied, verified, resolved. |
| Non-web workflow transition | Explicit non-v1 gap | Existing workflow audit events remain; full wrapping is later work. |

## Consequences

- Frontend banners and operator queues can render from data instead of local
  state heuristics.
- Replays are idempotent because dedupe/reopen is deterministic.
- LLM proposals become safe to store because execution remains registry- and
  state-machine-validated.
- A new operational table must be maintained carefully; reducer tests are the
  contract for legal status movement and audit completeness.
