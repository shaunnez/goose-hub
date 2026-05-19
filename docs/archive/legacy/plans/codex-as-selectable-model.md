# Plan: Codex as a selectable model

Status: superseded by ADR 0042 and implemented through per-skill runtime settings.

The original draft targeted the removed role-model settings surface. Current behavior:

- Model tier/provider is configured per skill in Settings -> Skill runtime.
- Codex CLI auth status is shown on that same Skill runtime surface.
- The legacy role-model UI, `/settings/models` API, repository, and current DB table were removed.
- Historical migrations that created or altered `project_model_settings` remain as migration artifacts only.

Future Codex-provider work should extend `project_skill_settings`, `SkillConfig`, or reviewer-slot settings as appropriate. Do not revive the old role-model settings page.
