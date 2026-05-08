# ADR 0036 — Codex CLI runtime sibling and `runtime: 'auto'` dispatch

**Status:** Accepted
**Date:** 2026-05-08
**Issue:** #594 (M19.10)
**Builds on:** [ADR 0034](./0034-provider-aware-model-routing.md) (provider field on models, `runtime: 'auto'` declared but no dispatcher)

## Context

ADR 0034 established the seams: every `MODELS[]` entry carries a `provider`, every skill carries an optional `provider`, and `agentConfig.runtime` accepts `'claude-cli' | 'codex-cli' | 'auto'`. What it did not ship: the actual second runtime, and the dispatch logic that picks between them.

Today every workflow does `deps.runtime ?? new ClaudeCliRuntime()`. There are 12+ such call sites (workflows under `core/workflows/` and `slices/`). Hard-coding `ClaudeCliRuntime` is the right default while there is only one runtime, but blocks #595 (`skills/dev-review/`) where `provider: 'codex'` is required.

OpenAI ships a `codex` CLI with headless invocation (`codex exec`) and OAuth-based credential storage at `~/.codex/auth.json` ("Sign in with ChatGPT"). The shape of its JSON output and the exact non-interactive flag are version-dependent; we cannot pin them precisely without running the CLI live, and CI cannot exercise OAuth.

## Decision

### 1. New `CodexCliRuntime` class

`core/agent-runtime/codex-cli.ts` exports `class CodexCliRuntime implements AgentRuntime` with the same public method (`run(spec): Promise<AgentResult>`) as `ClaudeCliRuntime`. Callers that hold an `AgentRuntime` reference cannot tell which concrete runtime they have — that is the point.

The implementation mirrors `claude-cli.ts` for everything except the four points below; sharing structure (rather than abstracting a base class) keeps both runtimes legible side by side.

| Concern | Claude CLI | Codex CLI |
|---|---|---|
| Binary | `claude` (override `CLAUDE_BIN` if any) | `codex` (override `CODEX_BIN`) |
| Pre-flight | none | `~/.codex/auth.json` must exist |
| Argv | `--print --no-session-persistence --max-turns N --max-budget-usd N --model M --output-format json --mcp-config P --strict-mcp-config [--system-prompt …] [--allowedTools …] [--json-schema …] <prompt>` | `exec --json --model M --skip-git-repo-check --cd <workspaceDir> [--full-auto] [-c …]` (final shape verified at first live integration; argv assembly isolated in `buildCodexArgv()` for easy revision) |
| Output envelope | Single JSON envelope on stdout: `{ is_error, result, usage, total_cost_usd, num_turns, … }` | Streaming JSON lines or a single envelope; we accept either. Best-effort field mapping documented below. |

### 2. Typed errors

Two new error classes in `core/agent-runtime/codex-cli.ts`:

- `CodexBinaryNotFoundError` — thrown by `resolveBinary('codex')` when the binary cannot be located on PATH (or via `CODEX_BIN`). Message instructs the user to install the Codex CLI.
- `CodexNotAuthenticatedError` — thrown by the pre-flight check when **both** auth paths are missing: no `~/.codex/auth.json` AND no non-empty `OPENAI_API_KEY` env var. Either is sufficient. Message instructs the user to run `codex login`.

Both are caught by the existing fallback layer (`fallback.ts`) the same way `ClaudeCliRuntime`'s spawn errors are: holdout roles re-raise as `HoldoutFallbackForbiddenError`; non-holdout, non-critical roles get one down-tier retry; otherwise the error propagates.

**Auth precedence:** `OPENAI_API_KEY` if present and non-empty wins; the OAuth token at `~/.codex/auth.json` is checked only when no API key is configured. The Codex CLI itself reads both, so we don't pass either explicitly — pre-flight just gates the spawn.

**System prompt → TOML override:** the skill's `appendSystemPrompt` (markdown content from `prompt.md`) is forwarded to Codex via `-c instructions="""…"""`, a TOML multi-line basic string. Multi-line strings carry literal newlines, so only `\` (TOML escape character) and embedded `"""` (which would terminate the delimiter) are escaped. `escapeForTomlMultilineBasic()` is exported for unit tests.

### 3. Output normalisation map

The Codex JSON envelope is best-effort mapped to the same `AgentResult` shape and `agent.run-completed` event payload as Claude. Field aliases probed in order, taking the first numeric / present value:

| Internal field | Claude key(s) | Codex key(s) (assumed) |
|---|---|---|
| Final result | `result` | `result`, `output`, `text` |
| Input tokens | `usage.input_tokens` | `usage.input_tokens`, `tokens.input` |
| Output tokens | `usage.output_tokens` | `usage.output_tokens`, `tokens.output` |
| Cost USD | `total_cost_usd` | `total_cost_usd`, `cost_usd`, `cost` |
| Turn count | `num_turns` | `num_turns`, `turns` |
| Error flag | `is_error` | `error` (string or boolean) |

`costFromCliEnvelope` already probes the existing alias list — it works for Codex without modification. When neither token nor cost field is recognised, the cost row is written zeroed with `costLabel: 'estimated'`, matching Claude's existing fallback path. No silent run loss.

The internal lifecycle event names (`agent.run-started`, `agent.run-completed`, `agent.run-failed`, `tool.timeout`, `tool.stdout-truncated`, `agent.log`) are emitted identically. Hook integration (`deployHooks()`, `FACTORY_RUN_ALLOWLIST`, `FACTORY_RUN_ID`, `FACTORY_SERVER_PORT`) is identical — Codex CLI tool calls flow through the same PreToolUse/PostToolUse hooks via the same env contract.

### 4. `selectRuntime()` dispatcher

`core/agent-runtime/select-runtime.ts` exports a pure factory:

```ts
selectRuntime(opts: {
  configRuntime: 'claude-cli' | 'codex-cli' | 'auto';
  model?: string;          // resolved model ID (from selectModelForRole + tier→ID)
  skillProvider?: 'claude' | 'codex';  // SkillConfig.provider hint
}): AgentRuntime
```

Resolution:
1. `configRuntime === 'claude-cli'` → `ClaudeCliRuntime` regardless of model.
2. `configRuntime === 'codex-cli'` → `CodexCliRuntime` regardless of model.
3. `configRuntime === 'auto'`:
   1. If a model is provided, look up `MODELS[].provider` for that ID. Picks `CodexCliRuntime` for `codex`, `ClaudeCliRuntime` for `claude`.
   2. Else if `skillProvider` is provided, dispatch on it.
   3. Else default to `ClaudeCliRuntime` (safe default — matches today's hard-coded behaviour).

The function is pure, has no I/O, and takes its inputs as a plain object so call sites do not need to import either runtime class directly.

### 5. Migration path

Existing call sites (`deps.runtime ?? new ClaudeCliRuntime()`) are **not changed in this PR**. The dispatcher is opt-in: new code paths that need provider-aware spawn (M19.11/M19.12 dev-review) will use `selectRuntime()`. Migrating the existing 12+ call sites is deferred to a follow-up so behaviour change is reviewable in isolation.

Project configs that set `runtime: 'auto'` continue to behave exactly as today until a workflow consumes the dispatcher: `'auto'` is meaningful only at the dispatch site.

### 6. Codex model entries

`MODELS[]` adds Codex entries:

```ts
{ id: 'gpt-5-codex',          tier: 'sonnet', provider: 'codex' },
{ id: 'gpt-5-codex-mini',     tier: 'haiku',  provider: 'codex' },
```

We do not declare an `opus`-tier Codex entry until OpenAI ships a heavier reasoning Codex variant; today's Codex tiers are best mapped to haiku/sonnet. `defaultModelForTier(tier)` retains its single-arg signature (Claude-first); a new helper `defaultModelForTierAndProvider(tier, provider)` is exposed for the dispatcher.

The exact model IDs above match OpenAI's published Codex model names at filing time and are isolated to one constant — easy to revise when a new tier ships.

### 7. Settings UI

`apps/web/src/components/settings/components/ProjectModelPanel.tsx` gains a "Codex auth" subsection:

- Read-only status: **Connected** / **Run `codex login` to connect**, plus a copy-to-clipboard button for the install/login command.
- Backed by a global server route `GET /codex-auth/status` (status is per-machine, not per-project; placing it inside the project model panel is purely a UI placement decision).

No interactive OAuth from the web UI — same constraint as Claude.

### 8. Why not `sh -c`

Codex CLI's `exec` mode reads its prompt from argv (or `--prompt-file`). We pass it as the final argv positional. `shell: false` is preserved (FACTORY_RULES rule 29). Shell metacharacter handling is the agent's responsibility inside the prompt body — never wrapped by us.

## Consequences

- A second runtime exists; subsequent issues (M19.11, M19.12) can declare `provider: 'codex'` on a skill and the dispatcher picks the right runtime without further wiring.
- The Claude path is unchanged — every existing test stays green without modification.
- Live Codex output may diverge from the assumed envelope shape. The mapping is isolated to `parseCodexEnvelope()` (private) so a future PR can tighten it without touching the spawn or event-emission logic. A `[decision] BLOCKER: codex envelope shape unknown — using best-effort mapping` is emitted on the first run that hits the fallback path.
- Holdout roles do not gain a Codex variant in this issue. M19.13 (parallel reviewer) is filed separately and currently deferred for evaluation.
- The 12+ existing call sites continue to construct `new ClaudeCliRuntime()` directly. Migrating them is a follow-up issue and not required for #595/#596.

## References

- ADR 0034 (provider-aware model routing) — `runtime: 'auto'` field + `provider` on models
- `core/agent-runtime/claude-cli.ts` — reference implementation
- `core/agent-runtime/fallback.ts` — wrapper compatible with both runtimes
- FACTORY_RULES rule 29 (no `shell: true`), rule 32 (timeouts)
