PRD: Canonical Acceptance Criteria And Executable QA Checks

  Problem

  Acceptance criteria are currently split across several producer shapes: PRD criteria, engineering spec criteria, acceptance-contract
  criteria, and issue-body checkbox criteria. They all describe the same product contract, but executable verification is inconsistently
  represented through verifyCommand, expected, and tolerance.

  This causes downstream ambiguity:

  - Review can judge criteria as met via review.criteriaChecks.
  - QA only emits criteriaResults when it gets fully shaped verify commands.
  - Command-only checks are lost.
  - Source priority can hide executable checks from lower-priority sources.
  - UI states can imply “ACs not satisfied” when the real issue is “no executable AC checks were recorded”.

  Product Decision

  There is one canonical acceptance criterion type.

  Some acceptance criteria have zero or more executable checks. Review judges every criterion. QA executes only executable checks. Non-
  executable criteria remain valid and are checked by Review/QA judgement, not command evidence.

  Canonical Contract

  type AcceptanceCriterionContract = {
    id: string;
    statement: string;
    sourceRef?: string;
    journeyRef?: string | null;
    stepIdx?: number | null;
    crossCutting?: boolean | null;
    executableChecks?: ExecutableCheck[];
  };

  type ExecutableCheck = {
    id: string;
    command: string;
    expectedExitCodes?: number[];
    outputExpectation?: {
      mode: 'exact' | 'contains' | 'regex';
      value: string;
    };
    timeoutMs?: number;
    kind?: 'unit' | 'integration' | 'e2e' | 'api' | 'lint' | 'typecheck' | 'custom';
  };

  Default behavior: if expectedExitCodes is omitted, [0] means pass.

  Non-Goals

  - No backfill or historical compatibility work.
  - No preserving old event payload semantics for prior runs.
  - No Goose Hub-specific command assumptions.
  - No requirement that every AC has an executable check.
  - No pretending Review criteria checks are QA command verification.

  Sequencing Assumption

  This PRD can be implemented after the other active PRDs in `docs/prds/` land.

  If `issue-event-stream.md` lands first:

  - Preserve the shared DetailPage event cache model.
  - Do not add a private Timeline or QA/Review EventSource.
  - Any new or changed QA executable-check events must be included in the shared issue event kind set when they are intended to
    render live.
  - If executable-check events are emitted separately from qa.completed, they must be normal Factory issue events and should not
    require a reload to appear.

  If `timeline.md` lands first:

  - Keep AC-related timeline cards compatible with the canonical timeline section model.
  - Map QA executable-check events to the QA section.
  - Map acceptance-contract events to the delivery-router section unless the landed workflow map chooses a more precise section.
  - Do not reintroduce ad hoc frontend grouping for AC events.

  If `quality-trend-fix-issue.md` lands first:

  - Preserve `pipelineRunId` propagation on `qa.completed.payload`.
  - When adding `criteriaResults` to `qa.completed.payload`, merge it into the existing payload rather than replacing the payload
    object or dropping `pipelineRunId`.
  - Keep review/convergent-review `pipelineRunId` lookup behavior intact.

  Expected conflict zones after those PRDs land:

  - `slices/qa/workflow.ts`
  - `skills/qa/schema.ts`
  - `skills/qa/skill.config.ts`
  - `skills/qa/prompt.md`
  - `apps/web/src/components/detail/components/QASection.tsx`
  - `apps/web/src/components/detail/components/ReviewSection.tsx`
  - timeline event kind / section mapping files introduced or changed by the event-stream and timeline PRDs.

  Architecture

  resolveAcceptanceContract returns the authoritative criteria contract for implementation and Review.

  Add resolveExecutableChecks or equivalent projection that extracts and merges executable checks from the resolved canonical criteria. If
  executable checks can come from multiple current sources in one workflow, merge them explicitly rather than relying on first-source
  priority.

  QA executable checks become workflow-owned:

  - The QA workflow runs each executable command in the worktree.
  - The workflow computes pass/fail from exit code and optional output expectation.
  - The workflow writes criteriaResults into qa.completed.payload while preserving existing payload fields such as pipelineRunId.
  - The QA agent receives those results as context and can add judgement/findings, but cannot override command truth.

  Review remains agent-owned:

  - Review receives the canonical acceptance contract.
  - Review emits one criteriaChecks[] entry per criterion.
  - Review checks every AC, including those without executable checks.

  Producer Changes

  write-prd should emit canonical acceptanceCriteria[]. It may include executableChecks only when grounded. Most PRD ACs should remain
  behavior statements.

  spec-author should emit canonical criteria with executable checks when it knows the verification command. Replace required bare
  verifyCommand with executableChecks. Keep the requirement that ACs are falsifiable, but allow falsifiability through executable checks,
  journey linkage, or clear Review judgement.

  acceptance-contract should emit canonical criteria. It should add executable checks only when investigation or project config grounds
  the command. Prefer repo-root commands. Do not invent test commands from file names alone unless project command patterns support that.

  decompose-issues should carry relevant canonical ACs into child issue bodies. If executable checks exist, include a stable markdown
  block under the checkbox, for example:

  - [ ] Criterion text
    Executable check:
    - Command: pnpm vitest run path/to/test.ts
    - Expected exit codes: 0
    - Kind: unit

  Issue-body parsing should parse that block into canonical criteria and executable checks.

  Consumer Changes

  Update context schemas for implement, implement-wp, qa, and review to accept canonical criteria with executableChecks.

  Update prompts:

  - Implementers treat criteria[] as the behavioral contract.
  - Implementers may use executable checks as targeted test guidance.
  - QA grades workflow-owned executable results and still checks non-executable ACs through diff/test/evidence review.
  - Review checks every criterion independently.

  Update UI DTOs and components:

  - Acceptance Contract display shows criterion statements and any executable checks.
  - QA section shows workflow-owned executable check results.
  - Review tab pipeline row is renamed from Acceptance criteria to Executable AC checks.
  - Review criteria coverage remains a separate checklist sourced from review.criteriaChecks.

  Implementation Plan

  1. Replace core AC types in core/acceptance-contracts/types.ts.
  2. Update issue-body parser to emit canonical criteria and executable checks.
  3. Update resolver normalization for PRD, engineering spec, normalized contracts, and issue body.
  4. Add workflow-owned executable check runner for QA.
  5. Persist criteriaResults directly on qa.completed.payload without dropping verdict, scores, tierResults, qualityScores,
     findings, testRun, deterministic, or pipelineRunId.
  6. Update QA schema/context/prompt to consume executable results, not own command truth.
  7. Update Review/Implement/Implement-WP schemas and prompts for canonical criteria.
  8. Update producer schemas/prompts: write-prd, spec-author, acceptance-contract, decompose-issues.
  9. Update server DTOs and web rendering.
  10. Update any landed event-stream/timeline mappings so executable-check events render live in the QA section.
  11. Remove old verifyCommand/expected/tolerance assumptions once all current consumers compile.

  Regression Tests

  - Resolver normalizes each producer source into canonical ACs.
  - Issue-body parser handles executable check markdown blocks.
  - Command-only executable checks default to exit code 0.
  - QA workflow runs executable checks and stores criteriaResults on qa.completed.
  - QA completed payload preserves pipelineRunId when pr.opened provided one.
  - QA agent context receives executable check results.
  - Review receives canonical criteria and emits one criteriaChecks entry per criterion.
  - Implement and Implement-WP context schemas accept canonical ACs.
  - Review UI distinguishes executable AC checks from Review criteria checks.
  - If the shared issue event stream and canonical timeline sections have landed, executable-check events appear live under QA
    without a reload.
  - API-only/e2e/custom command examples validate without UI assumptions.

  Acceptance Criteria

  - One canonical AC type is used across PRD, spec-author, acceptance-contract, issue-body parsing, implement, QA, Review, and UI DTOs.
  - QA executable check results are workflow-owned and persisted in qa.completed.payload.criteriaResults.
  - QA completed payload remains compatible with the quality-trend lifecycle identity work by preserving pipelineRunId.
  - Review still checks every AC, including criteria with no executable checks.
  - Projects with no UI, API-only tests, e2e tests, or custom commands are supported through command metadata, not special AC types.
  - Old verifyCommand-centric behavior is removed from active code paths.
