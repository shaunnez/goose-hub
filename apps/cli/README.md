# apps/cli

The `goose` command-line tool for Goose Hub Factory operations.

## Commands

### `goose status <project-slug>`

Prints the live state of a target project's GitHub issues:

- Active milestone (lowest open milestone in the source repo).
- Open issues grouped by `factory:*` state in canonical order.
- Total count.

.State is resolved through `core/state-source/GitHubLabelsSource` → `core/state-machine/conflict-resolver.resolveState`

### `goose sweep <project-slug> <milestone-number>`

Lists all non-terminal issues in a milestone, then prompts to bulk-archive them. Used at milestone exit to clean up stale issues before closing.

### `goose issue restart <project-slug> <issue-id> [--state=...] [--schedule=...] [--yes]`

Creates a fresh issue from an existing issue and archives the original.

- Clones title, body, type, priority, milestone, and safe auxiliary labels.
- Defaults the new issue state to `factory:triaging`.
- Defaults the new issue schedule to the original issue schedule unless `--schedule` is provided.
- Links the old and new issues with comments.
- Without `--yes`, prints the restart plan and makes no changes.

### `goose run-agent --skill=<name> --input='<json>' [--dry-run]`

Runs a named skill against the Claude CLI runtime.

- Loads `skills/<name>/skill.config.js` and `skills/<name>/schema.js`.
- Validates `--input` against the skill's context schema before spawning.
- Validates output against the skill's output schema after the run.
- `--dry-run` prints the assembled `AgentSpec` + context XML without spawning.
- Uses `withFallback` (allows down-tier retry) wrapping `ClaudeCliRuntime`.

## Configuration

Requires `GITHUB_TOKEN` in the environment (or `.env`) with `repo` scope to read/write issues.

Known projects are loaded from a hardcoded registry in `src/index.ts`. Adding a project: import its `project.config.ts` from `target-projects/<slug>/` and add it to the registry map.

## Run

```bash
pnpm goose status goose-hub-self
pnpm goose sweep goose-hub-self 5
pnpm goose issue restart goose-hub-self 123 --state=factory:triaging --schedule=current --yes
pnpm goose run-agent --skill=triage --input='{"projectId":"goose-hub-self","workItemId":"123"}'
```

## Boundaries

- Never calls GitHub API directly — always through `core/state-source/`.
- Never re-implements state resolution — always uses `core/state-machine/`.
- Never spawns Claude CLI directly — always through `core/agent-runtime/ClaudeCliRuntime`.
