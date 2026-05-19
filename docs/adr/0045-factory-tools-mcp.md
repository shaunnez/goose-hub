# ADR 0045: factory-tools MCP server

- Status: Accepted
- Date: 2026-05-19

## Context

Spawned Factory agents (Claude CLI, Codex CLI) currently receive native tools (`Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`) via per-bundle allowlists in `core/tool-layer/bundles.ts`. Boundary enforcement is layered on top:

- `pre-tool-use-hook.ts` inspects every tool call before execution.
- `workspace-boundary.ts` rejects `Read`/`Glob`/`Grep` paths and `Bash` commands that escape the worktree.
- `sandbox.ts` writes a per-workspace `.claude/settings.json` deny list.

The model still picks what to read, how to construct shell commands, and which paths to traverse. Three classes of risk follow:

1. **Host shell exposure.** `dev-tools` grants unrestricted `Bash`. `validate` grants `git push`, `git commit`, `ffmpeg`, and `cp`. Pattern allowlists are tightenable but not airtight.
2. **Assistant-home reads.** Native `Read` accepts absolute paths. The boundary check rejects paths outside the workspace, but it is a deny-after-construction guard, not an architecture.
3. **Sibling-repo discovery.** Worktrees live under `~/.factory/workspaces/<runId>/`; an absolute-path traversal can resolve a sibling worktree.

The unused helpers in `core/tool-layer/tools/` (`read.ts`, `write.ts`, `bash.ts`, `test.ts`) were a first-pass at an MCP-fronted tool layer that was never wired. Only `record-decision.ts` is imported (by `apps/server/src/domains/decisions/router.ts`, `core/agent-runtime/reconcile-decisions.ts`, `slices/record-decision/slice.test.ts`).

## Decision

Introduce a Factory-owned MCP server, `factory-tools`, exposing intent-shaped tools to spawned agents. Native `Read`, `Write`, `Edit`, `Glob`, `Grep`, and broad `Bash` are removed from every normal bundle. The agent expresses intent; Factory constructs the command, validates the path, caps the output, and emits the audit event.

### Tool surface

Grouped by responsibility. Names live under the `mcp__factory-tools__` prefix when surfaced to the runtime.

- **Context**: `get_work_item`, `get_project_context`, `get_handoff`, `get_stack_commands`, `record_decision`.
- **Read/search**: `read_file`, `read_many_files`, `list_dir`, `list_files`, `search_text`, `file_exists`, `file_info`.
- **Write/edit**: `write_file`, `edit_file`, `apply_patch`, `create_directory`, `move_file`, `delete_file`.
- **Verification**: `run_tests`, `run_lint`, `run_typecheck`, `run_package_script`, `run_targeted_command`.
- **Evidence**: `get_app_url`, `write_playwright_spec`, `run_playwright_spec`, `collect_evidence`, `validate_evidence_artifacts`, `package_evidence_packet`.
- **Git/diff (read-only)**: `get_status`, `get_changed_files`, `get_diff`, `get_head_sha`, `get_merge_base`.
- **Workflow-owned mutation**: `stage_changes`, `commit_changes`, `open_pr`, `update_pr`, `post_issue_comment`, `transition_state`, `publish_evidence`. Never granted to agent bundles; reserved for workflows that intentionally delegate.
- **QA/review**: `get_pr_diff`, `get_verification_summary`, `run_full_suite_if_needed`, `run_isolated_test`, `check_acceptance_criteria`.

### Global tool contract

Every tool follows the same shape:

- The agent **never** supplies `workspaceRoot`. Workspace is read from `FACTORY_WORKSPACE_DIR` at server startup.
- All file paths are workspace-relative. Absolute paths, `..`, `~`, and references to `.codex`, `.agents`, `.claude`, `.factory`, parent dirs, or sibling repos are rejected with a typed `PathPolicyViolation`.
- Commands are argv arrays built by Factory from project/stack config. No tool accepts shell text.
- `spawn(cmd, args, { shell: false, cwd: workspaceRoot })` is the only execution path.
- Output (stdout + stderr) is capped per tool. The structured return is `{ status, exitCode, stdout, stderr, durationMs, truncated }`.
- Each tool has its own timeout. Timeouts emit `tool.timeout` and return a typed failure rather than throwing.
- Every call emits `agent.tool-call`. Every denied call emits the same event with `blocked: true` and a reason code.
- Tool errors are recoverable. Only boundary escape (`PathPolicyViolation`, `CommandPolicyViolation`) or destructive-intent denial is fatal to the run.

### Per-run MCP config placement

The MCP server config is written to **`<worktree>/.factory/mcp-config.json`** at spawn time, not `~/.factory/mcp/<runId>.json`.

Rationale:

- Removes the singleton-config race in `core/agent-runtime/claude-cli.ts:130` and `core/agent-runtime/codex-cli.ts:104` (both stomp `~/.factory/mcp-config.json` on every spawn).
- Cleanup is implicit: the worktree teardown removes the config.
- Co-located with the run for post-mortem.
- The agent never receives the config path. Only `FACTORY_WORKSPACE_DIR` is exposed via env.

Path policy adds `.factory` to the denylist alongside `.codex`, `.agents`, `.claude`. The agent cannot read its own MCP config or env contract.

### Environment contract

The MCP server reads its run-scoped identity from env, never from arguments:

- `FACTORY_RUN_ID`
- `FACTORY_PROJECT_ID`
- `FACTORY_WORK_ITEM_ID`
- `FACTORY_WORKSPACE_DIR`
- `FACTORY_SERVER_PORT` (orchestrator HTTP target for back-channel calls; not exposed to tools)

Missing variables fail server bootstrap. Mismatches between env workspace and the path the agent attempts to access are rejected.

### Existing helpers

`core/tool-layer/tools/read.ts`, `write.ts`, `bash.ts`, and `test.ts` are unused outside the package and are deleted in the Phase 7 cleanup that completes the migration. `record-decision.ts` is the sole survivor; the new `tools/context.ts` wraps it.

## Bundle deltas

- `read` → context + read/search/list MCP tools. No native `Bash`.
- `dev-tools` → context + read/search/list + write/edit/patch + targeted verify + `record_decision`. No native `Bash`.
- `qa-tools` → context + diff/status + verification summary + read/search/list + isolated test/lint/typecheck. No write tools, no native `Bash`.
- `validate` → evidence + Playwright spec runner + collector + artifact validator. No git push via `Bash`.
- `review` / `dev-review` → PR diff/status/read/search. No write tools, no command execution.
- Native `Bash` survives only behind an explicit `emergency-debug` bundle, off by default, requiring project-config opt-in.

## Consequences

- Normal spawned agents cannot reach host shell, assistant homes, sibling repos, or workspace-escape paths.
- Tool calls are uniformly structured, audited, and capped. Output truncation is no longer per-tool inconsistent.
- Workflow-owned mutations (commit, PR, transition) leave the agent's allowlist entirely. The orchestrator drives them.
- Skill prompts stop referring to native tool names. Skill version bumps land alongside bundle migration.
- Adding a new tool means adding a Zod schema, a builder, and a test — not enlarging a Bash pattern allowlist.
- Adding `@modelcontextprotocol/sdk` to `core/` is the only new dependency. It is the SDK used by the existing `apps/web/.mcp.json` Playwright server; no novel runtime.

## Migration

Phases 1–7 are tracked as separate work items under M19. Phase 1 (this PR) ships the policy and context primitives plus the ADR and CONTEXT.md decisions. The server bootstrap, tool families, runtime wiring, and bundle migration follow in dependent issues.

## Addendum — canonical-path integration

After the MCP server tool families landed, the canonical-path plan (`docs/plans/factory-tools-canonical-paths.md`) was fully integrated:

- **Path responses follow `RepoRelativePath` from `path-contract.ts`.** Every MCP tool that returns a file or directory path returns the structured `{ path, root, packageRoot?, normalizedFrom? }` shape, not a bare string. `mcp/path-policy.ts` is now a thin denylist-first wrapper over `canonicalizeFactoryToolPath`; path resolution logic is not duplicated.
- **Audit emission goes through `tool-call-audit.ts`.** `mcp/audit.ts` delegates to `normalizeToolCallAuditPayload` so every `agent.tool-call` event carries `raw_path` + `canonical_path` for path-bearing tools, consistent with the pre-tool-use hook events.
- **Legacy in-process scaffolding deleted.** `core/tool-layer/tools/{read,write,bash,test}.ts` and their tests are removed. `record-decision.ts` is preserved (still imported by the server decisions router and the record-decision slice).
