The dependency graph

  Steps 1-3 (foundation — must be serial)
      ↓
  Wave A — parallel (different file sets, no overlap):
    Step 4: apps/server/src/domains/inbox/service.ts
    Step 5: slices/investigate/workflow.ts
    Step 8: core/workflow-routing/reviewer-cap.ts + slices/review/convergent-review.ts
      ↓
  Wave B — parallel:
    Step 6: slices/investigate/wave2-selection.ts + investigation-planner.ts
    Step 7: apps/server/src/shared/dispatch-dev.ts + skills/spec-author/validate.ts
      ↓
  Steps 9-10 (serial — resume wiring + integration test)

  What to use where

  Steps 1-3: Single Sonnet agent, sequential, worktree.
  Foundation types flow into everything. One context prevents type-name drift across 8 downstream files. Step 2 (the routing logic) is deterministic rule tables — Sonnet handles it. No
  Opus needed for implementation; Opus was right for design, wrong for mechanical code.

  Wave A + Wave B: superpowers:dispatching-parallel-agents.
  Each parallel step owns non-overlapping files. Give each subagent: the plan excerpt for its step, the types from Step 1-3, its owned files, TDD instructions, and the #1178 acceptance
  fixture.

  Steps 9-10: Single Sonnet agent.
  Step 9 touches dispatch-routing.ts which everything else feeds into — too much shared state to parallelize safely. Step 10 is the integration harness.

  Model allocation

  ┌────────────────┬────────┬─────────────────────────────────────────────────────────────────────────────────────────┐
  │     Steps      │ Model  │                                           Why                                           │
  ├────────────────┼────────┼─────────────────────────────────────────────────────────────────────────────────────────┤
  │ 1-3            │ Sonnet │ Scaffolding + pure function + event wiring — mechanical                                 │
  ├────────────────┼────────┼─────────────────────────────────────────────────────────────────────────────────────────┤
  │ Wave A (4,5,8) │ Sonnet │ Dispatch wiring in known seams, file-bounded                                            │
  ├────────────────┼────────┼─────────────────────────────────────────────────────────────────────────────────────────┤
  │ Wave B (6,7)   │ Sonnet │ wave2-selection.ts regex split + validateEngineeringSpec extension — careful but scoped │
  ├────────────────┼────────┼─────────────────────────────────────────────────────────────────────────────────────────┤
  │ 9-10           │ Sonnet │ Resume wiring + test harness                                                            │
  └────────────────┴────────┴─────────────────────────────────────────────────────────────────────────────────────────┘

  No Opus. Opus spent 105k tokens understanding the design. Implementation is execution.

  Practical execution

  Option A — Run it through Hub (dogfood, ironic, correct)
  File it as T3 (touches core workflow routing, cross-slice, 10+ files). Let it exercise the current pipeline, measure cost, compare to what the new routing would have done. You get a real
   data point AND the implementation.

  Option B — Run it here with Claude Code directly
  Worktree → single agent steps 1-3 → superpowers:dispatching-parallel-agents for waves A+B → single agent steps 9-10. Faster wall time, cheaper, you control the TDD discipline directly.

  My recommendation: Option B for the first pass. The plan is detailed enough that a Claude Code agent can execute it mechanically. Hub adds governance overhead that's warranted for
  features, less so for implementation of a core module where you want tight control over type consistency. Once it ships, the routing system can score future work — including improvements
   to itself — via the Hub.

  To kick it off

  /worktree fix/workflow-routing

  Then pass final-optimization-plan.md + the superpowers:executing-plans skill. The plan already has per-step ACs, file lists, and the #1178 test oracle — it's a complete build spec.

  One thing to decide first: do you want steps 1-3 done and reviewed before waves A/B fire, or trust the plan and let the full sequence run autonomously?