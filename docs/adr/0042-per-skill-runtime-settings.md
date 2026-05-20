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

Normal skill dispatch resolves runtime per axis, then reports a compact legacy
`source` plus richer per-axis attribution for settings/debugging.

Tier precedence:

1. Caller explicit concrete `modelOverride`.
2. DB per-skill `model_tier` from `project_skill_settings`.
3. Project config `budgets.skillBudgetOverrides[skill].modelTier`.
4. Built-in `SKILL_BUDGETS[skill].modelTier`.
5. Resolver fallback.

Provider precedence:

1. Caller explicit concrete `modelOverride`.
2. Forced project runtime provider from `codex-cli` or `claude-cli`.
3. DB per-skill `model_provider` from `project_skill_settings`.
4. Skill runtime provider hint or built-in `SKILL_BUDGETS[skill].provider`.
5. Resolver fallback.

Effort precedence:

1. DB per-skill `effort` from `project_skill_settings`.
2. Project config `budgets.skillBudgetOverrides[skill].effort`.
3. Built-in `SKILL_BUDGETS[skill].effort`.

Forced runtime provider behavior is intentionally separate from tier/effort:
`codex-cli` forces provider `codex`, and `claude-cli` forces provider `claude`,
but neither changes the selected tier or effort. Injected runtimes may also
ignore provider override coercion while preserving the selected tier.

The role UI, role settings API, role repository, and `project_model_settings` table are removed. Historical migrations that created or altered the table remain in the migration history; a later migration drops the table from current databases.

Holdout rules:

- `qa` and `reviewer` run in fresh contexts defined by skill config.
- DB/config tier and provider overrides for holdouts are ignored unless `agentConfig.allowHoldoutOverride` is explicitly true.
- Holdout runtime rows do not expose fallback or advisor models.
- Per-skill budget and effort settings must not change context isolation or tool policy.

Unknown skills fail fast unless they have an intentional, complete compatibility path. A stray DB row in `project_skill_settings` is not a fallback skill registration mechanism.

## Consequences

- Settings UI has no "Advanced roles" tab.
- Role max-turn and timeout controls are not exposed as normal runtime settings.
- Role fallback/advisor controls are not exposed for ordinary runs.
- `invokeSkill()` receives budgets from `resolveSkillRuntimeForProject()` and does not reintroduce role budget overrides.
- Codex CLI auth status is displayed in Skill runtime because provider selection is per skill.
- `agentConfig.rolesModels` remains parsed for historical config compatibility, but normal dispatch does not read it.
- `GET /projects/:slug/settings` exposes additive `resolutionTrace` data so the Skill runtime settings table and Workflow map detail modal can explain tier/provider/effort provenance without duplicating project config UI.
