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

## Secret Redaction

`redactSecrets(value)` deep-walks any JSON-compatible value and replaces secrets with `[REDACTED]`.

Patterns detected: AWS AKIA keys, GitHub tokens (`ghp_`, `ghs_`, `github_pat_`), Bearer tokens, env-var secrets (`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_CREDENTIAL`).

## Tool Bundles

Named bundles passed via `AgentSpec.toolBundles`. At spawn, `computeAllowlist(spec)` expands them into a flat list for `--allowedTools`.

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
