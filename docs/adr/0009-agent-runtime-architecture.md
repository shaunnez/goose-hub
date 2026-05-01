# ADR 0009 — Agent runtime architecture (M4)

Status: accepted
Date: 2026-05-02
Closes part of: M4 (issues #89, #90, #91, #95, #96, #97, #98, #99, #100)

## Context

M4 introduced `core/agent-runtime/` — the layer that runs AI agents as Claude CLI subprocesses.
Several non-obvious decisions were made during implementation that are not visible from the code alone.

## Decisions

### 1. Claude CLI subprocess, not SDK

`ClaudeCliRuntime` spawns `claude --print` as a subprocess rather than calling the Anthropic SDK directly.

Reason: the CLI enforces its own tool sandboxing, `PreToolUse` hook deployment, and per-workspace
`.claude/settings.json` — all of which are safety properties we want. The SDK gives raw API access
but bypasses the Claude Code tool permission layer. Using the CLI also means factory agents run in
the same security model as interactive Claude Code sessions.

### 2. Absolute binary resolution, minimal env, argv array

Three security rules enforced unconditionally (now §29–31 of FACTORY_RULES):

- Binary resolved to absolute path via `which` — never implicit PATH lookup.
- argv always passed as an array, `shell: false` — no shell expansion risk.
- Subprocess env is an explicit minimal set (HOME, PATH, ANTHROPIC_API_KEY if present,
  FACTORY_RUN_ALLOWLIST, FACTORY_RUN_ID) — no parent `process.env` passthrough.

### 3. `context-assembly.ts` named instead of `fresh-context.ts`

PLAN.md section 6 named this file `fresh-context.ts`. Implementation used `context-assembly.ts`
because the module's job is assembling all context inputs (allowlist filtering, XML rendering,
future ambient injection) — "context assembly" more accurately describes the full scope.
The `freshContext` flag is a field on `AgentSpec`; the file is the assembly point, not the flag.
PLAN.md section 6 is stale on this name.

### 4. Fallback never down-tiers holdouts or critical/high

`withFallback` checks role and priority before attempting any retry. Holdout roles (`qa`,
`reviewer`) and critical/high priority specs fail loudly on first error — no silent model
substitution. Standard roles get one down-tier retry (opus → sonnet → haiku).

This matches FACTORY_RULES rule 19 ("fallback never down-tiers on critical/high or holdouts")
and makes the policy explicit in code rather than relying on callers to configure it correctly.

### 5. Output schema passed as JSON Schema, not Zod

Claude CLI's `--json-schema` flag accepts JSON Schema. Skill configs carry Zod schemas.
`schema-bridge.ts` converts Zod → JSON Schema at spawn time via `zod-to-json-schema`.
The Zod schema remains the source of truth; JSON Schema is derived only for the subprocess call.

### 6. 4 MB stdout cap, 30 s hard timeout

Both are fixed constants in `claude-cli.ts` (not configurable per-spec at M4).
Rationale: these are safety floors, not tunable limits. Per-project budget caps (token spend,
max turns) travel via `--max-turns` and `--max-budget-usd` argv flags, which ARE spec-driven.
Making the cap and timeout configurable is deferred until a concrete use case requires it.

## Consequences

- Any change to the subprocess security model must be reflected in FACTORY_RULES §29–33.
- Adding ambient context injection (event stream, persona history) means editing `context-assembly.ts`
  — the single injection point — not scattered through callers.
- Future runtimes (SDK-based, remote) implement the `AgentRuntime` interface; switching is a
  one-line change at the call site.
