# M8 handoff — for the next Claude session

This doc is the entry point when you start work on M8 ("QA and Review Holdouts"). Read it before touching any M8 issue.

## State as of M7 close

**Active milestone (per `CLAUDE.md`):** still says `M5: Real Triage and Repo Matching` — that line is stale. The human needs to update it to `M8: QA and Review Holdouts`. Until they do, the `gh issue list --milestone "M8: QA and Review Holdouts"` query is the source of truth.

**M7 status:** all 22 M7 issues shipped and merged across PRs #237, #238, #250. Three follow-up items from the M7 exit audit are addressed in the same PR as this handoff: ADRs 0012/0013 written, README updated, slice imports migrated to `@goose-hub/skills/*` alias, PLAN §6 updated to reflect actual workflow placement.

**M7 audit verdict:** `KEEP-OPEN`. The single hard-fail is Check 2 (headline exit criterion not yet demonstrated). The chore-shipping path is wired and tested with mocked deps; a real Claude-driven run on a `type:chore` issue still needs to be performed by a human before M7 can be closed. The follow-up is filed as `M7.exit: real chore-shipping demo run`.

## What M8 is

PLAN §28 M8 in one sentence: **sequential QA → Review runs after the developer opens a PR, both as holdouts (fresh context, no implementation reasoning), gating `factory:approved`.**

Read these in order before starting M8 work:
1. `CLAUDE.md` — agent rules, especially holdout discipline
2. `docs/PLAN.md` §28 M8 — full scope + exit criteria
3. `docs/standards/verification.md` — three-tier framework + 8-category rubric (this is what `skills/qa/` implements)
4. `CONTEXT.md` "Context Assembly and Holdout Enforcement" — the contract `skills/qa/` and `skills/review/` must satisfy
5. `docs/adr/0012-advisor-wrapping-and-typed-timeouts.md` — pattern `run-qa.ts` and `run-review.ts` should follow
6. `docs/adr/0013-github-connectors-and-fix-issue-workflow.md` — the workflow shape M8 extends (#244)

## Issue picking order (filed and ready)

The CLAUDE.md "lowest schedule:current with no unmet open deps" algorithm picks them in this order. They're all currently `schedule:next` — the human flips to `schedule:current` when M8 starts.

1. **#239** `skills/qa/` — full QA holdout skill
2. **#240** `skills/review/` — full Review holdout skill (depends on #239)
3. **#241** Holdout enforcement at runtime layer (`contextAllowlist` + `freshContext`) — independent
4. **#242** `run-qa` workflow (depends on #239 + #241)
5. **#243** `run-review` workflow (depends on #240 + #241 + #242)
6. **#244** Update `fix-issue` to transition to `factory:needs-qa` instead of `factory:approved` (depends on #242)
7. **#245** Retry-and-escalate for `factory:qa-failed` / `factory:needs-fix` (depends on #242 + #243)
8. **#246** Fallback policy: no down-tier on holdouts (depends on #241)
9. **#247** QA tab UI (depends on #242 + #239)
10. **#248** Review tab UI (depends on #243 + #240)
11. **#249** Holdout boundary test — adversarial `tool.violation` proof (depends on #241 + #242 + #243)

Recommended grouping for PR efficiency (mirrors how M7 was shipped):
- **PR A (foundation):** #241 (runtime), #239 (QA skill), #240 (Review skill), #246 (fallback policy)
- **PR B (workflow chain):** #242 (run-qa), #243 (run-review), #244 (fix-issue update), #245 (retry), #249 (boundary test)
- **PR C (UI):** #247, #248

## What you must NOT do

- **Modify governance files.** `MISSION.md`, `FACTORY_RULES.md`, `CLAUDE.md`, `target-projects/**`. The active-milestone line in `CLAUDE.md` is stale; recommend the human update it but do not edit it yourself (FACTORY_RULES rule 12).
- **Bypass holdout discipline.** If you find yourself wanting to pass `decisionSummaries` to a QA spec for "convenience," stop — that defeats the entire M8 purpose (FACTORY_RULES rule 1, CONTEXT.md "Context Assembly").
- **Run advisor on QA or Review.** FACTORY_RULES rule 20. Holdouts are unconditionally non-advised.
- **Down-tier fallback on holdouts.** FACTORY_RULES rule 23. On primary failure, escalate to `factory:needs-human`. #246 enforces this.
- **Create new heavyweight dependencies.** No vector DB, no embedding service. Reuse existing `core/` primitives.
- **Skip the slice-test discipline.** Every new slice ships with `slice.test.ts` + `README.md`.

## Patterns from M7 that M8 should follow

- **Workflow shape:** copy `slices/fix-issue/workflow.ts` as the structural template. Same DI parameter for `runtime`/`adviseOnPlanImpl`/etc., same try/catch around the lifecycle, same `agent.decision-summary` per-summary emission via the `agent-runtime/advisor.ts` pattern.
- **Skill imports use the workspace alias:** `@goose-hub/skills/<name>/schema.js` (NOT `../../skills/<name>/schema.js`). The tsconfig path is set up.
- **Connector decoupling:** new connectors live in `core/connectors/<provider>/`. They are stateless functions, do not call `transitionState` themselves.
- **Event kinds:** add new kinds to `core/event-stream/store.ts` `EventKind` union, then write a round-trip test in `core/event-stream/store.test.ts`.
- **Standards doc as contract:** `docs/standards/verification.md` defines the three tiers and the 8-category rubric. `skills/qa/` implements it. New standards docs go under `docs/standards/`.

## Risks specific to M8

1. **`docs/standards/verification.md` was written without QA in hand.** When implementing `skills/qa/`, you may discover the doc is wrong about the cost profile, the rubric weights, or the tier sequencing. Update the doc as part of #239's PR if so. The doc is mutable.
2. **Holdout fresh-context test (#249) is adversarial.** You're asserting that the runtime drops `devDecisionSummaries` from the rendered XML even when the caller tries to inject it. The current `assembleSpawnContext` (`core/agent-runtime/context-assembly.ts`) filters by `contextAllowlist` — confirm that's airtight before calling #249 done.
3. **Workflow update #244 is a one-line transition target change** but `slices/fix-issue/chore-shipping.test.ts` asserts the transition order. Update both.
4. **Retry counter (#245) needs a storage location.** Per the issue body, `project_state` or `agent_runs`. Pick one in the PR, document in the README.

## Manual M7 demo still required

Before M8 closes (or before M7 closes per the audit), a real Claude-driven `fix-issue` run on a `type:chore` issue must land a merged PR. The recipe:

1. **Auth.** Pick one:
   - **Pro/Max OAuth (recommended for local dev):** make sure `claude login` has succeeded recently — the runtime forwards `USER` + `TMPDIR` to the subprocess so it can read keychain creds (see CONTEXT.md "Spawn mechanism"). Nothing else needed for Claude.
   - **API-key billing:** set `ANTHROPIC_API_KEY` in `.env`. The runtime forwards it to the subprocess only when present (`core/agent-runtime/claude-cli.ts:144`).
2. **Set `GITHUB_TOKEN`** in `.env` — required by `openPR` and `mergePR` (no OAuth path for these).
3. Pick or file a small `type:chore` issue (e.g. "rename a constant in `core/utils/`").
4. Label it `factory:dev-ready`.
5. Trigger the workflow via webhook (label flip) or directly: `pnpm tsx -e "import { runFixIssueWorkflow } from './slices/fix-issue/workflow.js'; …"`.
6. Watch the timeline for `pr.opened`, `agent.implement-complete`, `evidence.posted` (or `evidence.no-spec-declared`).
7. Open the PR in GitHub, click Approve in the gate UI, confirm `pr.merged` event.
8. Attach the merged PR URL + the timeline events to issue `M7.exit: real chore-shipping demo run` as evidence.

## Outstanding M7 follow-ups (filed but not done)

- **M7.exit:** real chore-shipping demo run (above)
- **M7.adr:** ADRs 0012 + 0013 (✅ done in PR #251)
- **M7.docs:** README + PLAN §6 updates (✅ done in PR #251)
- **M7.skills-alias:** slice imports via `@goose-hub/skills/*` (✅ done in PR #251)
- **M7.bug:** `prHeadSha` placeholder in `slices/fix-issue/workflow.ts` — actual SHA from `git rev-parse HEAD` (✅ done in PR #253)
- **CLAUDE.md milestone marker:** flipped M5 → M8 (✅ done in PR #252)

## When M8 issues are exhausted

Run the exit audit per `docs/exit-audit.md`. Generic checks plus PLAN §28 M8 specific criteria:

- "QA + Review run sequentially after Dev"
- "Holdout enforcement test passes" (this is #249)
- "Fallback policy enforced: no down-tier on holdouts"
- "Retry logic: factory:qa-failed and factory:needs-fix count toward maxRetries; fix runs are fresh-context"
- "deliberately-broken implementation cycles needs-fix twice then ends in factory:needs-human"

The audit is strict on Checks 1, 2, 5, 6, 9, 12 — those are hard exits. The others (Check 7 ADR coverage, Check 11 README freshness) are FOLLOW-UP-NEEDED at worst. Run them mechanically; the format is in `docs/exit-audit.md`.
