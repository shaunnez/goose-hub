# M19 Repair Plan

Goal: take 3-of-12-wired → 12-of-12-wired. One issue per PR. Order enforces dependency unblocks. Each item maps to single GitHub issue.

---

## Phase 0 — Prerequisites (none, runs first)

### P0.A — Dispatcher feature flag

Reason: phased rollout, avoid big-bang cutover.

- Add `agentConfig.experimental.useM19Pipeline: boolean` to `core/types.ts`.
- Default `false` everywhere except `target-projects/goose-hub-self/project.config.ts` which can flip to `true` after Phase 2 lands.
- Read in dispatcher entry points only.

Acceptance:
- [ ] Type field added.
- [ ] Default false in schema.
- [ ] `goose-hub-self` config still defaults false (flip later).

---

## Phase 1 — Producers (unblocks the chain)

### P1.A — Wire spec-author (M19.02)

Files:
- New node in `slices/spec-author/workflow.ts` (slice may need creating; check existing scaffold).
- Caller: new branch in dispatcher gated by `experimental.useM19Pipeline`.
- Persistence: write `slices/<n>/spec.json` to workspace.

Steps:
1. Create `slices/spec-author/workflow.ts` exposing `runSpecAuthorWorkflow(workItem, stateSource, slug, repoRef)`.
2. Workflow: load scout reports if present (M19.01 dependency — fall back to manual mode initially), call `runtime.run({skill: 'spec-author'})`, validate output via `validateEngineeringSpec`, persist to workspace `<workspace>/spec.json`.
3. Dispatcher: when `factory:dev-ready` AND `useM19Pipeline === true` → call `runSpecAuthorWorkflow` then transition to `factory:spec-ready` (new state).
4. Add `factory:spec-ready` to `core/state-machine/`.

Acceptance:
- [ ] Spec written to `slices/<n>/spec.json` on workspace.
- [ ] State transitions `factory:dev-ready` → `factory:spec-ready` when flag on.
- [ ] Validation rejection routes to `factory:needs-human` with comment.
- [ ] Tests: golden spec, validation failure, fallback (no scout reports).

### P1.B — Wire parallel-implement (M19.03)

Files:
- `apps/server/src/shared/dispatch.ts:951-952`.
- Read `spec.json` from workspace.

Steps:
1. New dispatcher branch: when `factory:spec-ready` → call `runParallelImplementWorkflow(workItem, stateSource, slug, spec)`.
2. Read spec from workspace `slices/<n>/spec.json`; if missing, escalate `factory:needs-human`.
3. Remove dead `cleanupIssueWorktreeImpl` finally branch OR implement merge handler (`workflow.ts:692-697`).
4. Add merge-listener that runs `cleanupAllWpWorktrees` when PR merges (state-source webhook or polling node).

Acceptance:
- [ ] `factory:spec-ready` → `runParallelImplementWorkflow` invoked.
- [ ] Workspace cleanup on PR merge confirmed by integration test.
- [ ] Legacy `dispatchFixIssue` path remains for projects with flag off.
- [ ] E2E: 3-WP spec → 3 concurrent builders → 1 PR with per-WP commits.

---

## Phase 2 — Holdouts and quality (depends on P1)

### P2.A — Wire convergent review (M19.04)

Files:
- `apps/server/src/shared/dispatch.ts:481-497`.
- `apps/server/src/domains/workflows/review-batch.ts:11-27`.
- `slices/review/workflow.ts` (prompt override logic).

Steps:
1. Swap dispatcher import: `runReviewWorkflow` → `runConvergentReviewWorkflow` when `useM19Pipeline === true`.
2. Implement actual unconstrained-prompt override: load `skills/review/prompt.unconstrained.md` (NEW) for reviewer B; reviewer A uses default. The override strips scope guidance.
3. `dispatchReviewWave` reads which prompt per slot; passes correct `appendSystemPrompt`.
4. Update tests in `slices/review/slice.test.ts` to assert reviewer B receives unconstrained prompt.

Acceptance:
- [ ] Convergent path reachable from dispatcher when flag on.
- [ ] `skills/review/prompt.unconstrained.md` exists and differs materially from `prompt.md` (no "scope" guidance).
- [ ] Reviewer A and B receive different `appendSystemPrompt` strings.
- [ ] Holdout context boundary preserved for both.
- [ ] Auth-topic min-rounds = 3 still honoured.

### P2.B — Wire investigation swarm (M19.01)

Files:
- `slices/investigate/workflow.ts:63-85`.
- `skills/investigate/prompt.md:21` (remove self-admission).
- `slices/investigate/slice.test.ts`.

Steps:
1. Replace single `runtime.run({skill:'investigate'})` with:
   a. Wave 1: `dispatchWave({ skills: ['scout-schema', 'scout-code-path', 'scout-pattern', 'scout-test-inventory', 'scout-dependency', 'scout-user-journey'], ...})`.
   b. `crossValidate(waveResults)` — compare findings, surface contradictions.
   c. Wave 2: `dispatchWave({ skills: ['wave2-interface-designer', 'wave2-risk-analyst'], context: <wave1 synthesized> })`.
   d. Synthesis call: feeds Wave 2 outputs to investigate skill in single-agent mode for final report.
2. Update `skills/investigate/prompt.md`: remove "not yet wired" admission, document the swarm flow.
3. Spec output of synthesis call as required input to spec-author (creates dependency on P1.A which falls back if missing).

Acceptance:
- [ ] Workflow calls `dispatchWave` twice + `crossValidate` once.
- [ ] Integration test 1: cross-validate surfaces contradiction (force two scouts to disagree).
- [ ] Integration test 2: scout timeout → killed agent → workflow continues with partial.
- [ ] Integration test 3: 2 scout failures → escalate `factory:needs-human`.
- [ ] Integration test 4: holdout-key in scout context throws `tool.violation`.
- [ ] Existing single-agent tests removed or rewritten.

### P2.C — Reconcile quality scoring (M19.08)

Decision required first: kill `core/quality-score` OR wire it as aggregate alongside QA-embedded scores.

Recommended: **wire as cross-run aggregate** — QA score is per-run gate; `computeQualityScore` is per-run quality with convergence detection across history. Different concerns.

Files:
- `core/retrospective/schemas.ts:94` (already has optional field).
- `slices/retrospective-deep/workflow.ts` and `slices/retrospective-light/workflow.ts`.
- `apps/server/src/domains/roster/service.ts:59` (remove hardcoded null).

Steps:
1. Retro workflows: build `RunArtifacts` from event stream after run completes; call `computeQualityScore(artifacts)`; populate `RetroOutput.qualityScore`; persist via `persistRunQualityScore`.
2. Roster service: replace `qualityScore: null` with `listRunQualityScores(personaId)` lookup.
3. Auto-merge gate: in `slices/parallel-implement/workflow.ts` PR-open node, call `isConverged(history)` and `score >= 80` check; if not, route to `factory:needs-human`.
4. Document divergence between QA `overallScore` (per-run gate) and `quality_score` (per-run+convergence) in CONTEXT.md.

Acceptance:
- [ ] `run_quality_scores` table receives writes during retro runs.
- [ ] `QualityTrendTab` shows non-empty data after a run cycle.
- [ ] PR auto-merge gate blocks on `score < 80` OR `!isConverged`.
- [ ] CONTEXT.md entry distinguishes the two scoring streams.

---

## Phase 3 — Audit + tooling (depends on P2.A wiring + P1.B path live)

### P3.A — Wire code-quality-audit skill (M19.07)

Files:
- `target-projects/goose-hub-self/project.config.ts` — register auditor role.
- `slices/retrospective-deep/workflow.ts` — invoke audit on priority:high or nightly.
- `slices/review/workflow.ts` (or convergent variant) — invoke audit on priority:high PR review.
- `core/quality-score/repository.ts` — write `audit_score` column.
- `core/improvement-candidates/` (or wherever ImprovementCandidate emission lives).
- `apps/web/src/components/roster/components/QualityTrendTab.tsx` — add `architecturalQualityScore` series.

Steps:
1. Add `auditor` to `goose-hub-self/project.config.ts` with budgets/persona.
2. Conditional invocation in deep retro: if `priority:high` label OR scheduled nightly → run `skill: 'code-quality-audit'`, persist output.
3. Conditional invocation in convergent review: same condition → audit runs in parallel branch (NOT replacing review reviewers).
4. Persist `audit_score` to `run_quality_scores`.
5. Emit ImprovementCandidate from convergent (top-3) recommendations.
6. Autonomous-mode gate: if `audit_score < 60` AND `mode === 'autonomous'` → `factory:needs-human`.
7. UI: new chart series in QualityTrend chart.

Acceptance:
- [ ] `auditor` registered in `goose-hub-self/project.config.ts`.
- [ ] Priority:high PR triggers audit (test).
- [ ] Nightly trigger configured (cron/scheduler entry).
- [ ] `audit_score` rows written.
- [ ] ImprovementCandidate emitted from top-3 (test against fixture).
- [ ] Autonomy gate fires on `audit_score < 60` (test).
- [ ] UI series renders.

### P3.B — Expose record-decision tool (M19.06)

Files:
- `core/tool-layer/mcp-server.ts` (or equivalent agent-tool exposure layer).
- `skills/*/skill.config.ts` — add `decision-record-only` bundle to relevant skills.
- `core/agent-runtime/end-of-run.ts` — wire `readRunDecisions` reconciliation.

Steps:
1. Expose `recordDecision()` as MCP tool (or whichever runtime tool-bridge mechanism). Validate input matches schema.
2. Add `'decision-record-only'` to `toolBundles` in: implement-wp, implement, investigate, spec-author, dev-review, retrospective-deep. NOT in qa/review/code-quality-audit (holdouts strip it anyway, but explicit is clearer).
3. End-of-run reconciliation: in `core/agent-runtime/runtime.ts` (or wherever `agent.run-completed` fires), call `readRunDecisions(runId)`. If rows exist, emit `agent.decision-summary` events from DB rows; fall back to schema-field decisionSummaries when empty.
4. Gate on `experimental.recordDecisionTool`.
5. Pass iteration + phase from run context (`runtime.run({ iteration, phase })` → tool wrapper closure).

Acceptance:
- [ ] Live agent can call `record_decision` (integration test).
- [ ] Holdout roles cannot (test).
- [ ] End-of-run reconciliation prefers DB rows over schema field when both present.
- [ ] Iteration + phase metadata captured in DB during a real run.
- [ ] Flag gate respected.

---

## Phase 4 — Codex finishing (depends on P1.B live)

### P4.A — Codex hook normalisation (M19.10)

Files:
- `core/agent-runtime/codex-cli.ts` (around `deployHooks`).
- New `core/agent-runtime/codex-hook-normalize.ts`.

Steps:
1. Map Codex tool taxonomy → internal Pre/PostToolUse event shape (parity with Claude hooks).
2. Inject normalisation in spawn path before event emission.
3. Replace `it.skip` integration test (`slices/codex-runtime/slice.test.ts:464`) with `describe.skipIf(!liveOk)` where `liveOk = existsSync(~/.codex/auth.json) || !!OPENAI_API_KEY`.

Acceptance:
- [ ] PreToolUse + PostToolUse events from Codex match Claude payload keys.
- [ ] Conditional live-test runs locally with auth present, skips in CI without.
- [ ] Tool-call audit stream homogeneous across providers.

### P4.B — Wire dev-review opt-in (M19.12)

Files:
- `target-projects/goose-hub-self/project.config.ts`.
- `slices/parallel-implement/workflow.ts` (counter for `maxRevisionTurns` if keeping).

Steps:
1. Add to `goose-hub-self` config:
   ```ts
   devReview: {
     enabled: true,
     triggerOn: ['priority:medium', 'priority:high'],
     maxRevisionTurns: 1,
     perCycleMaxUsd: 2.00,
     timeoutMs: 600_000,
   }
   ```
2. Decide `maxRevisionTurns`: either implement counter (track revision turns in run state, skip dev-review-response after N) OR remove field. Recommended: remove — current "by code shape" cap is sufficient and clearer.
3. If keeping: counter in workflow loop; assertion in test.

Acceptance:
- [ ] `goose-hub-self` opts in.
- [ ] `priority:medium` PR triggers dev-review (test).
- [ ] `priority:low` PR does NOT trigger (test).
- [ ] `maxRevisionTurns` either honoured (with test) or removed from schema.

---

## Phase 5 — Cutover

### P5.A — Flip `goose-hub-self` to M19 pipeline

After all phases land + green:
1. `target-projects/goose-hub-self/project.config.ts` → `experimental.useM19Pipeline: true`.
2. Run one canary issue end-to-end (small bug fix). Watch event stream.
3. If clean, leave on. If not, flip off, file regression issues.

Acceptance:
- [ ] Canary issue completes through full M19 pipeline.
- [ ] All event stream landmarks present (spec.completed, agent.implement-complete per WP, qa.completed with tier results, review.completed, etc).
- [ ] No fallback to legacy path.

### P5.B — Remove legacy path (deferred milestone)

Once M19 pipeline stable for ≥30 days on goose-hub-self:
- File new milestone issue: remove `runFixIssueWorkflow`, `runReviewWorkflow` (single-reviewer), legacy QA path.
- NOT done now — keep escape hatch.

---

## Issue creation

File issues in this order. Each issue body should reference this plan and include the acceptance criteria from the relevant section verbatim.

```
M19.14: dispatcher feature flag (P0.A)
M19.15: spec-author wired into dispatcher (P1.A)
M19.16: parallel-implement wired into dispatcher (P1.B)
M19.17: convergent review wired + unconstrained prompt (P2.A)
M19.18: investigation swarm wired (P2.B)
M19.19: quality-score aggregate wired into retro + auto-merge gate (P2.C)
M19.20: code-quality-audit wired (P3.A)
M19.21: record-decision MCP exposure + reconciliation (P3.B)
M19.22: Codex hook normalisation + conditional live test (P4.A)
M19.23: dev-review opt-in for goose-hub-self + maxRevisionTurns decision (P4.B)
M19.24: cutover canary + flag flip (P5.A)
```

Total: 11 follow-up issues. M19.13 (Codex holdout review) remains independent — defer per existing decision.

---

## Risks / Open questions

- **Spec-author input dependency.** P1.A needs scout reports from P2.B. Bootstrap: P1.A ships with manual-mode fallback (no scout reports → spec-author works from work-item body alone). P2.B wires scouts later; spec-author auto-upgrades when they exist. Both ship independently.
- **State machine churn.** `factory:spec-ready` is new. Touch state transitions carefully — existing handlers may swallow or skip. Audit `core/state-machine/transitions.ts` before adding.
- **Legacy + new path coexistence.** Flag-gate everything. Both paths must remain green for ≥1 milestone.
- **Decision: kill or keep `core/quality-score`?** Plan assumes keep. If keep, document divergence from QA score. If kill, P2.C reduces to "delete dead code + remove DB table" — much smaller scope.
- **Decision: keep `slices/three-tier-verify/`?** Same split. QA-embedded tier logic is the live one. Either delete the slice or reframe as a unit-test harness for the tier logic. File ADR.
- **`maxRevisionTurns` decoration.** Decide: implement or delete. Don't ship a config field that has no effect.
