# Factory-tools canonical path integration

## Goal

Make the `factory-tools` MCP server the primary producer of canonical repo-relative paths for spawned Factory agents.

Agents should use Factory tools for read, write, search, edit, and test intent. The server should enforce workspace scope and return canonical paths that downstream workflow code can reuse directly.

## Depends On

- Repo-relative path normalization helper is implemented and tested.
- Existing tool audit events can carry normalized path metadata without breaking timeline rendering.

## Non-goals

- Do not remove workflow-side path normalization. Agent terminal JSON still needs defensive repair.
- Do not change QA or review holdout policy.
- Do not convert every workflow in one PR.
- Do not hardcode `apps/web` as the only package root.

## Design

The MCP server should call the same normalizer used by workflows. Every path-bearing tool response should include canonical identity:

```ts
{
  path: "apps/web/src/components/chrome/Sidebar.tsx",
  root: "worktree",
  packageRoot: "apps/web",
  normalizedFrom: "src/components/chrome/Sidebar.tsx"
}
```

When normalization is ambiguous, the tool should fail the operation with a structured error that lists candidates. The model can then choose the intended repo-relative path explicitly.

## Slices

### [x] Slice 1 - Path contract in factory-tools

Add a shared `RepoRelativePath` response shape and use it in read/search/write/edit/test tool results.

Acceptance criteria:

- Tool responses use repo-root/worktree-root relative POSIX paths.
- Absolute worktree paths are stripped before responses are returned.
- Package-relative inputs are normalized when uniquely resolvable.
- Ambiguous package-relative inputs return a structured error.

Completed:

- Confirmed there is no existing `factory-tools` MCP server in the repo; `core/tool-layer/tools/*` remains a pre-built in-process tool layer for a future server.
- Added `core/tool-layer/path-contract.ts` with the reusable `RepoRelativePath` response shape, canonicalization helpers, and structured ambiguity errors.
- Reused `core/workspaces/path-normalization.ts` so factory-tool path responses match the workflow-side normalizer.
- Wired the current core/tool-layer helpers to the same contract where appropriate:
  - `readFileWithMetadata` returns `{ path, content }`.
  - `searchFilesWithMetadata` returns `{ stdout, paths }` and canonicalizes ripgrep path prefixes.
  - `writeFileWithMetadata` returns `{ path, written: true }`.
  - `runTests` accepts optional path args and returns canonical `RepoRelativePath[]`.
- Kept the existing simple helper APIs (`readFile`, `searchFiles`, `writeFile`) compatible for current callers while making the future MCP response contract available.

### [x] Slice 2 - Audit events carry canonical paths

Update tool-call/tool-result audit payloads so persisted events include canonical path metadata where available.

Acceptance criteria:

- `agent.tool-call` or the paired result event can show both raw input and canonical path.
- No secret or absolute user path leaks into user-facing timeline payloads.
- Existing timeline rendering remains compatible with older events.

Completed:

- Added `core/tool-layer/tool-call-audit.ts` as the shared audit payload normalizer.
- `agent.tool-call` payloads now keep sanitized raw input and add `raw_path` plus `canonical_path` when a path-bearing tool input can be resolved against the workspace.
- Claude/Codex hook payloads pass `workspace_dir` transiently so the server can canonicalize paths; the persisted event strips that absolute workspace path.
- Codex runtime-owned `agent.tool-call` events use the same audit normalizer, including blocked workspace-boundary events.
- `agent.tool-result` payloads are sanitized through the same boundary so Bash errors do not persist absolute user paths.
- Added compatibility coverage for older payloads without `canonical_path`.

### [ ] Slice 3 - Test tool returns canonical test paths

Make the factory test tool report the canonical test files it ran.

Acceptance criteria:

- The tool records `command`, raw path args, and normalized path args.
- `testsRun.paths` can be derived from tool output.
- Package-relative test args such as `src/foo.test.ts` normalize to the package path when unique.

### [ ] Slice 4 - Prompt simplification pass

Update implement-style prompts to tell agents to use factory-tools-returned paths verbatim in terminal JSON.

Acceptance criteria:

- Prompts no longer rely on agents inferring CWD or package root.
- Prompts still state the canonical path contract.
- Prompt wording does not replace workflow validation.

## Verification

- Unit tests for MCP path normalization and ambiguity.
- Tool integration tests that run from a worktree with at least two package roots.
- A regression test for `src/components/chrome/slice.test.ts` resolving to `apps/web/src/components/chrome/slice.test.ts` when unique.

Latest verification:

- Prerequisite: `pnpm lint`
- Prerequisite: `pnpm vitest run core/workspaces/path-normalization.test.ts slices/fix-issue/slice.test.ts slices/parallel-implement/slice.test.ts slices/spec-author/slice.test.ts`
- Slice 1: `pnpm vitest run core/tool-layer/path-contract.test.ts core/tool-layer/tools/slice.test.ts core/tool-layer/tools/read.test.ts core/workspaces/path-normalization.test.ts`
- Slice 2: `pnpm vitest run core/tool-layer/tool-call-audit.test.ts core/tool-layer/path-contract.test.ts core/tool-layer/pre-tool-use-hook.test.ts core/tool-layer/post-tool-use-hook.test.ts apps/server/src/domains/events/service.test.ts apps/server/src/domains/events/router.test.ts core/agent-runtime/codex-cli-runtime.test.ts`
- Slice 2: `pnpm lint`
- Final guard: `pnpm typecheck`

Next unchecked slice: Slice 3 - Test tool returns canonical test paths.
