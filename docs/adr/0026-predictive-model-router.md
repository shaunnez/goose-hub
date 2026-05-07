# ADR 0026: Predictive model router for dev-side skills

**Status:** Accepted
**Date:** 2026-05-07
**Milestone:** M11 — Dependency-aware Scheduling (M11.15)

## Context

Through M9 the model selection per skill role was static, encoded in `agentConfig.rolesModels` per
project (e.g. `developer: { primary: 'haiku', fallback: 'sonnet', advisor: 'opus' }`). PR #521
moved the developer primary to haiku to control cost, with sonnet as a fallback when schema
validation failed. The fallback worked, but it was reactive — the agent would burn a haiku call,
fail validation, then escalate to sonnet. For routine bugs and chores haiku usually succeeded; for
multi-AC features it usually didn't, and the predictable failure cost was visible in the cost
dashboard.

The natural improvement was to predict the right tier *before* the call. We already had two signals
that map to issue complexity — `WorkItem.priority` and `WorkItem.type` — plus a third signal that
needed to be computed: the body shape (number of acceptance criteria, length). And by M11 we had a
fourth signal arriving for free: convergent decision patterns mined from `archived_lifecycles`
(ADR 0024) tell us which `(role, type)` combinations have historically needed sonnet to converge.

Routing is a per-call decision, only relevant for non-holdout dev-side skills (a holdout that
adapts its model based on patterns mined from holdout runs would compromise ADR 0014). The router
must therefore be a small, observable, project-aware function — not a prompt or a config table.

## Decision

Add `core/agent-runtime/model-router.ts` exposing `selectModel({ workItem, role, projectId,
modelRouterConfig })` returning `{ tier: 'haiku' | 'sonnet' | 'opus', reason: string }`.

Resolution order (most-specific wins, short-circuiting):

1. **Holdout guard.** If `role` is in `HOLDOUT_ROLES` (`qa`, `reviewer`), the router refuses to
   make a decision and the caller falls back to the static `rolesModels` config. Holdouts never
   depend on cross-run telemetry.

2. **Project override (`agentConfig.modelRouter.overrides`).** Three key shapes, most-specific
   first: `${role}+type:${workItem.type}`, `${role}+priority:${workItem.priority}`, `${role}` alone.
   The first match wins. This is the human escape hatch: an operator who knows haiku is wrong for
   `developer+type:bug` on this project can pin sonnet and the router stops reasoning.

3. **Pattern-based override.** Query `decision_patterns` for `(projectId, role)` rows where the
   pattern action summary indicates a tier escalation was needed. If a convergent pattern exists,
   route to its recommended tier with `reason: 'pattern-derived'`.

4. **Static policy.** Otherwise fall back to a small hand-coded function:
   - `priority` ∈ {high, critical} → sonnet
   - `type === 'bug'` → haiku
   - `type === 'chore'` → haiku
   - `type === 'feature'` with `acCount >= 5` or `body.length >= 1500` → sonnet (large-feature)
   - `type === 'feature'` otherwise → sonnet
   - default → sonnet

The router emits `agent.model-routed` events recording every decision with the chosen tier, the
reason string, and the inputs (role, type, priority, AC count). This is the audit substrate for
later tightening of the static rules and for the cost dashboard's per-tier breakdown.

### Why three signals instead of an LLM-based router

A "router model" call to choose the model would defeat the cost saving. The static rules cover the
clear cases (holdouts, high-priority, large features); the override map covers the human knowledge;
the pattern table covers the learned signal. None of those needed an LLM.

### Why fallback (PR #521) is preserved

The router predicts; the fallback corrects. A haiku call that fails schema validation still
escalates to sonnet via the existing fallback. The router's job is to make those failures rare,
not to eliminate the safety net.

## Consequences

- Per-call model selection is now an explicit, logged decision. The cost dashboard's per-stage
  breakdown can be sliced by routed tier.
- Non-dev-side skills (qa, review, retrospective-*, triage, investigate, etc.) are unchanged —
  they continue to use the static `rolesModels` config or their per-skill overrides.
- New project config field: `agentConfig.modelRouter.overrides`. Optional. Defaults to no
  overrides (i.e. policy + patterns only).
- The pattern-based override creates a feedback path: if M11.11/.12's miner detects that
  `developer+type:bug` is consistently failing on haiku, the next run will be routed to sonnet
  automatically. This makes the cost/quality trade-off self-tuning per project.
- Holdouts remain on their static config — the router refuses to touch them — preserving ADR
  0014's enforcement boundary.
