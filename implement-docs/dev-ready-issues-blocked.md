# todo - make into a plan

Problem: Blocked factory:dev-ready issues are never re-dispatched

  When decompose-prd creates child issues, they all land in factory:dev-ready simultaneously. GitHub webhooks fire for each one.
  Issues with unmet deps (Depends on #N) get schedule:blocked-by applied and are dropped.

  When the blocking issue completes (factory:done), nothing re-triggers the blocked issue. The webhook handler only reacts to
  issues.labeled — it ignores issue/PR close events. The per-project tick only runs runTriageBatch which only processes
  factory:triaging items. No sweep exists for factory:dev-ready + schedule:blocked-by.

  Result: Blocked child issues sit permanently stuck unless a human manually intervenes.

  Fix shape: A sweep in the tick that fetches factory:dev-ready items with schedule:blocked-by, runs filterEligibleByDependencies
  on them (which already restores schedule:current as a side-effect), and dispatches the newly eligible ones. Requires adding
  getItemsByState() to the StateSource interface.