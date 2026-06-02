# goose-hub-self

Target-project configuration for running Factory workflows against Goose Hub itself.

## Files

| File | Purpose |
|---|---|
| `project.config.ts` | Project ID, local-db source, target repo, stack commands, mode, model/tool policy, budgets, governance perimeter, and active milestone. |
| `repos.md` | Human-readable registry of target repositories for this project. |
| `MISSION.md` | Project-local mission file used during bootstrap/governance checks. |
| `FACTORY_RULES.md` | Project-local Factory rules copy used during bootstrap/governance checks. |
| `agent-context/` | Per-skill prompt overlays loaded by `readPromptWithContext`. |
| `personas/` | Project-scoped persona documentation/configuration area. |

## Behaviour

- The project source of truth is local SQLite; GitHub stays available as the code and PR repository, not as a Work Item import source.
- The target repository is also `shaunnez/goose-hub`, so workflow changes can dogfood Goose Hub against itself.
- Mode is `supervised`; workflows require the configured human gates and do not merge their own PRs.
- Stack commands are pnpm-based and include build, test, lint, typecheck, and e2e pipeline entries.
- Local milestones can be created from the UI after the first local Work Items are added.

## Boundaries

`project.config.ts`, local mission/rules files, and persona configuration are governance-controlled. Do not change them casually; use this README for orientation, not policy.
