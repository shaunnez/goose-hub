# slices/model-routing

M19.09 — provider-aware model routing with config-based complexity overrides.

Fully superseded for user-facing settings by ADR 0042. Users configure model
tier/provider per skill through Skill runtime settings; the old role UI/API/table
has been removed.

Superseded for normal dispatch by ADR 0042. Role model rows now exist only as
advanced/internal compatibility state; users configure model tier/provider per
skill through Skill runtime settings.

## What this slice covers

- `model-router.ts` — legacy predictive selector for static/config/pattern tiers.
- Runtime provider/tier selection is handled by per-skill runtime settings.

## Resolution order

### Normal skill runtime selection

Normal dispatch uses `resolveSkillRuntimeForProject()`. Precedence is caller
model override, forced runtime provider, DB per-skill tier/provider, config
`skillBudgetOverrides`, then `SKILL_BUDGETS`.

## Holdout gating

`qa` and `reviewer` are holdouts. Per-skill model overrides are ignored unless
`agentConfig.allowHoldoutOverride: true` is set, and fallback/advisor models are
not exposed for holdout skill runtime rows.

## Key files

| File | Purpose |
|---|---|
| `core/agent-runtime/skill-runtime-resolver.ts` | Normal per-skill runtime resolver |
| `core/agent-runtime/resolve-for-project.ts` | Global and per-skill budget wrappers |
| `core/agent-runtime/model-router.ts` | Legacy complexity selector |

## ADR

`docs/adr/0034-provider-aware-model-routing.md` and
`docs/adr/0042-per-skill-runtime-settings.md`
