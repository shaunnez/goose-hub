# ADR 0035 — Bash Command Timeout Scope and Field Naming

**Status:** Accepted
**Date:** 2026-05-08
**Issue:** #630 (wire dead global budget fields from PR #628)

---

## Context

PR #628 added the `project_settings` table with three fields that are stored,
exposed via API, and rendered in the UI but not yet read at runtime:
`maxBashSeconds`, `perAgentMaxUsd`, and `maxIssuesPerDayFromNonOwners`.

`maxBashSeconds` requires a scope decision before it can be wired. Two timeout
locations already exist in the codebase:

1. **Per-invocation** — `core/tool-layer/tools/bash.ts:27` defines
   `BASH_TIMEOUT_MS = 30_000`. This caps any single `runBash()` call. The
   function already accepts a `timeoutMs` override parameter. This is the
   orchestrator's in-process bash, used for git operations, applying patches,
   etc. (FACTORY_RULES rule 32.)

2. **Whole-agent-run** — `core/agent-runtime/claude-cli.ts:233` reads
   `spec.budgets.timeoutMs` to time-bound the entire Claude CLI subprocess.
   This is per-skill, already configurable through `project_skill_settings.timeoutMs`,
   and editable per-skill in the existing UI.

The agent's own bash tool calls (issued *inside* a Claude CLI run) are governed
by Claude CLI internals and cannot be capped per-command from the orchestrator.

## Decision

`maxBashSeconds` caps **per-invocation orchestrator-side `runBash` calls only**.
It overrides the default `BASH_TIMEOUT_MS = 30_000` for that project. It does
**not** affect agent-run timeouts and does **not** affect bash commands the
agent issues inside a Claude CLI run.

Precedence (in `runBash` callers):

```
effectiveTimeoutMs = explicitParam ?? (dbRow.perBashCommandMaxSeconds * 1000) ?? BASH_TIMEOUT_MS
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

## Future consumption

`core/tool-layer/tools/bash.ts:runBash()` has no production callers at the time
of this ADR — `core/tool-layer/bundles.ts` lines 13–14 note that the MCP
sandboxed tool server is not yet wired up; agent bash runs through Claude CLI's
built-in tools governed by workspace-level deny rules in `sandbox.ts`. When the
MCP tool server lands, its bash adapter must read
`resolveGlobalSettingsForProject(projectId).perBashCommandMaxSeconds`,
multiply by 1000, and pass as the `timeoutMs` parameter to `runBash()` (only
when the caller hasn't already supplied an explicit `timeoutMs`).

Until then, the field is structurally enforced: it is read from DB, exposed via
the resolution layer, and ready for consumption. The "not yet enforced" UI
badge is still removed, because the orchestrator's resolution layer *does*
honour the value — it's the agent's bash subprocess that doesn't exist as a
consumer yet.

## Consequences

- `core/db/schema.ts` `project_settings.maxBashSeconds` → `perBashCommandMaxSeconds`.
  Migration required.
- `core/db/repositories/project-settings.ts`, `apps/server/src/domains/project-settings/router.ts`,
  `apps/web/src/lib/api.ts`, and `apps/web/src/components/settings/components/ProjectBudgetPanel.tsx`
  rename in lockstep.
- `runBash()` callers in `core/` that have a `projectId` available need to read
  the resolved value. A helper in `core/agent-runtime/resolve-for-project.ts`
  (extending `EffectiveGlobalSettings`) is the natural place; callers without a
  `projectId` continue to use the default.
- `maxIssuesPerDayFromNonOwners` is descoped (see #630 task 3) — Goose Hub is
  single-user (CLAUDE.md), there are no non-owners. Schema column dropped in
  the same migration.
- `perAgentMaxUsd` is wired separately as a cap on `resolveBudgetsForProject`
  output, analogous to the existing `perWorkflowMaxUsd` cap (#630 task 1).
