# ADR 0042: Per-Skill Runtime Settings

- Status: Accepted
- Date: 2026-05-18

## Context

Goose Hub briefly had two model-setting surfaces:

1. Per-role model rows in `project_model_settings`.
2. Per-skill runtime rows in `project_skill_settings`.

Users configure skills, not internal roles. Role rows also create holdout risks: a QA or review role override can imply fallback/advisor behavior or model downgrades that weaken fresh-context isolation.

## Decision

Per-skill runtime settings are the only normal user-facing model, tier, provider, budget, and timeout surface.

Normal skill dispatch uses this precedence:

1. Caller explicit concrete `modelOverride`.
2. Forced project runtime provider from `codex-cli` or `claude-cli`.
3. DB per-skill `model_tier` / `model_provider` from `project_skill_settings`.
4. Project config `budgets.skillBudgetOverrides[skill]`.
5. Built-in `SKILL_BUDGETS[skill]`.

`project_model_settings` is advanced/internal compatibility state only. Normal dispatch must not read role model rows, role fallback/advisor slots, role complexity rows, or role max-turn/timeout columns.

Holdout rules:

- `qa` and `reviewer` run in fresh contexts defined by skill config.
- Per-skill model overrides for holdouts are ignored unless `agentConfig.allowHoldoutOverride` is explicitly true.
- Holdout runtime rows do not expose fallback or advisor models.
- Per-skill budget settings must not change context isolation or tool policy.

Unknown skills fail fast unless they have an intentional, complete compatibility path. A stray DB row in `project_skill_settings` is not a fallback skill registration mechanism.

## Consequences

- Settings UI labels the old role surface as "Advanced roles".
- Role max-turn and timeout controls are not exposed as normal runtime settings.
- Role fallback/advisor controls are not exposed for ordinary runs.
- `invokeSkill()` receives budgets from `resolveSkillRuntimeForProject()` and does not reintroduce role budget overrides.
- `project_model_settings` schema remains for compatibility and existing rows, but users should tune normal runs in Skill runtime settings.
