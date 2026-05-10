---
  M19: Multi-Agent Orchestration — What Was Built & Where to See It
  
  All 11 closed issues landed in PRs merged 7–8 May. M19.13 (Codex holdout review) still open.

  ---
  Features → Where to check
  
  M19.01 — Investigation swarm (Wave 1 / Wave 2)
  - Code: skills/investigate/, core/agent-runtime/swarm.ts (dispatchWave()),
  core/agent-runtime/cross-validate.ts
  - Timeline: runs appear as grouped agent.spawned / agent.run-started / agent.run-completed
  events inside RunGroupWrapper. No dedicated "wave" event type yet — you see multiple
  parallel agent lifecycle events in sequence.
  - Check: open any work item that ran through Investigate, expand the timeline, look for
  back-to-back spawned agents with the investigate skill label.
  
  M19.02 — spec-author Engineering Spec
  - Code: skills/spec-author/
  - Timeline: no dedicated event. Spec output is written as an artifact to disk/workspace.
  You'd see the agent lifecycle events for a spec-author skill run.
  - Check: look in the workspace directory for the target project after a spec-author run —
  the Engineering Spec JSON/MD artifact will be there.
  
  M19.03 — Parallel implement (one builder per Work Package)
  - Code: slices/parallel-implement/workflow.ts
  - Timeline: each WP builder appears as its own RunGroupWrapper (skill = implement-wp), then
  agent.implement-complete event fires per WP.
  - UI: Issue detail → Timeline tab — you'll see multiple implement-wp run groups, one per WP,
   potentially overlapping timestamps.

  M19.04 — Convergent review (2 adversarial reviewers)
  - Code: slices/review/workflow.ts (dispatchReviewWave())
  - Timeline: review.completed event → rendered by ReviewCompletedEvent.tsx showing verdict +
  confidence.
  - UI: Issue detail → Timeline tab — look for review.completed card. It shows
  APPROVE/REQUEST_CHANGES verdict and a confidence badge.
  
  M19.05 — 3-tier verification (Structural / Functional / Regression)
  - Code: core/verify/tiers.ts, slices/three-tier-verify/workflow.ts
  - Timeline: qa.completed, qa.structural-failed, qa.functional-failed, qa.regression-failed
  events → QaCompletedEvent / QaFailedEvent components.
  - UI: Issue detail → Timeline tab — look for QA events labeled by tier. Failed tiers show
  the specific failure type.

  M19.06 — record-decision runtime tool
  - Code: core/tool-layer/tools/record-decision.ts, slices/record-decision/
  - Timeline: decisions recorded here surface as agent.decision-summary /
  agent.decision-summary-live events → DecisionSummaryEvents.tsx.
  - UI: Issue detail → Timeline tab — look for decision summary chips. Live ones appear
  mid-run; canonical ones appear after the agent terminates.
  
  M19.07 — code-quality-audit skill (8-category rubric)
  - Code: skills/code-quality-audit/
  - Timeline: no dedicated event — runs as an agent run group (skill = code-quality-audit).
  - UI: Output feeds into retrospective. Issue detail → Retrospective tab (deep retro only) →
  RetrospectiveSection will show the audit findings if a deep retro ran after the implement
  cycle.
  
  M19.08 — per-run QualityScore (0–100) + convergence detection
  - Code: core/quality-score/score.ts (computeQualityScore(), isConverged())
  - Timeline: score stored per run, displayed in retrospective.
  - UI (two places):
    a. Issue detail → Retrospective tab → PersonaScoresSection shows per-persona scores.
    b. Roster page → "Quality Trend" tab — bar chart of scores over time, color-coded (green
  ≥80, amber ≥60, red <60), with P0/P1/P2/P3 finding counts per run. This is the main place to
   see quality trends.
  
  M19.09 — Provider-aware model routing (rolesModels)
  - Code: core/agent-runtime/select-model-for-role.ts
  - UI: Settings → Project → Model Routing (ProjectModelPanel.tsx) — configure
  per-role/complexity model overrides. DB overrides win over project config.
  - Check: open Settings for a project, look for the model panel.
  
  M19.10 — Codex CLI runtime
  - Code: core/agent-runtime/codex-cli.ts (CodexCliRuntime class, resolveCodexBinary())
  - No direct UI — it's a runtime sibling to the Claude agent spawn path. Used when a skill's
  config routes to Codex.
  - Check: look at core/agent-runtime/codex-cli.ts directly, or trigger a dev-review run and
  watch for Codex in agent lifecycle events.
  
  M19.11 — skills/dev-review/ (Codex pre-QA advisor)
  - Code: skills/dev-review/, core/agent-runtime/dev-review-advisor.ts
  - Timeline: appears as an agent run group (skill = dev-review) inside the implement phase,
  before QA.
  - UI: Issue detail → Timeline tab — inside the implement workflow run group, look for a
  nested dev-review run group. Its findings influence whether implement loops again.
  
  M19.12 — dev-review wired into implement (one-pass loop bound)
  - Code: slices/parallel-implement/workflow.ts (integration point),
  core/agent-runtime/dev-review-advisor.ts
  - Same as M19.11 from a UI perspective — the loop bound means dev-review runs once per
  implement cycle, then passes to QA regardless.
  
  M19.13 — Codex holdout review (OPEN — not yet built)