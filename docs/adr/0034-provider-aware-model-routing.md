# ADR 0034 — Provider-aware model routing and UI-configurable role/complexity overrides

**Status:** Fully superseded by ADR 0042  
**Date:** 2026-05-08  
**Issue:** #593 (M19.09)

## Supersession Note

ADR 0042 makes per-skill runtime settings the only user-facing model, tier, provider, budget, and timeout surface. The role settings UI, `/settings/models` API, role settings repository, and current `project_model_settings` schema have been removed. Historical migrations remain only as migration history.

## Context

Before this ADR, model selection had two disconnected layers:

1. **Active** — `skills/*/skill.config.ts` declares `modelPin: ModelTier`. The runtime maps tier → concrete model ID via `defaultModelForTier()`. Every call site used the skill pin directly.

2. **Orphaned** — every `project.config.ts` carries `agentConfig.rolesModels: Partial<Record<Role, RoleModel>>` parsed by the schema but never read at runtime. Intent existed (different roles should be able to use different models per project) but the wiring was missing.

A third layer — `agentConfig.modelRouter.overrides` — handled complexity-based tier selection (e.g. `developer+type:bug → haiku`) but was stored only in the config file, making it cumbersome to tune without a code change.

No model entry carried provider information, limiting the architecture to Claude-only despite M19.10 planning a Codex CLI runtime.

## Decision

### 1. Provider field on model entries

`ModelEntry` in `core/agent-runtime/models.ts` gains `provider: 'claude' | 'codex'`. All existing entries default to `'claude'`. Codex models will be added in M19.10.

`SkillConfig` in `core/agent-runtime/interface.ts` gains optional `provider?: 'claude' | 'codex'`. Defaults to `'claude'` when absent. No skill changes its declared provider in this issue.

`agentConfig.runtime` in `AgentConfig` is extended from `'claude-cli'` to `'claude-cli' | 'codex-cli' | 'auto'`. `'auto'` (the future default) picks the runtime matching the resolved model's provider. The Codex CLI runtime itself is M19.10.

### 2. `selectModelForRole()` — pure resolver wiring `rolesModels`

`core/agent-runtime/select-model-for-role.ts` exports a pure function:

```ts
selectModelForRole(role, agentConfig, skillConfig, dbParams?) → RoleModelResult
```

Resolution order (highest wins):
1. `dbParams` — DB row from `project_model_settings` (UI-editable)
2. `agentConfig.rolesModels[role]` — project config
3. `skillConfig.modelPin` — skill default
4. `ROLE_DEFAULTS[role].modelTier` — hard-coded fallback

The pure function has no DB imports. `selectModelForRoleForProject()` in `resolve-for-project.ts` reads the DB and delegates.

### 3. Holdout override gating

`qa` and `reviewer` model overrides are silently dropped unless `agentConfig.allowHoldoutOverride: true` is set on the project config. Default is false.

The gating applies at all override layers (DB and project config). Without the flag, holdout roles always use their skill-declared tier. This prevents accidental model downgrade from undermining QA/review quality.

The UI renders holdout roles as read-only unless `allowHoldoutOverride` is true in the project config.

### 4. Complexity-based overrides in DB

`project_model_settings` stores `complexity_overrides_json` per `(project_id, role)`. Keys are `"type:<T>"`, `"priority:<P>"`, or `"default"` (no role prefix — the row is already scoped to a role).

`resolveComplexityOverridesForProject()` merges config-file `modelRouter.overrides` (stripping role prefix) with DB overrides, with DB winning per key. The result is passed to `selectModel()` as `dbComplexityOverrides`, which is evaluated before config-file overrides.

Full resolution order for `selectModel()`:
1. `dbComplexityOverrides` (DB, UI-editable) — highest
2. `agentConfig.modelRouter.overrides` (project config)
3. Pattern-informed (decision_patterns with consistencyScore > 0.7)
4. Static policy table

### 5. Settings UI — "Models" tab

`ProjectModelPanel.tsx` adds a third tab to the Settings page alongside Config and Budgets. It provides:

- A per-role table: Primary / Fallback / Advisor tier selectors (dropdowns, inline save on change)
- Expandable rows: per-role complexity rules editor (add/remove key→tier rules)
- Holdout roles shown with a "holdout" badge; selectors disabled unless `allowHoldoutOverride`
- Clear button per row removes all DB overrides for that role

### 6. DB schema

New table `project_model_settings(project_id, role, primary_model, fallback_model, advisor_model, complexity_overrides_json, updated_at, updated_by)` with composite primary key `(project_id, role)`. Migration 0010.

## Override precedence summary

| Layer | Source | Editable |
|---|---|---|
| 1. Skill `modelPin` | `skills/*/skill.config.ts` | No |
| 2. Project config `rolesModels` | `project.config.ts` | No (governed) |
| 3. DB `project_model_settings` | SQLite | **Yes — Settings UI** |

For complexity selection:

| Layer | Source | Editable |
|---|---|---|
| 1. Static policy | Hard-coded in model-router.ts | No |
| 2. Pattern history | `decision_patterns` DB table | Auto-learned |
| 3. Config `modelRouter.overrides` | `project.config.ts` | No (governed) |
| 4. DB `complexity_overrides_json` | SQLite | **Yes — Settings UI** |

## Why `rolesModels` was kept (not renamed)

The field name `rolesModels` is established in the config schema and in project configs. Renaming would require updating all project configs (a governed file touch). The field is now wired rather than replaced.

## Consequences

- Any workflow calling `resolveBudgetsForProject()` for budget resolution can now also call `selectModelForRoleForProject()` for model tier resolution; the wrapper pattern is symmetric.
- M19.10 (Codex CLI) can land without touching this code: it registers `provider: 'codex'` model entries and the `'auto'` dispatcher picks up the correct runtime from `provider`.
- M19.13 (Codex holdout review) interacts with `holdoutReview.codexEnabled` on `AgentConfig`, which is declared here but implemented in M19.13.
