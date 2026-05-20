# skills/intervention-proposer

Produces structured operator decision options for durable interventions.

The proposer receives an `OPEN` intervention, recent issue events, and
server-derived legal targets. It returns a summary plus candidate actions such
as `manual_transition`, `approve_gate`, `reject_gate`, `resume_workflow`,
`resolve_conflict`, or `no_action`. The worker validates every option against
`core/interventions/actions.ts` before storing it on the intervention row.
