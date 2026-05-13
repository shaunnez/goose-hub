Read docs/superpowers/plans/2026-05-13-dev-phase-timeline-spec-ui.md.

  6 tasks, dependency order:
  1. timeline.ts — add 8 dev-review labels (prerequisite for Task 2)
  2. DevReviewEvents.tsx — 8 new components
  3. TimelineEvents.tsx — wire dev-review.* switch cases
  4. timeline.ts + PhaseGroupWrapper.tsx — phase-group RenderItem, groupByDevPhase(), wrapper component
  5. Server — getIssueSpec() service + GET /:slug/issues/:id/spec route + test
  6. Web — EngineeringSpecDto types, fetchEngineeringSpec, SpecDetails.tsx, InvestigationSection wiring

  Tasks 1–4 (timeline work) and 5–6 (spec API/UI) are independent of each other and can run in parallel.