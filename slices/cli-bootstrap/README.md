# slices/cli-bootstrap

`goose project bootstrap` CLI command. Closes M12.06 (#309).

## What it does

Adds the `goose project bootstrap <owner>/<repo>` command to the Factory CLI.
The command invokes the `bootstrapProject` workflow (M12.04) and prints live
progress at each step: stack detection, CLAUDE.md audit, label install, and PR
creation. On completion it prints the registration PR URL and a next-steps
block (merge the PR, then configure the webhook per `docs/runbooks/webhook-setup.md`).

## Vertical surfaces touched

- **New module**: `apps/cli/src/bootstrap-command.ts`
  - `bootstrapCommand(deps)` — all I/O injected; returns exit code (0 or 1).
  - `BootstrapCommandDeps` — type for the injected dependencies.
- **Modified**: `apps/cli/src/index.ts`
  - Added `project bootstrap` case to the top-level command dispatch.
  - Imports `bootstrapCommand` + `bootstrapProject` and wires them together.
- **Tests**: `slices/cli-bootstrap/slice.test.ts`

No new deps. The module imports only from `@goose-hub/core` (already aliased by
vitest) so the slice test runs without the heavy CLI imports.

## cloneRoot default

`process.cwd()` is used as the clone root default (overridable via
`FACTORY_CLONE_ROOT` env var). Rationale: the user is most likely running the
command from within their workspace; cloning into the current directory is the
least surprising default. An operator who wants all clones in one canonical
location can set the env var.

## CLI usage

```bash
export GITHUB_TOKEN=ghp_…
goose project bootstrap acme/my-service
```

Sample output:
```
Bootstrapping acme/my-service …
  clone root: /home/user/workspace

Stack detected:   node (pnpm) — scripts: test, lint
CLAUDE.md audit:  ok
Labels installed: created: 5, updated: 0, skipped: 43

Registration PR opened:
  https://github.com/shaunnez/goose-hub/pull/1234

Next steps:
  1. Review and merge the registration PR above.
  2. Set up the GitHub webhook on the target repo:
       docs/runbooks/webhook-setup.md
  3. Confirm the server logs an `ingest.event-received` event after saving the webhook.
```

## Error handling

| Condition | Exit code | Message |
|-----------|-----------|---------|
| Missing `<owner>/<repo>` arg | 1 | Usage printed |
| Malformed ref (no `/`) | 1 | Format error + usage |
| `GITHUB_TOKEN` not set | 1 | How-to message |
| Workflow throws `BootstrapInputError` | 1 | Error + hint |
| Any other error | 1 | Error message |
| Success (status `created` or `idempotent-skip`) | 0 | — |

## Running the tests

```bash
pnpm vitest run slices/cli-bootstrap/slice.test.ts
```

No live GitHub calls — the slice test injects a mock `runWorkflow`.
