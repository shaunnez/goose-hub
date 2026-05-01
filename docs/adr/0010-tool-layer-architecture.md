# ADR 0010 — Tool layer architecture (M4)

Status: accepted
Date: 2026-05-02
Closes part of: M4 (issue #96)

## Context

M4 introduced `core/tool-layer/` — the layer that governs which tools a Claude CLI agent may
use, and what sandbox rules are written into its workspace. Several structural decisions are
not obvious from the code.

## Decisions

### 1. Bundles over per-tool allowlists

Tools are grouped into named bundles (`read-only`, `read-write`, `bash-restricted`).
Skills declare which bundles they need; `computeAllowlist` expands them at spawn time.

Reason: skill configs stay readable and stable as the tool set grows. A skill that needs
filesystem reads doesn't enumerate every read tool — it declares `['read-only']`.
New tools added to a bundle are automatically available to all skills using that bundle.

### 2. Denylist written to workspace settings.json, not passed as argv

Pattern-level deny rules (`Read(./.env*)`, `Bash(sudo *)`, `Bash(rm -rf *)`) are written
to `<workspace>/.claude/settings.json` by `writeWorkspaceSandbox()`, not passed as
`--disallowedTools` argv flags.

Reason: workspace-level settings are evaluated by Claude Code's own permission system before
tool execution. They survive process restarts and are visible in the workspace directory for
auditing. The `--disallowedTools` flag only applies for the current invocation; settings.json
applies for any invocation in that workspace.

### 3. No separate `bash-denylist.ts` file

PLAN.md section 6 listed `bash-denylist.ts` as a separate file. The denylist is instead a
constant in `sandbox.ts` alongside the settings-writer that uses it. At M4 there are three
deny patterns; a separate file would be over-separation. Promote to its own module when the
deny pattern set requires independent management or testing.

### 4. PreToolUse hook deployed to `~/.factory/hooks/` once, not per-workspace

The `deployHooks()` call in `ClaudeCliRuntime.run()` writes the PreToolUse hook script to
`~/.factory/hooks/` on first run (idempotent). It is NOT per-workspace because the hook
enforces the FACTORY_RUN_ALLOWLIST env var set at spawn time — the per-run identity is
carried in the environment, not the hook path.

This decision is recorded in CONTEXT.md under "Agent Runtime — Resolved Decisions".

### 5. `tool-layer/interface.ts` not created at M4

PLAN.md section 6 shows `interface.ts` in `tool-layer/`. No such file was created because
the tool layer has no consumer-facing polymorphism at M4 — it is a set of pure functions,
not an interface with multiple implementations. Add `interface.ts` when a second
implementation (e.g. a remote tool proxy) is needed.

## Consequences

- Expanding the deny patterns requires only editing the `DENYLIST` constant in `sandbox.ts`.
- Adding a new bundle requires editing `bundles.ts` and writing a test; no other files change.
- The tool layer has no runtime state — all functions are pure, making them trivially testable.
