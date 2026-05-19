# core/tool-layer/mcp

The `factory-tools` MCP server. Spawned Factory agents talk to this server instead of native `Read`/`Write`/`Edit`/`Glob`/`Grep`/`Bash`. The agent expresses intent; Factory builds the command, validates the path, caps the output, and emits the audit event.

See ADR 0045 for the full rationale.

## Layout

- `server.ts` — MCP server bootstrap (`McpServer` + `StdioServerTransport`). Registers every implemented tool. Also runs `main()` when invoked directly via `node` / `tsx`.
- `schemas.ts` — Zod input-schema catalog for the full 45-tool surface. `FACTORY_TOOL_NAMES` is the canonical list of tool names (without the `mcp__factory-tools__` prefix).
- `path-policy.ts` — `resolveWorkspacePath()` and typed `PathPolicyViolation`. Rejects absolute paths, `..`, `~`, `.codex`, `.agents`, `.claude`, `.factory`, and anything that resolves outside the worktree.
- `command-policy.ts` — `runCommand()` (the sole spawn path: `shell: false`, capped output, SIGTERM-then-SIGKILL timeout) and `minimalEnv()`.
- `context.ts` — `loadFactoryContext()` reads `FACTORY_RUN_ID` / `PROJECT_ID` / `WORK_ITEM_ID` / `WORKSPACE_DIR` / `SERVER_PORT` from env. The agent never supplies these.
- `audit.ts` — `emitToolCall()` / `emitBlockedToolCall()` write structured `agent.tool-call` events through `eventStore`. Blocked calls carry a typed `BlockedReason` (the same `PathPolicyReason` enum the policy throws).
- `tools/context.ts` — `get_project_context`, `get_stack_commands`, `record_decision`.
- `tools/read.ts` — `read_file`, `read_many_files`, `list_dir`, `list_files`, `search_text`, `file_exists`, `file_info`.
- `tools/write.ts` — `write_file`, `edit_file`, `apply_patch`, `create_directory`, `move_file`, `delete_file`.
- `tools/verify.ts` — `run_tests`, `run_lint`, `run_typecheck`, `run_package_script`, `run_targeted_command`.
- `tools/git.ts` — `get_status`, `get_changed_files`, `get_diff`, `get_head_sha`, `get_merge_base`.
- `tools/qa.ts` — `get_pr_diff`, `run_isolated_test`, `run_full_suite_if_needed`.
- `tools/evidence.ts` — `get_app_url`, `write_playwright_spec`, `run_playwright_spec`.

## Per-run config placement

The MCP config is written to `<worktree>/.factory/mcp-config.json` at spawn time by the runtime (Phase 4: `claude-cli.ts`, `codex-cli.ts`). Teardown of the worktree removes it. `.factory` is in the path-policy denylist so the agent cannot read its own env contract.

## Tool surface status

| Family | Implemented in Phase 2 | Deferred |
|---|---|---|
| context | 3 of 5 | `get_work_item`, `get_handoff` (need state-source instance + handoff infra) |
| read/search | 7 of 7 | — |
| write/edit | 6 of 6 | — |
| verification | 5 of 5 | — |
| evidence | 3 of 6 | `collect_evidence`, `validate_evidence_artifacts`, `package_evidence_packet` (need evidence packet schema + collector wrapper) |
| git/diff | 5 of 5 | — |
| qa/review | 3 of 5 | `get_verification_summary`, `check_acceptance_criteria` (need three-tier framework events + work-item state-source) |
| workflow-owned | 0 of 7 | Phase 3 — never granted to agent bundles |

The deferred tools have schemas in `schemas.ts` already so adding the implementations is additive only.

## Wiring (Phase 4)

The runtime layer (`core/agent-runtime/claude-cli.ts`, `core/agent-runtime/codex-cli.ts`) is not yet updated to spawn this server. That lands as a separate work item along with the bundle migration (Phase 5) that removes native `Read`/`Write`/`Edit`/`Glob`/`Grep`/`Bash` from spawned agents.

## What is NOT here

`core/tool-layer/tools/read.ts`, `write.ts`, `bash.ts`, `test.ts` are first-pass scaffolding outside this directory and unused outside `core/tool-layer/tools/` itself. They are deleted in Phase 7 cleanup. `core/tool-layer/tools/record-decision.ts` is the only helper that survives — `tools/context.ts` wraps it.
