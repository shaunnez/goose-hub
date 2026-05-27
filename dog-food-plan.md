# Handoff: Stabilize Goose Hub Dogfood End-to-End Completion

  ## Objective

  Use Goal mode to make Goose Hub dogfood issues complete end to end. Do not keep patching individual dogfood task outputs. Fix the underlying pipeline failure classes, reset the affected
  issues with the issue reset CLI, rerun them, monitor, and repeat until failures stop or a true product/task failure remains.

  ## Current Problem

  Dogfood issues are repeatedly failing in `implement-wp`, QA, and fix-feedback for infrastructure/process reasons rather than task-specific reasons.

  The main failure classes observed:

  1. `implement-wp` emits `BLOCKER` / `TOOL_FAILURE` too often.
  2. Agents choose brittle frontend test seams, fail tests repeatedly, then terminal-block.
  3. The final exact-file verification requirement can deadlock with the test retry guard.
  4. Regression-unrelated QA failures still launch repair loops.
  5. Prompt-copy/string tests are brittle and can make QA red for unrelated wording changes.
  6. Timeline/UI summarizes everything as `WP failed` / `Regression unrelated`, hiding the actionable category.

  Do not solve this by simply increasing or clearing retry limits. That hides the problem. The desired fix is better failure classification and better workflow behavior.

  ## Issues / Runs To Reset And Monitor

  Start with these known failing issues/runs:

  - `#1124`
    - `da3f8dfc-840e-4515-913f-87eec273417d:wp:WP2:iter:1`
    - Failed because exact-file rerun of `InvestigationSection.test.tsx` was blocked by retry cap after previous failures, despite later broader component test passing.

  - `#1129`
    - `c458341f-f204-4556-a67c-a9271c8e4717:wp:WP1:iter:2`
    - Failed because `ChatDock.test.tsx` failed repeatedly, then `implement-wp` emitted `BLOCKER`.

  - `#1131`
    - `e6a34ec1-4c93-4e1f-9316-3c10684fe47b`
    - QA regression failed on `skills/implement/slice.test.ts`.
    - Local repro showed brittle prompt-string assertion:
      expected `ship the implementation plus targeted tests`, prompt had `Ship the implementation plus targeted unit/component tests`.
    - Fix-feedback then launched and failed on Claude session limit, which should not have happened for baseline/prompt-contract regression.

  Also consider earlier related issues if needed:

  - `#1122`
  - `#1123`
  - `#1125`

  ## First Validation Before Any Reset

  Confirm current checkout and fast baseline:

  ```bash
  git status --short --branch
  git log -1 --oneline

  pnpm test core/workflows/timeline-sections.test.ts
  pnpm test apps/server/src/index.test.ts
  pnpm test slices/fix-issue/slice.test.ts
  pnpm test skills/implement/slice.test.ts -- -t "bounds frontend evidence discovery"

  If baseline is red, fix baseline first. Do not reset dogfood issues against a red base.

  ## Fast Event Inspection Query

  For any failed run:

  sqlite3 -header -column ~/.factory/data/factory.db "
  select id, kind, run_id, work_item_id, created_at, substr(payload,1,900) payload
  from events
  where run_id like '<RUN_ID>%'
     or payload like '%<RUN_ID>%'
  order by id;
  "

  For tool retry failures:

  sqlite3 -header -column ~/.factory/data/factory.db "
  select id, run_id, created_at,
         json_extract(payload,'$.reason') reason,
         json_extract(payload,'$.path') path,
         json_extract(payload,'$.consecutiveFailures') failures,
         json_extract(payload,'$.cap') cap,
         substr(json_extract(payload,'$.guidance'),1,200) guidance
  from events
  where kind='tool.violation'
    and run_id like '<RUN_ID>%'
  order by id;
  "

  ## Fix Priorities

  ### 1. Fix implement-wp Repeated Test Failure Behavior

  Current bad behavior:

  - Agent repeatedly runs same failing test.
  - Tool blocks after repeated failures.
  - Agent emits BLOCKER / TOOL_FAILURE.
  - WP fails even when this is ordinary implementation/test-seam friction.

  Desired behavior:

  - After the second same-path same-signature test failure, force a diagnosis step.
  - The agent must classify the failure before another test run:
      - product code not fixed
      - stale test expectation
      - bad jsdom/render harness
      - missing mock/provider
      - async timing issue
      - verification infrastructure
  - If no code/test edit occurred, another same-path run should be rejected with a clear structured reason.
  - If there was a real edit affecting the path or adjacent source, allow rerun.

  Do not just raise retry cap.

  ### 2. Fix Final Verification Deadlock

  Current bad behavior:

  - Prompt/acceptance requires exact written test file to pass after final edit.
  - Retry guard can block that exact-file rerun.
  - Broader directory suite may pass, but WP still fails.

  Desired behavior:

  - Exact-file pass remains preferred.
  - A passing parent directory/package test after the final edit should satisfy the written file when it covers that path.
  - If exact-file rerun is blocked only by retry guard, acceptance should report “covered by parent pass” if valid, not terminal-block.

  ### 3. Fix Regression-Unrelated Repair Routing

  Current bad behavior:

  - QA classifies regression-unrelated.
  - fix-feedback still launches in some cases.
  - Repair burns runtime or fails on model/session limits.

  Desired behavior:

  - If regression failure is baseline red or prompt-contract red, skip fix-feedback.
  - Transition to needs-human or a clearer infra/baseline state.
  - Emit agent.fix-feedback-skipped with reason:
      - baseline-red-global
      - prompt-contract-regression
      - verification-infrastructure

  ### 4. Fix Brittle Prompt Contract Test

  For skills/implement/slice.test.ts, do not rely on exact lowercase prose unless the exact phrase is a real contract. Prefer asserting stable section headings and semantic fragments.

  Example failure:

  - Test expected ship the implementation plus targeted tests.
  - Prompt had Ship the implementation plus targeted unit/component tests.

  This should not block dogfood.

  ### 5. Improve Timeline Classification

  The UI should distinguish:

  - brittle-test-seam
  - retry-cap-deadlock
  - verification-infrastructure
  - baseline-red
  - prompt-contract-regression
  - real task/product failure

  This is secondary to the workflow fixes, but useful for monitoring.

  ## Reset / Rerun Loop

  Use the reset CLI built for issue restart. If command shape is unclear, locate it first:

  pnpm goose --help
  rg -n "issue-restart|restart|reset" apps/cli slices/issue-restart

  Then for each issue:

  1. Reset issue to the appropriate workflow state.
  2. Start/restart dispatch.
  3. Watch timeline and DB events.
  4. If it fails:
      - classify exact stage: implement-wp, QA, review, fix-feedback
      - identify failure class from event rows
      - apply narrow fix
      - run focused tests
      - reset same issue
      - rerun

  ## Success Criteria

  Do not stop after one green unit test.

  Success means:

  - At least one previously failing WP issue gets through implement-wp without BLOCKER / TOOL_FAILURE.
  - A regression-unrelated baseline failure no longer launches a repair agent.
  - #1131 no longer fails QA on the brittle prompt assertion.
  - The same issue reset/rerun completes past the previously failing stage.
  - Event rows clearly show why any remaining failure occurred.

  ## Non-Goals

  - Do not fix the actual product tasks inside the dogfood issues manually.
  - Do not raise retry limits as the main fix.
  - Do not mark low-confidence WP output as successful just to get through the pipeline.
  - Do not keep creating prompt-only guidance unless backed by runtime/tool enforcement.