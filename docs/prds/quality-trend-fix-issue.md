Title
  Unify legacy fix-issue PRs with M19 quality-score lifecycle identity

  Problem
  Quality Trend only fills from run_quality_scores, which is written by the M19 merge-decision gate. The gate only runs when the
  approved PR lifecycle has a pipelineRunId.

  Today, PRs created by parallel-implement carry pipelineRunId, so QA/review/merge-decision can correlate the lifecycle. Legacy
  fix-issue PRs emit pr.opened without pipelineRunId, so even after QA, review, human approval, and merge, no deterministic
  quality score is persisted and Quality Trend stays empty.

  Goal
  Treat pipelineRunId as the delivery lifecycle id for both legacy fix-issue and parallel-implement, so all approved delivery PRs
  can be scored consistently when useMultiAgentPipeline is enabled.

  Non-Goals
  No historical backfill.
  No change to QA agent overallScore; Quality Trend remains based on deterministic M19 scoring.
  No bypass of human approval. The approve action remains human-triggered.

  Behavior
  When legacy fix-issue opens a PR:

  - Generate or assign a pipelineRunId for the lifecycle.
  - Include it in the pr.opened payload.
  - Ensure QA reads it from pr.opened and emits it on qa.completed.
  - Ensure review/convergent-review reads it from pr.opened and emits it on review.completed.
  - On approve, the existing M19 merge-decision gate sees the pipelineRunId, computes the deterministic score, emits merge-
    decision.completed, and persists run_quality_scores.

  Implementation Shape
  Primary change:

  - In slices/fix-issue/implement-phase.ts, add pipelineRunId to the pr.opened payload.
  - Prefer a separate crypto.randomUUID() lifecycle id near PR creation.
  - Acceptable simpler option: use runId/devRunId as the legacy pipelineRunId, but document that legacy single-dev lifecycles
    intentionally alias pipeline and dev run ids.

  Verify existing propagation:

  - slices/qa/qa-helpers.ts already reads pipelineRunId from latest pr.opened.
  - slices/qa/workflow.ts already includes it on qa.completed when present.
  - slices/review/workflow.ts and slices/review/convergent-review.ts already look up pipelineRunId from latest pr.opened.
  - apps/server/src/domains/issues/transitions.ts already runs merge-decision when pipelineEnabled && pipelineRunId != null.

  Acceptance Criteria

  1. A legacy fix-issue PR emits pr.opened with pipelineRunId.
  2. Subsequent QA for that PR emits qa.completed.payload.pipelineRunId.
  3. Subsequent review/convergent-review emits review.completed.payload.pipelineRunId.
  4. Approving the PR with useMultiAgentPipeline = 1 emits merge-decision.completed.
  5. Approving the PR persists one run_quality_scores row for the project.
  6. Quality Trend shows the new row after merge.
  7. Human approval remains required; this does not auto-merge without the approve action.

  Regression Tests
  Add or extend focused tests around the legacy path:

  - slices/fix-issue/slice.test.ts: assert pr.opened includes pipelineRunId.
  - slices/qa/slice.test.ts: legacy pr.opened with pipelineRunId results in qa.completed carrying the same id.
  - slices/review/slice.test.ts: legacy pr.opened with pipelineRunId results in review events carrying the same id.
  - apps/server/src/domains/issues/service.test.ts: approve path with legacy pr.opened.pipelineRunId calls/runs merge-decision
    and emits merge-decision.completed.

  Risk
  This intentionally changes behavior: legacy fix-issue PRs will now be subject to the M19 merge-decision gate when
  useMultiAgentPipeline is enabled. That is the desired outcome if Quality Trend should represent all delivery PRs, not only
  parallel-implement PRs.