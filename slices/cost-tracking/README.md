# slices/cost-tracking

Per-run cost persistence and dashboard surfaces. Closes M9.08.

## What it does

Every Claude CLI agent run writes a row to `agent_run_costs` once the envelope
parses. The dashboard surfaces aggregate spend per stage; the per-task Costs
tab shows every run's row for that work item. Cost figures are tagged
`'estimated'` (from CLI rollups) or `'exact'` (from authoritative API usage
metadata) so the UI can qualify them — see M9.09 for the rendering rules.

## Vertical surfaces touched

- **DB**: `core/db/schema.ts` — `agent_run_costs` table (one row per `runId`)
- **Core lib**: `core/cost/` — extraction (`extract.ts`), persistence
  (`repository.ts`), skill→stage mapping (`skill-stage.ts`), shared types
- **Runtime hook**: `core/agent-runtime/claude-cli.ts` — `recordCost()` is
  called on the `agent.run-completed` path; the event payload also carries
  the cost so subscribers can react
- **Server API**: `apps/server/src/domains/costs/` — read-only endpoints
  - `GET /projects/:slug/costs/summary` → week/month + per-stage breakdown
  - `GET /projects/:slug/issues/:id/costs` → per-task rows
- **Web nav + page**: `apps/web/src/components/costs/CostsPage.tsx` mounted
  at `/projects/:slug/costs`
- **Web detail tab**: `apps/web/src/components/detail/components/CostsSection.tsx`

## Trust labels

`costLabel = 'estimated'` is the default — the Claude CLI's
`--output-format json` envelope reports a rollup, not authoritative metadata.
The UI prefixes a tilde (`~$0.04`). When a future code path talks to the
Anthropic SDK directly, it should construct a `CostUsage` via
`costFromApiUsage()` to mark it `'exact'`.

## Why a slice rather than horizontal layers

FACTORY_RULES rule 24 — every feature ships as one slice that names every
surface it touches. The persistence test lives in `slice.test.ts`; the
component-level tests stay in their respective files.

## Tests

`slice.test.ts` covers the canonical lifecycle: envelope → extract → record →
read via repository. Component tests:

- `core/cost/extract.test.ts` — envelope parsing edge cases
- `core/cost/skill-stage.test.ts` — skill→stage mapping
- `core/cost/repository.test.ts` — persistence + idempotency + aggregate queries
- `apps/server/src/domains/costs/service.test.ts` — service layer with mocked repo
