# `goose work` CLI namespace (M14.08 / #329)

Work-mode subcommands. Every command short-circuits with a non-zero exit code unless `WORK_MACHINE=true` is set in the environment.

## Commands

- `goose work status` — list active Work (Jira-backed) projects and the current `factory:*` state of their open tickets. Read-only.
- `goose work investigate <project-slug> <jira-key>` — trigger an investigation run for the named ticket. Resolves the project and ticket up-front so the user gets fast feedback on bad input.

## Gating

The single gate is `WORK_MACHINE=true`. It matches the same gate enforced by `core/projects/loader.ts` (#325) and `core/projects/scheduler.ts` so the user gets a consistent "Work is hidden here" signal from every surface. The CLI top-level `goose help` only lists the `work` namespace when the gate is open.

## Tests

`work.test.ts` covers the WORK_MACHINE rejection path for every subcommand, the unknown-slug failure, and the happy-path output for both `status` and `investigate` against mocked `loadProjects` + `JiraStateSource`.
