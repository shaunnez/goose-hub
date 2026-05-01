# Goose Hub

Personal command centre for AI-assisted software delivery.

See `MISSION.md` for what this is.  
See `FACTORY_RULES.md` for non-negotiables.  
See `CLAUDE.md` for AI agent orientation.  
See `docs/PLAN.md` for the full plan and milestone ladder.

## What's built

### Web UI

A Kanban-style board at `/projects/<slug>` shows all open issues grouped by factory state (backlog → in-progress → needs-qa → needs-review → done). Click any card to open the detail page, which shows the issue description, a state-transition panel (to manually advance or force-state an issue), and a timeline of events. Run the dev server with `pnpm --filter web dev`.

### CLI

The `goose` CLI (built with `pnpm --filter cli build`, then `node apps/cli/dist/index.js`) has two commands:

- `goose status <project-slug>` — prints open issues grouped by factory state for the given project, with the active milestone shown at the top.
- `goose sweep <project-slug> <milestone-number>` — lists all non-terminal issues in the given milestone, prompts for confirmation, then bulk-archives them by forcing the `factory:archived` label.

- `goose run-agent --skill=<name> --input='<json>' [--dry-run]` — runs a skill agent against the Claude CLI. `--dry-run` prints the assembled AgentSpec without spawning. Requires `ANTHROPIC_API_KEY`.

Both `status` and `sweep` require `GITHUB_TOKEN` set in the environment or a `.env` file.