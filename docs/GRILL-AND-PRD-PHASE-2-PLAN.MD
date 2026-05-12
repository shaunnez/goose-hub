# Phase 2 Implementation Plan: Deepen `grill-and-prd`

  ## Summary

  Refactor `runGrillAndPrdWorkflow` into a thin coordinator while preserving existing Discover-Lane behavior exactly: one workflow call advances one grill round, `factory:grilling`/`factory:gate-
  pending` behavior stays unchanged, worktree cleanup remains guaranteed, and crystallization ordering from ADR 0034 remains intact.

  Implement in four PR-sized steps. Each step keeps the existing slice test passing before moving to the next.

  ## Key Changes

  ### 1. Extract Managed Worktree Lifecycle

  Create `core/workflows/grill-and-prd/worktree-lifecycle.ts`.

  Add `withManagedWorktree`, which:
  - Expands `~/` in `repoPath`.
  - Creates the worktree before calling `body`.
  - Always attempts cleanup in `finally` after successful create.
  - Reports cleanup failure through `onCleanupError(error)`.
  - Does not swallow create failures.
  - Does not clean up when create fails.

  Keep workflow-specific recovery in `grill-and-prd.ts`: missing repo path comments, state transitions, and create-failure comments stay in the coordinator.

  ### 2. Extract Grill Round Module

  Create `core/workflows/grill-and-prd/grill-round.ts`.

  Add `runGrillRound`, which:
  - Calculates `roundNumber`.
  - Uses `invokeSkill('grill-me')` with `workspaceDir`.
  - Maps output validation failures to `invalid`.
  - Maps other thrown errors to `failed`.
  - Preserves current round-8 hard cap behavior.
  - Treats `readyForPRD:false` with no usable question as `invalid`.
  - Performs no comments, state transitions, or event writes.

  Coordinator remains responsible for persistence and side effects.

  ### 3. Extract PRD Draft and Advisor Review

  Create:
  - `core/workflows/grill-and-prd/prd-draft.ts`
  - `core/workflows/grill-and-prd/advisor-review.ts`

  `runPrdDraft` should own `write-prd` invocation and output validation.

  `runAdvisorReview` should own:
  - advisor priority gating
  - advisor budget gating
  - `advise-on-prd` invocation
  - shallow merge of revised sections

  Both modules should use `invokeSkill`.

  Final PRD comment posting and `factory:prd-review` transition stay in the coordinator.

  ### 4. Collapse Coordinator

  Reduce `runGrillAndPrdWorkflow` to orchestration only:
  - validate entry state
  - resolve project config/context
  - handle `skipGrill`, revise mode, and normal grill mode
  - call phase modules
  - own durable side effects: comments, state transitions, event emission, decision-summary reconciliation

  ## Test Plan

  Run after every PR:

  ```sh
  pnpm vitest run slices/grill-and-prd/slice.test.ts

  Add focused tests for:

  - worktree lifecycle cleanup behavior
  - grill round outcomes and round-8 cap
  - PRD draft normal/revise context
  - advisor skip/run/merge behavior
  - invalid output vs runtime failure mapping

  Keep slices/grill-and-prd/slice.test.ts as the behavior contract.

  ## Acceptance Criteria

      - one call advances one round
      - factory:gate-pending parking behavior remains
      - skipGrill jumps directly to write-prd
      - revise mode skips grill
      - cleanup happens on all post-create exits
      - crystallization ordering is unchanged
      - final PRD comment shape is unchanged
  - grill-me, write-prd, and advise-on-prd use invokeSkill.
  - Existing slice test and new focused tests pass.

  ## Assumptions

  - Do not change state-machine legal transitions.
  - Do not change event names, PRD comment format, or issue comment markers.
  - Do not migrate unrelated workflows.
  - Do not remove direct runtime.run() support elsewhere.
  - Prefer behavior-preserving extraction over adjacent cleanup.