# core/tool-layer/mcp

The `factory-tools` MCP server. Spawned Factory agents talk to this server instead of native `Read`/`Write`/`Edit`/`Glob`/`Grep`/`Bash`. The agent expresses intent; Factory builds the command, validates the path, caps the output, and emits the audit event.

See ADR 0045 for the full rationale.

## Files

- `path-policy.ts` — workspace-relative path validation. Rejects absolute paths, `..`, `~`, `.codex`, `.agents`, `.claude`, `.factory`, and any path that resolves outside the worktree. Throws typed `PathPolicyViolation` with a `code` suitable for audit payloads.
- `command-policy.ts` — `runCommand()` is the sole execution path. Wraps `spawn(cmd, args, { shell: false })`, caps stdout/stderr by byte count, enforces per-tool timeouts (SIGTERM then SIGKILL), and returns `{ status, exitCode, stdout, stderr, durationMs, truncated }`. Builders construct argv from project/stack config; no tool accepts shell text.
- `context.ts` — `loadFactoryContext()` reads `FACTORY_RUN_ID`, `FACTORY_PROJECT_ID`, `FACTORY_WORK_ITEM_ID`, `FACTORY_WORKSPACE_DIR`, `FACTORY_SERVER_PORT` from env. The agent never supplies these. Tools never accept `workspaceRoot` as an argument.
- `audit.ts` — `emitToolCall()` / `emitBlockedToolCall()` write structured `agent.tool-call` events through `eventStore`. Blocked calls carry a typed `BlockedReason` code.

## Per-run config placement

The MCP config is written to `<worktree>/.factory/mcp-config.json` at spawn time by the runtime (`claude-cli.ts`, `codex-cli.ts`). Teardown of the worktree removes it. `.factory` is in the path-policy denylist so the agent cannot read its own env contract.

## What is NOT here yet

Phase 1 ships the primitives only. Tool implementations (`tools/context.ts`, `tools/read.ts`, `tools/write.ts`, `tools/verify.ts`, `tools/evidence.ts`, `tools/git.ts`, `tools/qa.ts`, `tools/workflow.ts`), the Zod schema catalog (`schemas.ts`), and the MCP server bootstrap (`server.ts`) land in subsequent phases.

The unused `core/tool-layer/tools/read.ts`, `write.ts`, `bash.ts`, `test.ts` are first-pass scaffolding and are deleted in Phase 7 cleanup. `record-decision.ts` is wrapped by the new `tools/context.ts`.
