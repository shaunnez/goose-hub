# M19 Repair Plan (v2)

Goal: 3-of-12-wired → 12-of-12-wired. M19 milestone gets follow-up issues until truly closed.

**Execution model:** Opus drives, parallel Sonnet sub-agents handle independent slices. Manual human review per PR. No dogfooding the M19 pipeline on its own repair work — too risky.

**All decisions locked (see questions/answers — 2026-05-10):**

| # | Decision | Implication |
|---|---|---|
| 1 | Keep both quality scores | M19.08 wires into retro alongside QA's 8-category score |
| 2 | Keep deterministic 3-tier verify | Runs before QA agent, feeds ground-truth tier results in |
| 3 | Delete dead `selectModelForRole` | Cleanup pass |
| 4 | Make `maxRevisionTurns` real + expose in settings | New settings UI control |
| 5 | Fix swarm before spec-author wires | M19.01 unblocks M19.02 |
| 6 | Convergent review configurable | Slot count + per-slot model (claude/codex), settings UI |
| 7 | All in M19 milestone | Same milestone, suffix .14+ |
| 8 | Opus + parallel Sonnet sub-agents | No self-build via pipeline |

---

## Phase 0 — Prerequisites

### M19.14 — dispatcher feature flag

Add `agentConfig.experimental.useM19Pipeline: boolean` to `core/types.ts`. Default false. Read in dispatcher entry points.

Acceptance:
- [ ] Type field added.
- [ ] Default false everywhere.
- [ ] Dispatcher reads flag in `factory:dev-ready` and `factory:needs-qa`/`factory:needs-review` branches (no-op when false).
- [ ] Test: legacy path still runs when flag false.

### M19.15 — delete dead model-routing function

Remove `selectModelForRole` (and `selectModelForRoleForProject` if unused outside it). Keep `selectModel` + `resolveComplexityOverridesForProject` — those are wired.

Acceptance:
- [ ] `core/agent-runtime/select-model-for-role.ts` deleted.
- [ ] `core/agent-runtime/resolve-for-project.ts` cleaned (delete `selectModelForRoleForProject` if no callers).
- [ ] All test files referencing deleted symbols removed/updated.
- [ ] `pnpm typecheck && pnpm test` green.

---

## Phase 1 — Producers (chain unblock)

### M19.16 — investigation swarm wired (was M19.01)

Why first: spec-author needs scout reports as input.

Files: `slices/investigate/workflow.ts:63-85`, `skills/investigate/prompt.md:21`, `slices/investigate/slice.test.ts`.

Steps:
1. Replace single `runtime.run({skill:'investigate'})` with:
   - Wave 1: `dispatchWave({skills: ['scout-schema','scout-code-path','scout-pattern','scout-test-inventory','scout-dependency','scout-user-journey']})`
   - `crossValidate(waveResults)` — surface contradictions
   - Wave 2: `dispatchWave({skills: ['wave2-interface-designer','wave2-risk-analyst'], context: <synthesized wave1>})`
   - Synthesis: final `runtime.run({skill:'investigate'})` with wave2 outputs as context, produces final report
2. Persist scout reports to workspace `<workspace>/scout-reports/<skill>.json` for spec-author consumption.
3. Remove "not yet wired" line from `skills/investigate/prompt.md:21`.

Acceptance:
- [ ] Workflow calls `dispatchWave` twice + `crossValidate` once.
- [ ] Scout reports persisted to workspace.
- [ ] Integration test: cross-validate surfaces contradiction (force two scouts to disagree).
- [ ] Integration test: scout timeout → killed agent → workflow continues with partial reports.
- [ ] Integration test: 2 scout failures → escalate `factory:needs-human`.
- [ ] Integration test: holdout-key in scout context throws `tool.violation`.
- [ ] Existing single-agent tests removed.
- [ ] `skills/investigate/prompt.md` updated.

### M19.17 — spec-author wired (was M19.02)

Files: new `slices/spec-author/workflow.ts`, `apps/server/src/shared/dispatch.ts`, new state `factory:spec-ready`.

Steps:
1. Create `slices/spec-author/workflow.ts` exposing `runSpecAuthorWorkflow(workItem, stateSource, slug, repoRef)`.
2. Workflow:
   - Read scout reports from workspace `<workspace>/scout-reports/*.json` (produced by M19.16).
   - Call `runtime.run({skill: 'spec-author', context: { scoutReports, workItem }})`.
   - Validate output via `validateEngineeringSpec`.
   - Persist to `<workspace>/slices/<n>/spec.json`.
3. New state `factory:spec-ready` in `core/state-machine/`.
4. Dispatcher: when `factory:dev-ready` AND `useM19Pipeline === true` → `runSpecAuthorWorkflow` → transition `factory:dev-ready` → `factory:spec-ready`. Legacy path otherwise.

Acceptance:
- [ ] Spec written to `<workspace>/slices/<n>/spec.json`.
- [ ] State `factory:spec-ready` exists and transitions correctly.
- [ ] Validation rejection routes to `factory:needs-human` with comment.
- [ ] Tests: golden spec, validation failure, missing scout reports (escalate to needs-human — hard dep on M19.16).
- [ ] Flag-off path runs legacy unchanged.

### M19.18 — parallel-implement wired (was M19.03)

Files: `apps/server/src/shared/dispatch.ts:951-952`, `slices/parallel-implement/workflow.ts:692-697`, new merge handler.

Steps:
1. New dispatcher branch: `factory:spec-ready` AND `useM19Pipeline === true` → call `runParallelImplementWorkflow(workItem, stateSource, slug, spec)`. Read spec from `<workspace>/slices/<n>/spec.json`; missing → escalate.
2. Implement workspace cleanup on PR merge (the dead `cleanupIssueWorktreeImpl` finally branch). Hook into existing GitHub webhook OR poller for merged PRs.
3. Legacy `dispatchFixIssue` remains for projects with flag off.

Acceptance:
- [ ] `factory:spec-ready` → `runParallelImplementWorkflow` invoked.
- [ ] Workspace cleanup confirmed by integration test on merged PR webhook.
- [ ] E2E: 3-WP spec → 3 concurrent builders → 1 PR with per-WP commits.
- [ ] Flag-off path runs legacy `dispatchFixIssue`.

---

## Phase 2 — Holdouts + Verification

### M19.19 — wire deterministic 3-tier verify before QA (refines M19.05)

Why: QA agent currently self-reports `tierResults`. Deterministic verify (`core/verify/tiers.ts`) is the dead-but-better one. Run it FIRST, feed results to QA agent so it can't fabricate tier verdicts.

Files: `slices/qa/workflow.ts`, `core/verify/tiers.ts`, `slices/three-tier-verify/`.

Steps:
1. New node in `slices/qa/workflow.ts` (or `slices/three-tier-verify/` repurposed): before invoking QA agent, run `runTier(1)` → `runTier(2)` → `runTier(3)` if spec.json present. Stop at first failure per current tier semantics.
2. Pass results into QA agent context as `deterministicTierResults`. QA skill schema validates: `qaOutput.tierResults[X].passed === deterministicTierResults[X].passed` — agent cannot disagree with ground truth.
3. Failure paths:
   - Tier 1/2 fail → `factory:needs-fix` (skip QA agent — no point).
   - Tier 3 fail → respect `regressionPolicy`: 'escalate' (default) or 'ignore' (continue with warning).
4. **`'revert'` policy removed** — was decorative no-op. Update `RegressionPolicy` type to `'escalate' | 'ignore'`. Amend ADR 0032 with removal rationale. File separate future issue if auto-revert genuinely wanted (with proper design — atomic rollback + blame attribution).
5. Test fixture parity: existing QA tests must keep passing — tier results now come from deterministic source, agent is consumer.

Acceptance:
- [ ] Deterministic tiers run before QA agent invocation.
- [ ] QA schema validation rejects tier-result disagreement with ground truth.
- [ ] Tier 1/2 fail short-circuits — QA agent not called.
- [ ] `regressionPolicy: 'revert'` removed from type union; ADR 0032 amended.
- [ ] Existing QA event stream (`qa.completed` etc) unchanged for downstream consumers.
- [ ] `slices/three-tier-verify/` either repurposed (now wired) or formally deleted with ADR amendment. Decide in this PR.

### M19.20 — convergent review configurable (was M19.04)

Files: `apps/server/src/shared/dispatch.ts:481-497`, `slices/review/workflow.ts`, new `skills/review/prompt.unconstrained.md`, settings UI.

Steps:
1. New config block on `agentConfig.review`:
   ```ts
   review: {
     reviewerCount: 1 | 2,                     // default 1, max 2
     reviewerSlots: Array<{
       model: 'claude' | 'codex',
       prompt: 'default' | 'unconstrained',
     }>,                                       // length must equal reviewerCount
   }
   ```
2. Dispatcher: when flag on AND `reviewerCount === 2` → call `runConvergentReviewWorkflow`. When 1 → existing `runReviewWorkflow`.
3. `runConvergentReviewWorkflow` reads `reviewerSlots`, dispatches each via correct provider (Claude vs Codex via `selectRuntime`), with correct prompt overlay.
4. Create `skills/review/prompt.unconstrained.md` — strips scope guidance, encourages broader critique.
5. New settings UI section in `apps/web/src/components/settings/components/ProjectModelPanel.tsx` (or new `ReviewPanel.tsx`): slot count toggle + per-slot model + per-slot prompt selector. Persist to DB-backed project settings.
6. New server route `apps/server/src/domains/project-settings/review-router.ts`: GET/PATCH `/projects/:slug/settings/review`.
7. Holdout invariant preserved across both reviewers regardless of provider.

Acceptance:
- [ ] Convergent path reachable when `reviewerCount === 2` and flag on.
- [ ] `prompt.unconstrained.md` exists, materially differs from default (no scope guidance).
- [ ] Each slot can independently choose claude or codex.
- [ ] Settings UI persists changes; agent runs read latest config.
- [ ] Holdout context boundary holds for both providers.
- [ ] Auth-topic minRounds=3 still honoured.
- [ ] Test: 1 claude + 1 codex reviewer, divergent verdicts → escalate to `factory:needs-human`.

### M19.21 — quality-score aggregate wired into retro + auto-merge gate (was M19.08)

**Decision locked: keep both QA's 8-cat and M19.08 deterministic. Different concerns.**

Files: `slices/retrospective-deep/workflow.ts`, `slices/retrospective-light/workflow.ts`, `apps/server/src/domains/roster/service.ts:59`, CONTEXT.md.

Steps:
1. Retro workflows: build `RunArtifacts` from event stream after run completes (P0/P1/P2/P3 counts from QA+review findings, harness_pass_rate from test runner, regressions_open from regression policy outcome, etc).
2. Call `computeQualityScore(artifacts)` → populate `RetroOutput.qualityScore` → `persistRunQualityScore`.
3. Roster service: replace `qualityScore: null` (line 59) with `listRunQualityScores(personaId)` lookup. Latest entry wins for run drill-in; trend uses full series.
4. Auto-merge gate in `slices/parallel-implement/workflow.ts` (PR-open node): call `isConverged(history)` && `score >= 80`. If either false → `factory:needs-human` with comment explaining.
5. CONTEXT.md entry: distinguish QA's 8-category subjective score (per-run code quality) from M19.08's deterministic outcome score (per-run pipeline + cross-run convergence). Both surface in retro JSON, both render in roster.

Acceptance:
- [ ] `run_quality_scores` table receives writes during retro runs.
- [ ] `QualityTrendTab` renders non-empty data after one retro cycle.
- [ ] Auto-merge gate blocks on `score < 80` OR `!isConverged`.
- [ ] CONTEXT.md split documented with example values.
- [ ] Hardcoded `qualityScore: null` removed from roster service.

---

## Phase 3 — Audit + Tooling

### M19.22 — code-quality-audit wired (was M19.07)

Files: `target-projects/goose-hub-self/project.config.ts`, `slices/retrospective-deep/workflow.ts`, `slices/review/workflow.ts`, `core/quality-score/repository.ts`, ImprovementCandidate emission, UI series.

Steps:
1. Register `auditor` role in `goose-hub-self/project.config.ts` with budgets/persona.
2. Conditional invocation in deep retro: `priority:high` label OR scheduled nightly → `runtime.run({skill: 'code-quality-audit'})`. Persist output.
3. Conditional invocation in convergent review: `priority:high` PR → audit runs as parallel branch (NOT replacing reviewers — separate slot).
4. Persist `audit_score` column on `run_quality_scores`.
5. Emit ImprovementCandidate from convergent recommendations top-3 (uses existing improvement-candidate emission path or build new).
6. Autonomous-mode gate: `audit_score < 60 && mode === 'autonomous'` → `factory:needs-human`.
7. UI: new `architecturalQualityScore` chart series in `QualityTrendTab.tsx`.
8. Nightly trigger: cron entry or scheduler config.

Acceptance:
- [ ] `auditor` registered in `goose-hub-self/project.config.ts`.
- [ ] Priority:high PR triggers audit (test).
- [ ] Nightly trigger configured + tested.
- [ ] `audit_score` rows written.
- [ ] ImprovementCandidate emitted from top-3 (test against fixture).
- [ ] Autonomy gate fires on `audit_score < 60` (test).
- [ ] UI series renders with sample data.

### M19.23a — MCP server for tool-layer

**Precondition for M19.23.** No MCP server currently exposes `core/tool-layer/tools/*.ts` to agents.

Files: new `core/tool-layer/mcp-server.ts`, runtime config in `core/agent-runtime/claude-cli.ts` (and `codex-cli.ts` for parity if Codex supports MCP).

Steps:
1. Build minimal stdio MCP server. Registers each tool from `core/tool-layer/tools/*.ts` as an MCP tool with proper JSON schema input + output.
2. Generate MCP config at runtime spawn time per skill: filter tools to those in the skill's `toolBundles` resolved allowlist.
3. Pass `--mcp-config <path>` to Claude CLI. Same path for Codex if Codex CLI supports MCP (verify; if not, document as Claude-only for now).
4. Holdout enforcement: strip `decision-record-only` bundle from holdout roles BEFORE generating MCP config (use existing `core/tool-layer/allowlist.ts` strip logic).
5. Tests: spawn agent with mock skill including `decision-record-only` bundle → agent successfully calls `record_decision`. Holdout role → tool absent from MCP config.

Acceptance:
- [ ] MCP server registers all `core/tool-layer/tools/*.ts` exports.
- [ ] Per-spawn MCP config filtered by skill's resolved tool allowlist.
- [ ] Claude CLI receives `--mcp-config`.
- [ ] Codex CLI parity OR documented as Claude-only.
- [ ] Holdout role MCP config excludes record-decision (test).
- [ ] Live integration test: agent run invokes `record_decision`, row appears in DB.

### M19.23b — record-decision wired (was M19.06)

Depends on M19.23a.

Files: skill configs (multiple), `core/agent-runtime/runtime.ts`.

Steps:
1. Add `'decision-record-only'` to `toolBundles` in: implement-wp, implement, investigate, spec-author, dev-review, retrospective-deep. Default-on for all non-holdout skills.
2. End-of-run reconciliation: in `core/agent-runtime/runtime.ts` where `agent.run-completed` fires, call `readRunDecisions(runId)`. Prefer DB rows over schema-field `decisionSummaries` when both present.
3. Pass iteration + phase from run context (`runtime.run({iteration, phase})` → tool wrapper closure captures and writes alongside each `recordDecision` call).
4. Gate on `experimental.recordDecisionTool` — flag default false until validated.

Acceptance:
- [ ] Live agent calls `record_decision` from a real workflow (not just integration test).
- [ ] Holdout roles cannot (test, complementing M19.23a).
- [ ] End-of-run reconciliation prefers DB rows over schema field.
- [ ] Iteration + phase captured during real run.
- [ ] Flag default false; flipping it gates bundle inclusion.

---

## Phase 4 — Codex finishing

### M19.24 — Codex hook normalisation + conditional live test (was M19.10)

Files: `core/agent-runtime/codex-cli.ts`, new `core/agent-runtime/codex-hook-normalize.ts`, `slices/codex-runtime/slice.test.ts:464`.

Steps:
1. Map Codex tool taxonomy → internal Pre/PostToolUse event shape (parity with Claude hooks).
2. Inject normalisation in spawn path before event emission.
3. Replace permanent `it.skip` with `describe.skipIf(!liveOk)` where `liveOk = existsSync(~/.codex/auth.json) || !!OPENAI_API_KEY`.

Acceptance:
- [ ] PreToolUse + PostToolUse events from Codex match Claude payload keys (test compares shapes).
- [ ] Conditional live-test runs locally with auth, skips without.
- [ ] `agent.tool-call` audit stream homogeneous across providers.

### M19.25 — dev-review opt-in + maxRevisionTurns (was M19.12)

**Decision locked: implement `maxRevisionTurns` properly + settings UI.**

Files: `target-projects/goose-hub-self/project.config.ts`, `slices/parallel-implement/workflow.ts`, `core/types.ts`, settings UI.

Steps:
1. Add `devReview` block to `goose-hub-self/project.config.ts`:
   ```ts
   devReview: {
     enabled: true,
     triggerOn: ['priority:medium', 'priority:high'],
     maxRevisionTurns: 1,
     perCycleMaxUsd: 2.00,
     timeoutMs: 600_000,
   }
   ```
2. Implement `maxRevisionTurns` counter in `slices/parallel-implement/workflow.ts`:
   - Track revision turns in run state (DB or in-workflow counter).
   - After dev-review-response, if verdict still blockers-found AND turns < max → loop. Else force progression to QA.
   - Default 1 keeps current behaviour; values >1 enable real iteration.
3. Settings UI: new `DevReviewPanel.tsx` (or section in existing settings) — toggle `enabled`, label-multi-select for `triggerOn`, number input for `maxRevisionTurns` (1-3), $ input for `perCycleMaxUsd`, ms input for `timeoutMs`.
4. Server route GET/PATCH `/projects/:slug/settings/dev-review`.

Acceptance:
- [ ] `goose-hub-self` opts in.
- [ ] `priority:medium` PR triggers dev-review (test).
- [ ] `priority:low` PR does NOT trigger (test).
- [ ] `maxRevisionTurns: 2` allows two revision turns (test); `: 1` allows one.
- [ ] Settings UI persists; runtime reads.

---

## Phase 5 — Cutover

### M19.26 — canary flip on goose-hub-self

Pre-req: all M19.14-25 merged + green.

Steps:
1. Pick a small bug-fix issue on `goose-hub-self` as canary.
2. Set monthly cost cap to **$2000** for `goose-hub-self` before flipping (see Cost Caps section).
3. Flip `experimental.useM19Pipeline: true` in `goose-hub-self/project.config.ts`.
4. Run canary issue end-to-end. Watch event stream.
5. Verify all landmarks: `agent.investigate-complete` (with swarm events), `spec.completed`, `agent.implement-complete` per WP, deterministic tier events, `qa.completed` with tier results from ground truth, `review.completed`, retro with QualityScore, ImprovementCandidate emitted if applicable.
6. If clean, leave on. If not, flip off, file regression issues per failure.

Acceptance:
- [ ] Cost cap of $2000/month enforced before flag flip.
- [ ] Canary issue completes through full M19 pipeline.
- [ ] All event-stream landmarks present.
- [ ] No fallback to legacy path during canary.
- [ ] Retro shows both QA's 8-cat score AND M19.08 deterministic score.

### Legacy path removal — deferred

**Criterion: 10 successful M19-pipeline issues end-to-end on goose-hub-self with zero legacy fallback events.** Run-based, no calendar floor.

When met:
- File new milestone issue: remove `runFixIssueWorkflow`, single-reviewer `runReviewWorkflow`, dead helpers.
- NOT done in M19. Escape hatch stays.

---

## Issue file order

Sequential-ish by phase, parallel within phase. Most can be filed concurrently:

```
M19.14: dispatcher feature flag                      (P0, no deps)
M19.15: delete dead model-routing function           (P0, no deps, parallel)
M19.16: investigation swarm wired                    (P1.A, no deps)
M19.17: spec-author wired                            (P1.B, depends M19.14 + M19.16)
M19.18: parallel-implement wired                     (P1.C, depends M19.14 + M19.17)
M19.19: deterministic 3-tier verify before QA       (P2.A, depends M19.18 indirectly — no spec means no tier 1)
M19.20: convergent review configurable               (P2.B, depends M19.14, parallel with 19.19)
M19.21: quality-score aggregate + auto-merge gate   (P2.C, depends M19.18 + M19.19 + M19.20)
M19.22:  code-quality-audit wired                    (P3.A, depends M19.21)
M19.23a: MCP server for tool-layer                   (P3.B-pre, no deps, parallel anytime)
M19.23b: record-decision wired                       (P3.B, depends M19.14 + M19.23a)
M19.24:  Codex hook normalisation                    (P4.A, no deps, parallel anytime)
M19.25:  dev-review opt-in + maxRevisionTurns        (P4.B, depends M19.18)
M19.26:  canary flip on goose-hub-self               (P5, depends ALL above)
```

14 follow-up issues total. M19.13 (Codex holdout review) stays open separately — defer per existing decision.

---

## Risks / Open items

- **M19.16 swarm scope.** 6 scouts + 2 wave-2 + cross-validate + synthesis = ~9 agent runs per investigation. Cost spike. Mitigate: cap concurrency, add per-skill budgets, monitor cost telemetry first cycle.
- **M19.19 deterministic-vs-agent disagreement.** When QA agent produces tierResults that don't match ground truth, schema validation will reject. May cause retry storms initially. Add observability: `qa.tier-disagreement` event for debugging the first few cycles.
- **M19.23 MCP server scope unknown.** Could be 1 issue or 2 depending on existing infrastructure. Investigate first as a sub-task before locking the issue body.
- **M19.21 RunArtifacts assembly.** Building components from event stream requires iterating events and counting findings by priority. Add helper in `core/quality-score/build-artifacts.ts`. Test against fixture event streams.
- **Workspace persistence.** spec.json + scout-reports live in workspace dir which is ephemeral. If workspace destroyed mid-cycle, cycle restarts from `factory:dev-ready`. Acceptable since workspaces are workflow boundaries per FACTORY_RULES, but document.
- **Cost cap during repair.** $2000/month cap for `goose-hub-self`. Enforced before P5 canary flip. Monitor cost telemetry from M19.16 (swarm) onward — biggest spike risk.

---

## Execution model reminder

- **Opus drives** the issue (this assistant in main session).
- **Parallel Sonnet sub-agents** for independent file groups (UI vs backend vs tests) within one issue.
- **Manual human review** (you) per PR. No M19-pipeline review during repair.
- **Standard gates apply:** typecheck + tests + build green on both apps before any PR open.
