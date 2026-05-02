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
| `tools/read.ts` | `readFile`, `searchFiles`, `SandboxViolationError` | M6.02 |

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

## Workspace Sandbox

`writeWorkspaceSandbox(path)` writes `.claude/settings.json` with pattern-level deny rules:
- `Read(./.env*)` — never read dotenv files
- `Bash(sudo *)` — no privilege escalation
- `Bash(rm -rf *)` — no recursive deletes

Called once at workspace bootstrap; never mutated per run.

## PreToolUse Hook

`deployHooks()` writes `~/.factory/hooks/pre-tool-use.js` (idempotent). The deployed script:
1. Validates tool name against per-run allowlist (`FACTORY_RUN_ALLOWLIST` env var)
2. Denies out-of-allowlist tools (exits with block decision)
3. Audits every call to the event store as `agent.tool-call`

## Sandboxed Read and Search Tools

`tools/read.ts` provides workspace-sandboxed file access for the investigator agent. Both functions enforce that all access stays within the workspace root.

### `readFile({ workspaceRoot, path })`

Reads a file at `path` relative to `workspaceRoot`. Returns the file contents as a UTF-8 string.

Security constraints:
- `path` must be a non-empty relative path — absolute paths (starting with `/`) are rejected.
- After resolution, the resulting path must remain within `workspaceRoot` — `../` traversal is rejected.
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
