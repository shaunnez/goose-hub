# Research Workflow

The research workflow runs a distinct research lifecycle for `type:research` work items in `factory:research-pending`.

It borrows neutral repository-discovery mechanics from investigation workflows: repository affinity, workflow base resolution, worktree creation, optional scout digest context, research synthesis, runtime/schema failure telemetry, decision summary reconciliation, and worktree cleanup.

It deliberately does not run bug-enhance, Playwright repro, route selection, acceptance-contract authoring, or bug-specific fix hints. The workflow emits `agent.research-complete` and transitions only from `factory:research-pending` to `factory:research-complete`. The server-side `dispatchResearchComplete` actor owns the final routing hop to `factory:dev-ready` or `factory:needs-human`.
