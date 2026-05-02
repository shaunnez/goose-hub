# skills/spec-author

Authors a runnable Playwright e2e spec for a new slice. Used by the M7 supervised dev workflow before the implementation skill ships the feature, so the slice has a failing-then-passing test from the start (TDD).

## How this differs from Microsoft's playwright-test subagents

`apps/web/.claude/agents/playwright-test-{planner,generator,healer}.md` are **dev-time scaffolding** invoked by a human running Claude Code interactively in the IDE. They are NOT Factory skills.

`spec-author` is a **Factory skill** — invoked by the supervised dev workflow inside an autonomous-friendly subprocess with a tool allowlist, schema-validated output, and decision-summary discipline. It uses the same `playwright-test` MCP server that the human-facing subagents use (registered at `apps/web/.mcp.json`), so the underlying browser-driving capability is identical. The difference is the call site:

| | Microsoft subagents | `skills/spec-author/` (this skill) |
|---|---|---|
| Invoked by | Human in IDE | Factory workflow |
| Tool allowlist | None enforced | `playwright-mcp` + `read-write` |
| Output validation | Free-form | Zod schema (`SpecAuthorSchema`) |
| Decision summaries | None | Required (FACTORY_RULES rule 6) |
| Runs in | Live IDE session | `claude -p` subprocess |

ADR 0011 records the rationale.

## When this skill runs

- M7 supervised dev workflow, before the implementation skill (`skills/implement/`, separate issue) ships the slice
- Either as a sub-spawn of the developer skill or as an upstream node in the workflow — wired at the workflow level so the developer skill's output schema stays simple

## Inputs

`SpecAuthorContextSchema`:

| Field | Type | Description |
|---|---|---|
| `workItem.title` | `string` | Issue title |
| `workItem.body` | `string` | Issue body (slice scope, acceptance criteria) |
| `workItem.number` | `number` | Issue number (used to derive the spec filename) |
| `targetUrl` | `string` | Running dev server URL (e.g. `http://localhost:5173`) |
| `sliceDescription` | `string` | User-facing scenario the spec must exercise |

## Outputs

`SpecAuthorSchema`:

| Field | Type | Description |
|---|---|---|
| `specPath` | `string` | Workspace-relative path to the written spec, e.g. `apps/web/e2e/issue-235.spec.ts` |
| `planSummary` | `string` | One-paragraph summary of what the spec asserts |
| `screenshotsTaken` | `number` (≥ 0, integer) | Number of screenshots captured during exploration |
| `decisionSummaries` | `DecisionSummary[]` | Canonical decision-summary record (FACTORY_RULES rule 6) |

## Tool allowlist

- **`playwright-mcp`** — Microsoft's playwright-test MCP server (`browser_*`, `planner_*`, `generator_*`). The runtime auto-merges `apps/web/.mcp.json` into the spawn-time MCP config when this bundle is present.
- **`read-write`** — Read, Write, Edit, Glob, Grep. Lets the agent read existing fixtures and write the spec file under `apps/web/e2e/` if `generator_write_test` declines.

## Dev-server assumption

The skill assumes the dev server is reachable at the provided `targetUrl`. The Playwright config under `apps/web/playwright.config.ts` already has `webServer` auto-start, so the workflow does not need to boot the server explicitly.

## Filename convention

The skill writes specs to `apps/web/e2e/issue-<number>.spec.ts` to keep them traceable to the originating issue and easy to find in PR diffs.

## Context allowlist

| Key | Included |
|---|---|
| `workItem.title` | yes |
| `workItem.body` | yes |
| `workItem.number` | yes |
| `targetUrl` | yes |
| `sliceDescription` | yes |
