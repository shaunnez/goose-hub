# apps/cli

The `goose` command-line tool. Read-only in M1; the UI in M2 takes over for write paths.

## Commands

### `goose status <project-slug>`

Prints the live state of a target project's GitHub issues:

- Active milestone (lowest open milestone in the source repo).
- Open issues grouped by `factory:*` state in canonical order.
- Total count.

Issue state is resolved through `core/state-source/GitHubLabelsSource`, which delegates to `core/state-machine/conflict-resolver.resolveState` — so multi-label, archived-wins, and zero-label cases all produce the right state.

## Configuration

Requires `GITHUB_TOKEN` in the environment (or `.env`). The token needs `repo` scope to read issues.

Known projects are loaded from a hardcoded registry in `src/index.ts` for M1. M2.01 replaces this with the `apps/server` `GET /projects` route, which loads from `target-projects/*/project.config.ts` dynamically.

## Run

```bash
pnpm goose status goose-hub-self
```

## Boundaries

- Never calls the GitHub API directly — always goes through `core/state-source/`.
- Never re-implements state resolution — always uses `core/state-machine/`.
- No write operations except via `StateSource.transitionState()` (not exposed in M1).
