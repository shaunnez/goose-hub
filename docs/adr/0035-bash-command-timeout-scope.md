# ADR 0035 — Bash Command Timeout Scope and Field Naming

**Status:** Accepted; superseded for agent-facing tool execution by ADR 0045
**Date:** 2026-05-08
**Issue:** #630 (wire dead global budget fields from PR #628)

---

## Context

PR #628 added the `project_settings` table with three fields that are stored,
exposed via API, and rendered in the UI but not yet read at runtime:
`maxBashSeconds`, `perAgentMaxUsd`, and `maxIssuesPerDayFromNonOwners`.

`maxBashSeconds` required a scope decision before it could be wired. At the
time of this ADR, two timeout locations existed in the codebase:

1. **Per-invocation** — the pre-MCP in-process bash helper
   (`core/tool-layer/tools/bash.ts`) capped any single `runBash()` call and
   accepted a `timeoutMs` override parameter. That helper was later deleted
   during the ADR 0045 `factory-tools` MCP migration.

2. **Whole-agent-run** — `core/agent-runtime/claude-cli.ts:233` reads
   `spec.budgets.timeoutMs` to time-bound the entire Claude CLI subprocess.
   This is per-skill, already configurable through `project_skill_settings.timeoutMs`,
   and editable per-skill in the existing UI.

The agent's own bash tool calls (issued *inside* a Claude CLI run) are governed
by Claude CLI internals and cannot be capped per-command from the orchestrator.

## Decision

`maxBashSeconds` caps **per-invocation orchestrator-side command/tool calls
only**. It overrides the default per-command timeout for that project. It does
**not** affect agent-run timeouts and does **not** affect native bash commands
an agent issues inside a Claude CLI run.

Precedence for command runners:

```
effectiveTimeoutMs = explicitParam ?? (dbRow.perBashCommandMaxSeconds * 1000) ?? toolDefaultTimeoutMs
```

The DB value is in seconds (matching the field name and UI affordance); it is
multiplied by 1000 at the call site.

### Rename

The field is renamed from `maxBashSeconds` to **`perBashCommandMaxSeconds`**:

- Existing `project_settings` columns follow a `per<X>Max<Unit>` pattern
  (`perWorkflowMaxUsd`, `perAgentMaxUsd`, `perAdvisorMaxUsd`). The bash field
  should match.
- The word "Command" disambiguates per-invocation vs. whole-agent-run
  (the ambiguity that motivated this ADR).
- The field is not yet enforced and has no production data, so the rename is
  free; a Drizzle migration drops the old column and adds the new one.

## Why not the whole-agent-run scope?

Routing `maxBashSeconds` to `spec.budgets.timeoutMs` would create three ways to
configure the same value:

1. `SKILL_BUDGETS[skill].timeoutMs` (built-in default)
2. `projectConfig.budgets.skillBudgetOverrides[skill].timeoutMs`
3. `project_skill_settings.timeoutMs` (DB row, UI-editable per skill)

Adding a fourth global override that silently caps all of the above would make
the resolution order opaque and would not match the field's name. The existing
per-skill `timeoutMs` already handles whole-agent-run timeouts cleanly.

## Why not also wire the agent's own bash calls?

The agent runs inside a Claude CLI subprocess. Claude CLI does not expose a
per-bash-command timeout that the orchestrator can pass in. Capping the agent's
internal bash calls would require either (a) replacing Claude CLI's bash tool
with our own subprocess shim, or (b) post-hoc kill via PID inspection. Both
are out of scope for #630 and would warrant a separate ADR.

## Supersession

ADR 0045 replaced the unused `runBash()` helper path with the `factory-tools`
MCP server. Agent-facing bundles now use `mcp__factory-tools__*` tools instead
of native broad `Bash` or the deleted `core/tool-layer/tools/bash.ts` helper.
MCP command tools own argv construction, timeout selection, output caps, and
audit events. Any future per-project `perBashCommandMaxSeconds` enforcement
belongs in the MCP command-policy/verify-tool layer rather than in deleted
`runBash()` callers.

The original scope decision still stands: this setting is for individual
command/tool invocations, not whole agent runs.

## Consequences

- `core/db/schema.ts` `project_settings.maxBashSeconds` → `perBashCommandMaxSeconds`.
  Migration required.
- `core/db/repositories/project-settings.ts`, `apps/server/src/domains/project-settings/router.ts`,
  `apps/web/src/lib/api.ts`, and `apps/web/src/components/settings/components/ProjectBudgetPanel.tsx`
  rename in lockstep.
- MCP command tools with a `projectId` available need to read the resolved
  value and apply it as a per-invocation timeout. Callers without a `projectId`
  continue to use the tool default.
- `maxIssuesPerDayFromNonOwners` is descoped (see #630 task 3) — Goose Hub is
  single-user (CLAUDE.md), there are no non-owners. Schema column dropped in
  the same migration.
- `perAgentMaxUsd` is wired separately as a cap on `resolveBudgetsForProject`
  output, analogous to the existing `perWorkflowMaxUsd` cap (#630 task 1).
