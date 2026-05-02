# Playwright Test Agents (dev-time scaffold)

Microsoft's `playwright-test-{planner,generator,healer}` subagents, installed via
`npx playwright init-agents --loop=claude` (Playwright 1.56+).

**These are Claude Code IDE subagents, not Factory skills.** They are invoked by
a human running Claude Code locally — never by `core/orchestrator/`. FACTORY_RULES
rule 13 ("Skills are versioned markdown with JSON schemas in `skills/<name>/`")
applies to Factory skills only; see `docs/adr/0011-playwright-test-agents-and-evidence-pipeline.md`
for the rationale.

## When to invoke them

Run `claude` from `apps/web/` so the `playwright-test` MCP server in `.mcp.json`
auto-loads. Then in the chat:

| Goal | Subagent |
|---|---|
| Explore a running app and write a markdown test plan | `playwright-test-planner` |
| Turn a plan scenario into a runnable spec, verifying selectors live | `playwright-test-generator` |
| Debug a failing spec using console / network / snapshots | `playwright-test-healer` |

The planner writes plans to `specs/`; the generator writes specs to `e2e/`;
the healer mutates failing specs in place.

## Pre-requisites

The dev server must be running for the planner to navigate: `pnpm --filter @goose-hub/web dev`.

## Boundaries

- Generated specs land in `apps/web/e2e/`. Do not check in spec files that target
  external URLs (sandbox safety) — point them at `localhost:5173` or use
  `page.setContent()` with inline HTML.
- The Factory dev workflow does NOT call these subagents directly today. A
  Factory skill that authors specs against the same `playwright-test` MCP is
  scoped for M7 (filed separately).
