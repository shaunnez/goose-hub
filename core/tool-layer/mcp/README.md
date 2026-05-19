# core/tool-layer/mcp

The `factory-tools` MCP server. Spawned Factory agents talk to this server instead of native `Read` / `Write` / `Edit` / `Glob` / `Grep` / `Bash`. The agent expresses intent; Factory builds the command, validates the path, caps the output, and emits the audit event.

See ADR 0045 for the full rationale.

## Layout

- `server.ts` — MCP server bootstrap (`McpServer` + `StdioServerTransport`). Registers every agent-facing tool. Also runs `main()` when invoked directly via `node` / `tsx`.
- `build-config.ts` — `buildFactoryMcpConfig()` writes `<worktree>/.factory/mcp-config.json` and is called by the runtime (`claude-cli.ts` / `codex-cli.ts`).
- `schemas.ts` — Zod input-schema catalog for the full tool surface. `FACTORY_TOOL_NAMES` lists every canonical tool name (without the `mcp__factory-tools__` prefix).
- `path-policy.ts` — `resolveWorkspacePath()` and typed `PathPolicyViolation`. Rejects absolute paths, `..`, `~`, `.codex`, `.agents`, `.claude`, `.factory`, and anything that resolves outside the worktree.
- `command-policy.ts` — `runCommand()` (the sole spawn path: `shell: false`, capped output, SIGTERM-then-SIGKILL timeout) and `minimalEnv()`.
- `context.ts` — `loadFactoryContext()` reads `FACTORY_RUN_ID` / `PROJECT_ID` / `WORK_ITEM_ID` / `WORKSPACE_DIR` / `SERVER_PORT` from env. The agent never supplies these.
- `audit.ts` — `emitToolCall()` / `emitBlockedToolCall()` write structured `agent.tool-call` events through `eventStore`. Blocked calls carry a typed `BlockedReason` enum value.
- `tools/_github.ts` — `getStateSourceForProject()` + `resolveGitHubToken()` (reads `FACTORY_GITHUB_TOKEN` / `GITHUB_TOKEN`). Shared by context, qa, and workflow.
- `tools/context.ts` — `get_project_context`, `get_stack_commands`, `get_work_item`, `record_decision`.
- `tools/read.ts` — `read_file`, `read_many_files`, `list_dir`, `list_files`, `search_text`, `file_exists`, `file_info`.
- `tools/write.ts` — `write_file`, `edit_file`, `apply_patch`, `create_directory`, `move_file`, `delete_file`.
- `tools/verify.ts` — `run_tests`, `run_lint`, `run_typecheck`, `run_package_script`, `run_targeted_command`.
- `tools/git.ts` — `get_status`, `get_changed_files`, `get_diff`, `get_head_sha`, `get_merge_base`.
- `tools/qa.ts` — `get_pr_diff`, `run_isolated_test`, `run_full_suite_if_needed`, `get_verification_summary`, `check_acceptance_criteria`.
- `tools/evidence.ts` — `get_app_url`, `write_playwright_spec`, `run_playwright_spec`, `collect_evidence`.
- `tools/workflow.ts` — workflow-owned helpers: `stage_changes`, `commit_changes`, `open_pr`, `update_pr`, `post_issue_comment`, `transition_state`. **NOT** registered with the MCP server. Workflows import these functions directly.

## Per-run config placement

Written to `<worktree>/.factory/mcp-config.json` at spawn time by the runtime. Teardown of the worktree removes it. `.factory` is in the path-policy denylist so the agent cannot read its own env contract.

## Tool surface status

| Family | Registered with the MCP server | Notes |
|---|---|---|
| context | `get_project_context`, `get_stack_commands`, `get_work_item`, `record_decision` | `get_handoff` deferred — no handoff doc format exists in the repo |
| read/search | all 7 | — |
| write/edit | all 6 | — |
| verification | all 5 | — |
| evidence | `get_app_url`, `write_playwright_spec`, `run_playwright_spec`, `collect_evidence` | `validate_evidence_artifacts`, `package_evidence_packet`, `publish_evidence` need an evidence-packet schema that has no upstream definition yet |
| git/diff | all 5 | — |
| qa/review | all 5 | — |
| workflow-owned | none (intentional) | `stage_changes`, `commit_changes`, `open_pr`, `update_pr`, `post_issue_comment`, `transition_state` exist in `tools/workflow.ts` for workflows to import directly. Never granted to agent bundles. `publish_evidence` not implemented (see evidence row). |

## Bundle composition (post Phase 5b)

- `read` — context + read/search + git/diff
- `dev-tools` — context + read/search + write/edit + verify + git/diff
- `qa-tools` — context + read/search + git/diff + qa (no write tools)
- `validate` — context + read/search + evidence
- `core` — empty (no-tool skills)
- `emergency-debug` — `Bash` only; opt-in
- `playwright-mcp` — Microsoft's playwright-test MCP server tools
- `decision-record-only` — legacy single-tool bundle, holdout-blocked

Every agent-facing bundle is `mcp__factory-tools__*` only — no native `Read` / `Write` / `Edit` / `Glob` / `Grep` / `Bash`. Enforced by a slice test.

## GitHub-backed tools

`get_work_item`, `check_acceptance_criteria`, `open_pr`, `update_pr`, `post_issue_comment`, and `transition_state` require `FACTORY_GITHUB_TOKEN` (preferred) or `GITHUB_TOKEN` in the orchestrator env. The agent never sees the token — it's read once at tool-call time inside the orchestrator process.
