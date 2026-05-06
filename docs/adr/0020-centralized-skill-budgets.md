# ADR 0020 — Centralized Skill Budgets and Haiku-First Model Selection

**Status:** Accepted  
**Date:** 2026-05-06

## Context

Agent budgets (`maxTurns`, `maxBudgetUsd`, `timeoutMs`) and model selection were hardcoded at ~14 call sites across slices and core workflows. Values were arbitrary guesses, several were demonstrably wrong (e.g. `implement maxBudgetUsd: 2` while an observed simple run cost $1.61), and `modelOverride` was set inconsistently — `investigate` hardcoded opus, most others defaulted to sonnet regardless of the `rolesModels` config that was otherwise decorative.

## Decision

### 1. Canonical defaults in `core/agent-runtime/budgets.ts`

`SKILL_BUDGETS: Record<string, SkillBudget>` is the single source of truth for per-skill budget defaults. Values are derived from observed telemetry with a 3–5× safety margin. The table lives in `core/` (not `project.config.ts`) because:

- `project.config.ts` files are governance-immutable in target projects; adding a required field would break type checks on unmodified configs.
- `core/` call sites (advisor, retrospective) have no project context at some layers; they can call `resolveBudgets(skill)` without project config.

### 2. Per-project overrides via `BudgetConfig.skillBudgetOverrides`

Projects may override individual skill fields without touching the canonical defaults:

```ts
budgets: {
  skillBudgetOverrides: {
    implement: { maxTurns: 200, maxBudgetUsd: 10 },
  }
}
```

`skillBudgetOverrides` is typed inline in `BudgetConfig` (not as `Partial<AgentBudgets>`) to avoid a circular import: `interface.ts` imports from `types.ts`; importing `AgentBudgets` back into `types.ts` would create a cycle.

### 3. `resolveBudgets(skill, projectBudgets?)` resolver

Returns `{ budgets: AgentBudgets, modelOverride: string }`. Resolution order:

1. `projectBudgets.skillBudgetOverrides[skill]` (project override)
2. `SKILL_BUDGETS[skill]` (canonical default)
3. Throws if neither exists — unregistered skills are a programming error, not a runtime condition.

`maxBudgetUsd` is capped at `perWorkflowMaxUsd` when project budgets are provided.

Call sites spread the result: `...resolveBudgets('implement', projectConfig?.budgets)` which sets both `budgets` and `modelOverride` in one step.

### 4. `modelTier` per skill drives haiku-first selection

Each `SkillBudget` includes `modelTier: ModelTier`. The resolver calls `defaultModelForTier(tier)` and returns it as `modelOverride`, wiring the model selection that was previously inert in `rolesModels`.

Default tiers by skill:

| Skill | Tier | Rationale |
|---|---|---|
| triage, repo-match, bug-enhance | haiku | Label/classify only; flat output schema |
| evidence-post, implement, retro-light | haiku | Start cheap; escalation (future) handles schema failures |
| qa, review, resolve-conflict, playwright-repro, spec-author, retro-deep | sonnet | Correctness-critical or complex structured output |
| investigate, advise-on-plan | opus | Deep codebase reasoning; no escalation |

`developer.primary` in `rolesModels` updated to `haiku` (fallback remains `sonnet`). This is documentation of intent — the actual model comes from `resolveBudgets`.

### 5. Schema-validation escalation (haiku → sonnet retry)

`SkillBudget.escalation?: { modelTier; maxBudgetUsd; maxTurns?; timeoutMs? }` defines an opt-in retry policy for schema-validation failures. `runWithEscalation` (in `core/agent-runtime/with-escalation.ts`) wraps a `runtime.run(spec)` + Zod `safeParse` pair: on parse failure for an escalatable skill, it retries once at the escalated tier with a fresh `runId` and emits `agent.retry-escalated` with `{ stage: 'model', runId, retryRunId, skill, fromModel, toModel, reason: 'schema-validation-failed' }`.

The `stage` field discriminates this from QA / review escalations on the same event kind (which carry `stage: 'qa' | 'review'`). The retro `retriesGe2` trigger filters events to only count workflow-level retries — a model-tier retry isn't evidence the work item is struggling.

Constraints:

- Holdout roles (`qa`, `reviewer`) never escalate — they throw `HoldoutFallbackForbiddenError` instead.
- Subprocess failures (timeout, process death) are not handled here; those go to `withFallback`. This wrapper only handles validation failure on a successful run.
- One retry maximum — haiku → sonnet (or same-tier, e.g. opus → opus, when there is no higher tier), not a loop.
- Strict downgrade (e.g. opus → sonnet) is rejected; same-tier retry is allowed so a top-tier skill can still get one extra shot at producing valid output.
- The retry uses a recalculated budget (sonnet ~10× per-token cost vs haiku) and a new `runId` for separate cost attribution.

Currently only `implement` opts in (`escalation: { modelTier: 'sonnet', maxBudgetUsd: 15.0 }`). Triage / repo-match / evidence-post deliberately do not — the per-run savings on those skills don't justify the extra complexity, and a hard fail is acceptable.

### 6. Telemetry: `turnsUsed` added to `agent.run-completed`

The CLI `--output-format json` envelope includes `num_turns`. This is now extracted and added to the `agent.run-completed` payload alongside `turns.budgeted` and `budget.usd`. Retrospectives can compare observed usage against limits to recommend budget tuning.

## Calibrated budget values

Numbers sourced from observed runs (single data points) with 3–5× safety margin:

| Skill | Observed | maxTurns | maxBudgetUsd | timeoutMs |
|---|---|---:|---:|---:|
| triage | 39s, <10t, $0.0003 | 25 | 0.05 | 120_000 |
| repo-match | 10s, <10t, $0.0003 | 25 | 0.05 | 60_000 |
| implement | 6min, 45t, $1.61 | 150 | 6.00 | 900_000 |
| evidence-post | 3min, 17t, $0.53 | 60 | 2.00 | 300_000 |
| qa | 3.5min, 29t, $0.66 | 100 | 3.00 | 600_000 |
| review | 35s, <10t, $0.09 | 25 | 0.50 | 180_000 |
| retro-light | 34s, <10t, $0.06 | 25 | 0.30 | 180_000 |
| retro-deep | 1.5min, <10t, $0.11 | 30 | 0.50 | 300_000 |

Skills without telemetry (investigate, playwright-repro, advisor, spec-author, resolve-conflict, bug-enhance) use estimates; recalibrate once `agent.run-completed.turns.used` data accumulates.

`perWorkflowMaxUsd` raised: goose-hub-self `5 → 10`, nannymudnz `3 → 8`. Previous cap was below the implement skill's own budget.

## Consequences

- All call sites are ~1 line instead of 3. Adding a new skill requires one entry in `SKILL_BUDGETS`.
- Haiku-first reduces cost on most runs. Schema-validation escalation (upgrade haiku → sonnet on failure) is implemented in `runWithEscalation` and currently enabled for `implement` only.
- `timeoutMs` is no longer optional at the config layer; all SKILL_BUDGETS entries include it explicitly. The runtime still handles a missing `timeoutMs` via the existing `TIMEOUT_MS` fallback (30s) for specs that bypass the resolver.
- `rolesModels.developer.primary` is now `haiku` but this field is currently informational only — the authoritative tier comes from `resolveBudgets`.
