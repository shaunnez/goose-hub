# Configurable Scout Models

## Current Problem

Investigation scouts are configured as skills in `SKILL_BUDGETS`, but the
settings UI only exposes role-level model controls. When the investigator role
has a DB or project-config model override, `runInvestigateWorkflow()` currently
routes child scout runs through that investigator model choice.

That makes the effective scout model surprising:

- Wave-1 scout defaults in `budgets.ts` are haiku-tier.
- Wave-2 deep-agent defaults in `budgets.ts` are sonnet-tier.
- A configured investigator role can override both at dispatch time.

## Desired Shape

Make scout model settings first-class per-skill settings, not a second
investigator role.

Recommended configurable rows:

- `scout-code-path`
- `scout-dependency`
- `scout-pattern`
- `scout-schema`
- `scout-test-inventory`
- `scout-user-journey`
- `wave2-interface-designer`
- `wave2-risk-analyst`

## Implementation Notes

1. Add `model_tier` and `model_provider` to `project_skill_settings`.
2. Extend the server settings response so each skill row includes:
   - configured DB tier/provider
   - config/default tier/provider
   - resolved effective model ID
   - source: DB, config, skill default, or role fallback
3. Extend the budgets/settings UI to render the scout and wave2 skill rows.
4. Update budget/model resolution so explicit per-skill DB settings beat
   investigator role settings.
5. Keep investigator role fallback only for skills without a per-skill model
   override.
6. Add regression coverage for:
   - scout skill DB override wins over investigator DB role override
   - Wave-1 scout defaults remain haiku when unset
   - Wave-2 defaults remain sonnet when unset
   - provider coercion still works when the project runtime is forced to Codex

## Temporary Rule

Until scout models are configurable, investigation child scout spawns are
hard-pinned to haiku-tier. Provider still follows the forced runtime/provider
context, so a Codex project resolves to the Codex haiku model.
