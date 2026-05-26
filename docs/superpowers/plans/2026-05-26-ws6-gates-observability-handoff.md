# WS6 Gates + Workflow Observability Handoff

Date: 2026-05-26

## Current State

WS5 is implemented and merged:

- PR: https://github.com/shaunnez/goose-hub/pull/1061
- Head commit at merge: `45a11faf`
- Branch used: `codex/ws5-qa-contract-routing`
- Worktree used: `.worktrees/ws5-qa-contract-routing`

WS5 delivered the QA/spec/fix-feedback foundation WS6 should build on:

- explicit QA/review finding dispositions: `needs-fix`, `out-of-scope`, `follow-up`, `fixed`
- shared QA actionability helper in `core/qa/actionability.ts`
- structured executable check evidence via `evidenceExpectation` / `evidenceArtifact`
- `requiredExports` enforcement for spec interface contracts
- `orchestratorCommitAll()` no-empty-commit behavior
- QA tab evidence rendering
- `agent.fix-feedback-skipped` event kind, label, and timeline classification

The old `registered` disposition is intentionally unsupported. Do not add legacy backfill unless the product direction changes.

## Readiness

We are ready to start WS6 only as a read-first planning pass. The original reliability plan explicitly says WS6 is not implementation-ready from the umbrella document. The next agent should inspect the live code paths, define the event/routing contract, then write a focused WS6 implementation plan before coding.

Do not start by editing gate routing or timeline UI directly.

## Verification State

Local WS5 verification passed after review fixes:

- `pnpm test skills/qa skills/review slices/qa/slice.test.ts slices/fix-feedback/slice.test.ts slices/review/slice.test.ts core/qa core/verify core/workspaces core/test-runner`
- `pnpm test apps/web/src/components/detail/components/QASection.test.tsx apps/web/src/components/detail/components/ReviewSection.test.tsx apps/web/src/components/detail/components/SpecDetails.test.tsx apps/server/src/domains/issues/service.test.ts apps/web/src/components/detail/lib/timeline.test.ts apps/web/src/components/detail/components/TimelineSection.test.ts`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm manifest --check`
- `git diff --check`

Repo-wide `pnpm test` still has known baseline failures unrelated to WS5:

- `core/workflows/timeline-sections.test.ts`: `dogfood.seed-applied` lacks timeline classification
- `slices/dogfood/slice.test.ts`: `logger-001-drop-meta` seed is already applied
- `apps/web/src/lib/logger.test.ts`: logger meta is not passed as the third console arg

CI on PR #1061 showed the same general state: governance/manifest/lint/typecheck passed after the manifest refresh, while the combined test job failed during the full test step. The PR is already merged.

## WS6 Goal

WS6 covers F9 + F12 from the reliability plan:

- unresolved dev-review blockers must not advance into PR/QA/review as if the issue is healthy
- workflow-health facts should be first-class events and visible in the timeline
- timeline should distinguish product failures, spec-contract failures, orchestration failures, budget kills, persistence failures, and orphaned work

The high-level target from the umbrella plan remains:

> Unresolved dev-review blockers never advance; first-class workflow-health signals.

## Read First

Read these files before writing the WS6 plan:

- `docs/superpowers/plans/2026-05-25-goose-hub-agent-reliability.md`, WS6 section
- `core/event-stream/kinds.ts`
- `core/workflows/timeline-sections.ts`
- `apps/web/src/components/detail/lib/timeline/`
- `apps/web/src/components/detail/components/TimelineEvents.tsx`
- `apps/web/src/components/detail/components/timeline/`
- `apps/web/src/components/detail/lib/timeline.test.ts`
- `slices/parallel-implement/workflow.ts`
- `slices/parallel-implement/slice.test.ts`
- `skills/dev-review-response/`
- `slices/fix-feedback/workflow.ts`
- `slices/qa/workflow.ts`
- `slices/review/workflow.ts`
- `apps/server/src/shared/dispatch-dev.ts`
- `apps/server/src/shared/dispatch-qa-review.ts`
- `apps/server/src/shared/dispatch-routing.ts`

Search terms that should produce the relevant paths:

- `dev-review-response`
- `maxRevisionTurns`
- `redundant-read`
- `runDisposition`
- `agent.run-completed`
- `agent.run-failed`
- `parallel-implement.wp-persisted`
- `gate.awaiting-human`
- `factory:needs-review`
- `factory:needs-qa`
- `factory:qa-failed`
- `agent.fix-feedback-skipped`

## Contract Decisions To Make First

Write a small WS6 plan that settles these before implementation:

1. `runDisposition` enum

   Proposed starting enum from the umbrella plan:

   - `completed`
   - `budget-killed`
   - `orphaned-restart`
   - `blocked-gate`
   - `persistence-failed`

   Decide which events carry it, likely `agent.run-completed` and `agent.run-failed`, and whether older consumers tolerate it as optional metadata.

2. WP persistence event

   Proposed event:

   - `parallel-implement.wp-persisted`

   Decide exact payload shape. It should be useful for WS3/WS4 and the timeline, not only display text.

   Minimum likely fields:

   - `wpId`
   - `commitSha`
   - `branch`
   - `baseBranch`
   - `worktreePath`
   - `status`
   - `reason`

3. QA failure category

   Proposed categories:

   - `product`
   - `spec-contract`
   - `regression-unrelated`
   - `orchestration`

   WS5 already produces actionability and evidence artifacts. WS6 should classify why QA failed without reintroducing stdout truth or out-of-scope repair loops.

4. Dev-review gate semantics

   Define exactly when unresolved dev-review blockers prevent advancement.

   Key question: if `dev-review-response` times out, aborts, or produces no commit, does the item go to `factory:needs-human`, stay `factory:in-progress`, or become a gate-pending state/event?

5. Timeline presentation contract

   Decide which events are:

   - direct timeline events
   - runtime-inherited events
   - intentionally system-only
   - hidden

   Every new visible event must be classified in `core/workflows/timeline-sections.ts` and labelled in `apps/web/src/components/detail/lib/timeline/labels.ts`.

## Suggested WS6 Implementation Slices

Keep WS6 narrow and TDD-driven. A reasonable sequence:

1. Event contract tests

   Add/extend tests around `core/event-stream/kinds.ts`, `core/workflows/timeline-sections.test.ts`, and timeline labels before adding event kinds.

2. Dev-review blocked-gate routing

   Add a failing workflow test that reproduces the confirmed problem: dev-review reports blockers, `dev-review-response` fails or times out, and the workflow must not advance to PR/QA.

3. Runtime/run disposition metadata

   Add optional `runDisposition` emission where the runtime/orchestrator can truthfully know it. Keep compatibility by treating the field as optional in UI/read-models.

4. WP persistence event presentation

   Add the event kind and timeline card/summary only after its payload contract is defined.

5. QA failure category display

   Extend QA completion payload/read-model/UI with failure category badges, using WS5 actionability/evidence as inputs.

6. End-to-end timeline regression

   Add timeline tests proving a run can show:

   - persisted commit vs no persisted commit
   - blocked gate vs normal completion
   - product QA failure vs spec-contract/orchestration QA failure

## Guardrails

- Preserve WS5 semantics: out-of-scope and verified follow-up findings do not trigger fix-feedback.
- Do not restore stdout `outputExpectation` enforcement.
- Do not support `registered` as a live disposition unless explicitly asked.
- Do not invent event shapes inside WS3/WS4 that conflict with WS6. If WS3/WS4 start first, define the minimal WS6 event subset first.
- Keep timeline summary-only where the existing timeline architecture expects summaries; put deep QA detail in the QA tab.
- Run `pnpm manifest --check` after adding any new top-level package/slice directory.

## Known Baseline Issues Not To Mix Into WS6

These are real, but not WS6 unless the user explicitly expands scope:

- dogfood seed/logger baseline failures listed above
- repo-wide `pnpm test` red due to those baseline failures
- old database/event backfill for pre-WS5 disposition payloads

## Recommended Next Prompt

Use this to start WS6:

```text
Create the focused WS6 Gates + Workflow Observability implementation plan from the handoff.
Read the listed files first. Do not change code yet.
Define the runDisposition, wp-persisted, QA failure category, and dev-review blocked-gate contracts.
Then give me the final TDD plan for approval.
```

