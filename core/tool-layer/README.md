# core/tool-layer

Tool management and security infrastructure for agent runtime.

## Files

| File | Exports | Issue |
|------|---------|-------|
| `secret-redaction.ts` | `redactSecrets` | M4.05 |
| `tool-repository.ts` | canonical tool definitions, bundle definitions, fingerprint helper | tool binding |
| `tool-binding.ts` | `bindToolsForAgentSpec` | tool binding |
| `bundles.ts` | `TOOL_BUNDLES`, `BundleName` compatibility export | M4.08 |
| `allowlist.ts` | `computeAllowlist`, `TOOL_BUNDLES` compatibility wrapper | M4.08 |
| `sandbox.ts` | `writeWorkspaceSandbox` | M4.08 |
| `pre-tool-use-hook.ts` | `deployHooks`, `HOOK_PATH` | M4.08 |
| `post-tool-use-hook.ts` | `deployPostHook`, `POST_HOOK_PATH` | M9.XX (#465) |
| `path-contract.ts` | `RepoRelativePath`, `canonicalizeFactoryToolPath` | agent-operational-truth Slice 1 |
| `tool-call-audit.ts` | `normalizeToolCallAuditPayload`, `canonicalPathStringFromAuditPayload` | agent-operational-truth Slice 2 |
| `mcp/` | `factory-tools` MCP server and tool implementations | ADR 0045 |
| `tools/record-decision.ts` | `recordDecision`, `readRunDecisions` | M19.06 |

## Secret Redaction

`redactSecrets(value)` deep-walks any JSON-compatible value and replaces secrets with `[REDACTED]`.

Patterns detected: AWS AKIA keys, GitHub tokens (`ghp_`, `ghs_`, `github_pat_`), Bearer tokens, env-var secrets (`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, `*_CREDENTIAL`).

## Tool Bundles

Named bundles passed via `AgentSpec.toolBundles`. At spawn, `bindToolsForAgentSpec(spec)` expands them into one `ToolBinding` artifact. `computeAllowlist(spec)` remains as a compatibility wrapper over `binding.allowlist`.

| Bundle | Tools | Used by |
|--------|-------|---------|
| `read` | `mcp__factory-tools__get_project_context`, read/search tools, git/diff tools | Investigator and read-only agents |
| `dev-tools` | `mcp__factory-tools__*` context, read/search, write/edit, verify, git/diff tools | Developer skills (`implement`, `implement-wp`, `resolve-conflict`) and dev workflows (`fix-issue`, `parallel-implement`, `fix-feedback`) |
| `qa-tools` | `mcp__factory-tools__*` context, read/search, git/diff, QA helpers | QA/review-style skills with no write tools |
| `validate` | `mcp__factory-tools__*` context, read/search, evidence tools | Playwright/evidence validation skills |
| `core` | no tools | Prompt-only skills |
| `emergency-debug` | `Bash` | Explicit opt-in escape hatch |
| `playwright-mcp` | `mcp__playwright-test__*` (browser/planner/generator) | `spec-author` skill (auto-merges `apps/web/.mcp.json`) |

Every default agent-facing bundle is composed of `mcp__factory-tools__*` names only. Native `Read`, `Write`, `Edit`, `Glob`, `Grep`, and broad `Bash` are not in default bundles; native `Bash` is available only through `emergency-debug`.

`mcp__factory-tools__record_decision` is part of the context tools and stays available to holdout roles so QA/reviewer runs can emit their own live decision summaries without seeing implementation reasoning. There is no separate single-tool decision bundle; runtime code should use the MCP context tool.

`ToolBinding` is the orchestrator-owned runtime contract for a run's tool surface. It contains the flat Claude allowlist, Codex `enabled_tools` grouped by MCP server, optional MCP server bundles, native tool names, sandbox/approval policy, and stable fingerprints for cache/cost analysis. Runtime code consumes this artifact instead of re-deriving bundle policy.

## Canonical Path Contract

`path-contract.ts` defines the reusable response shape for `factory-tools` MCP path-bearing results:

```ts
interface RepoRelativePath {
  path: string;
  root: 'worktree';
  packageRoot?: string;
  normalizedFrom?: string;
}
```

`canonicalizeFactoryToolPath({ rawPath, worktreePath })` reuses the shared repo-relative normalizer from `core/workspaces/path-normalization.ts`. It strips absolute worktree paths where workflow code passes them internally, resolves uniquely discoverable package-relative paths, and returns a structured `ambiguous-repo-relative-path` error with candidates when a package-relative path cannot be chosen safely.

The MCP path policy (`mcp/path-policy.ts`) is a denylist-first wrapper over this contract. Agent-supplied paths that are absolute, use `..` / `~`, touch assistant/Factory internals, or resolve outside the worktree are rejected before the tool runs. Every path-bearing tool response returns `RepoRelativePath` rather than a bare string.

## factory-tools MCP Server

`mcp/` contains the active tool layer for spawned agents. See `mcp/README.md` and ADR 0045 for the full surface.

Core properties:

- Agents express intent through `mcp__factory-tools__*` tools; Factory builds argv, validates paths, caps output, and emits audit events.
- `mcp/audit.ts` emits `agent.tool-call` events through `normalizeToolCallAuditPayload()`, carrying sanitized `tool_input`, `raw_path`, and `canonical_path` where a path is present.
- Workflow-owned operations such as staging, committing, PR mutation, issue comments, state transitions, and evidence publishing are not registered with the MCP server. Workflows import those helpers directly.
- Legacy in-process helpers `core/tool-layer/tools/{read,write,bash,test}.ts` were deleted. `core/tool-layer/tools/record-decision.ts` remains because the decisions API and record-decision slice still import it.

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

For MCP calls, the MCP server itself emits the same event kind with the normalized audit payload. Hook-originated native-tool events use the historical `tool_name` / `tool_input` shape; MCP-originated events also provide `tool_name` / `tool_input` so downstream timeline and workflow consumers can use one contract.

## PostToolUse Hook

The PostToolUse script (`post-tool-use-hook.ts`) fires after each tool call and scans the agent's `transcript_path` for new `[decision] …` marker lines since the last fire:

1. Reads the CC hook JSON from stdin to get `transcript_path`
2. Maintains a per-run byte-offset cursor at `~/.factory/hooks/state/<runId>.cursor` to avoid re-emitting markers
3. Extracts markers via `/^\[decision\]\s+(.+)$/gm`
4. POSTs each marker to `POST /events/decision-summary` as `agent.decision-summary-live`
5. All failures are best-effort — a failing POST never blocks the agent's tool execution
