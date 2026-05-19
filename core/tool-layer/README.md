# core/tool-layer

Tool management and security infrastructure for agent runtime.

## Files

| File | Exports | Issue |
|------|---------|-------|
| `secret-redaction.ts` | `redactSecrets` | M4.05 |
| `bundles.ts` | `TOOL_BUNDLES`, `BundleName` | M4.08 |
| `allowlist.ts` | `computeAllowlist`, `TOOL_BUNDLES` | M4.08 |
| `sandbox.ts` | `writeWorkspaceSandbox` | M4.08 |
| `pre-tool-use-hook.ts` | `deployHooks`, `HOOK_PATH` | M4.08 |
| `post-tool-use-hook.ts` | `deployPostHook`, `POST_HOOK_PATH` | M9.XX (#465) |
| `path-contract.ts` | `RepoRelativePath`, `canonicalizeFactoryToolPath` | agent-operational-truth Slice 1 |
| `tools/read.ts` | `readFile`, `searchFiles`, `SandboxViolationError` | M6.02 |
| `tools/write.ts` | `writeFile` | M7.01 |
| `tools/bash.ts` | `runBash`, `BashResult`, `DEFAULT_BASH_DENYLIST` | M7.01 |
| `tools/test.ts` | `runTests`, `TestResult` | M7.01 |

## Secret Redaction

`redactSecrets(value)` deep-walks any JSON-compatible value and replaces secrets with `[REDACTED]`.

Patterns detected: AWS AKIA keys, GitHub tokens (`ghp_`, `ghs_`, `github_pat_`), Bearer tokens, env-var secrets (`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_CREDENTIAL`).

## Tool Bundles

Named bundles passed via `AgentSpec.toolBundles`. At spawn, `computeAllowlist(spec)` expands them into a flat list for `--allowedTools`.

| Bundle | Tools | Used by |
|--------|-------|---------|
| `read-only` | `Read`, `Glob`, `Grep`, `Bash(cat *)`, `Bash(ls *)` | General read-only agents |
| `read-write` | `Read`, `Write`, `Edit`, `Glob`, `Grep` | Developer agents |
| `bash-restricted` | `Bash` | Shell agents |
| `read` | `read`, `search`, `work-item-read` | Investigator agents (sandboxed) |
| `dev-tools` | `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash` | Developer skills (`implement`, `implement-wp`, `resolve-conflict`) and dev workflows (`fix-issue`, `parallel-implement`, `fix-feedback`) |
| `validate` | `Read`, `Write`, `Edit`, `Glob`, `Grep`, scoped `Bash(pnpm test:e2e*)`, evidence I/O, git push | Playwright skills (`evidence-post`, `playwright-repro`) |
| `playwright-mcp` | `mcp__playwright-test__*` (browser/planner/generator) | `spec-author` skill (auto-merges `apps/web/.mcp.json`) |

**Note on `dev-tools`:** the bundle currently uses Claude Code's built-in tools. The lowercase sandboxed variants in `tools/` (`runBash`, `writeFile`, `runTests`, `readFile`, `searchFiles`) are pre-built but not yet exposed via an MCP server, so agents reach the host shell through Claude Code's `Bash` rather than `runBash`. Workspace-level deny rules in `sandbox.ts` plus the PreToolUse hook are the active safety boundary. Wiring the MCP server (and thereby enforcing fields like `perBashCommandMaxSeconds`) is tracked in #635 — see ADR 0035 for the timeout-scope decision that depends on it.

## Canonical Path Contract

`path-contract.ts` defines the reusable response shape for future `factory-tools` MCP path-bearing results:

```ts
interface RepoRelativePath {
  path: string;
  root: 'worktree';
  packageRoot?: string;
  normalizedFrom?: string;
}
```

`canonicalizeFactoryToolPath({ rawPath, worktreePath })` reuses the shared repo-relative normalizer from `core/workspaces/path-normalization.ts`. It strips absolute worktree paths, resolves uniquely discoverable package-relative paths, and returns a structured `ambiguous-repo-relative-path` error with candidates when a package-relative path cannot be chosen safely.

The current in-process helpers expose metadata-bearing variants for the future MCP server:

- `readFileWithMetadata` returns `{ path, content }`.
- `searchFilesWithMetadata` returns `{ stdout, paths }` with canonicalized match prefixes.
- `writeFileWithMetadata` returns `{ path, written: true }`.
- `runTests` accepts optional `paths` and returns them as canonical `RepoRelativePath[]`.

## Workspace Sandbox

`writeWorkspaceSandbox(path)` writes `.claude/settings.json` with pattern-level deny rules:
- `Read(./.env*)` — never read dotenv files
- `Bash(sudo *)` — no privilege escalation
- `Bash(rm -rf *)` — no recursive deletes

Called once at workspace bootstrap; never mutated per run.

## PreToolUse Hook

`deployHooks()` writes both `~/.factory/hooks/pre-tool-use.js` and `~/.factory/hooks/post-tool-use.js` (idempotent). Both are registered in the workspace `.claude/settings.json` by `writeWorkspaceSandbox()`.

The PreToolUse script:
1. Validates tool name against per-run allowlist (`FACTORY_RUN_ALLOWLIST` env var)
2. Denies out-of-allowlist tools (exits with block decision)
3. Audits every call to the event store as `agent.tool-call`

## PostToolUse Hook

The PostToolUse script (`post-tool-use-hook.ts`) fires after each tool call and scans the agent's `transcript_path` for new `[decision] …` marker lines since the last fire:

1. Reads the CC hook JSON from stdin to get `transcript_path`
2. Maintains a per-run byte-offset cursor at `~/.factory/hooks/state/<runId>.cursor` to avoid re-emitting markers
3. Extracts markers via `/^\[decision\]\s+(.+)$/gm`
4. POSTs each marker to `POST /events/decision-summary` as `agent.decision-summary-live`
5. All failures are best-effort — a failing POST never blocks the agent's tool execution

## Sandboxed Read and Search Tools

`tools/read.ts` provides workspace-sandboxed file access for the investigator agent. Both functions enforce that all access stays within the workspace root.

### `readFile({ workspaceRoot, path })`

Reads a file at `path` inside `workspaceRoot`. Returns the file contents as a UTF-8 string.

Security constraints:
- `path` must be non-empty.
- Absolute paths are allowed only when they resolve inside `workspaceRoot`; returned metadata strips the worktree prefix.
- Package-relative paths are normalized when uniquely resolvable.
- Ambiguous package-relative paths and `../` traversal are rejected.
- Throws `SandboxViolationError` on any violation.

```ts
import { readFile, SandboxViolationError } from './tools/read.js';

const content = await readFile({
  workspaceRoot: '/home/user/.factory/workspaces/run-123/repo',
  path: 'src/index.ts',
});
```

### `searchFiles({ workspaceRoot, pattern, glob? })`

Runs ripgrep (`rg`) within `workspaceRoot` to find lines matching `pattern`. Returns the ripgrep stdout (with filename and line number), or `""` when no matches are found.

Security constraints:
- `pattern` must be non-empty.
- `pattern` must not contain `../` — the search path is always `workspaceRoot`, never user-supplied.
- Throws `SandboxViolationError` on any violation.
- Optionally accepts a `glob` parameter to restrict which file types are searched (e.g. `*.ts`).

```ts
import { searchFiles } from './tools/read.js';

const results = await searchFiles({
  workspaceRoot: '/home/user/.factory/workspaces/run-123/repo',
  pattern: 'TODO',
  glob: '*.ts',
});
```

### `SandboxViolationError`

Typed error class thrown when path traversal or invalid input is detected. Callers should catch this specifically to distinguish sandbox violations from filesystem errors.

```ts
import { SandboxViolationError } from './tools/read.js';

try {
  await readFile({ workspaceRoot, path: '../escape' });
} catch (err) {
  if (err instanceof SandboxViolationError) {
    // path escape attempt
  }
}
```

## Sandboxed Write Tool

`tools/write.ts` provides workspace-bound file writes for the developer agent. Same path-validation contract as `readFile`.

### `writeFile({ workspaceRoot, path, content, createParents? })`

Writes UTF-8 `content` to `path` inside `workspaceRoot`. Parent directories are created by default. Existing files are overwritten.

```ts
import { writeFile } from './tools/write.js';

await writeFile({
  workspaceRoot: '/home/user/.factory/workspaces/run-123/repo',
  path: 'src/new-feature.ts',
  content: 'export const x = 1;\n',
});
```

Throws `SandboxViolationError` on paths outside the worktree, ambiguous package-relative paths, or `../` traversal.

## Sandboxed Bash Tool

`tools/bash.ts` provides shell-free command execution for the developer agent.

### `runBash({ workspaceRoot, argv, denylist?, env?, timeoutMs? })`

Spawns `argv[0]` with `argv.slice(1)` as positional arguments. Never invokes a shell (FACTORY_RULES rule 29 — `shell: false`). Cwd is `workspaceRoot`; env is minimal (`HOME`, `PATH`) plus any caller-supplied keys.

Returns `BashResult`:

```ts
interface BashResult {
  stdout: string;       // capped at 4 MB (FACTORY_RULES rule 31)
  stderr: string;
  exitCode: number;
  truncated: boolean;   // true if stdout was capped
  timedOut: boolean;    // true if killed by 30 s default timeout (FACTORY_RULES rule 32)
}
```

The default denylist (`DEFAULT_BASH_DENYLIST`) rejects `sudo `, `rm -rf /`, `git push --force`, `mkfs`, fork-bomb, etc. — case-insensitive substring match against the joined argv. Override per-call with the `denylist` parameter.

```ts
import { runBash } from './tools/bash.js';

const result = await runBash({
  workspaceRoot: '/work/repo',
  argv: ['pnpm', 'lint'],
});
if (result.exitCode !== 0) {
  throw new Error(`lint failed: ${result.stderr}`);
}
```

## Test Tool

`tools/test.ts` is a thin wrapper around `runBash` that runs the project's `testCommand` (from `StackConfig`).

### `runTests({ workspaceRoot, testCommand, timeoutMs? })`

Tokenises `testCommand` on whitespace into argv, then delegates to `runBash`. Default timeout is **5 minutes** (test runs legitimately exceed the 30 s default).

Returns `TestResult` (extends `BashResult` with a boolean `passed` field — `true` iff `exitCode === 0`).

```ts
import { runTests } from './tools/test.js';

const result = await runTests({
  workspaceRoot: '/work/repo',
  testCommand: 'pnpm test',
});
if (!result.passed) {
  // surface result.stderr to the agent
}
```

Quoted arguments in `testCommand` are NOT supported; projects with complex test commands should wrap them in a `package.json` script and pass the script invocation here.
