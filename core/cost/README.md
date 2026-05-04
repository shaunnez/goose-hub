# core/cost

Persists per-run agent cost so the UI can show:

- total spend (this week, this month) at the project level
- per-stage breakdown (Triage / Investigate / Dev / QA / Review / Retrospective)
- per-task breakdown on the Costs tab in the detail page

## Schema (`agent_run_costs`)

One row per agent run, keyed on `runId`.

| Column | Type | Notes |
|---|---|---|
| `runId` | text, unique | Canonical workflow isolation key (FACTORY_RULES rule 7 / CONTEXT.md) |
| `projectId` | text | Project slug (e.g. `goose-hub-self`) |
| `workItemId` | text? | `github:owner/repo#N` — null for project-level runs |
| `stage` | text | `triage`/`investigate`/`dev`/`qa`/`review`/`retrospective`/`other` |
| `skill` | text | The exact skill name that ran (e.g. `retrospective-deep`) |
| `modelId` | text | Model used (e.g. `claude-sonnet-4-6`) |
| `inputTokens` | int | Prompt tokens |
| `outputTokens` | int | Completion tokens |
| `costUsd` | real | Dollar figure for this run |
| `costLabel` | text | `'estimated'` or `'exact'` — see below |
| `personaId` | text? | Persona that ran (e.g. `goose-hub-self/qa/0`) |
| `createdAt` | text | ISO-8601 |

The `runId` unique index means duplicate inserts (retry loops) are ignored.

## How rows are populated

The Claude CLI runtime calls `recordCost()` once per successful run, after
parsing the `--output-format json` envelope. `costFromCliEnvelope()` reads
`total_cost_usd` and `usage.{input_tokens,output_tokens}` from the envelope
when present and returns a `CostUsage` with `costLabel: 'estimated'`. When
the envelope has neither field we still record a zero-cost row so every run
shows up on the dashboard — the `costLabel` is `'estimated'` and the cost
is `0`.

When a future code path talks to the Anthropic SDK directly (rather than
spawning the CLI), it should call `costFromApiUsage()` to construct a
`CostUsage` with `costLabel: 'exact'`. The dashboard surfaces this label
verbatim — see M9.09 for UI rendering rules (`~$0.04` vs `$0.04`).

## Stage mapping

`skill-stage.ts` maps each skill name to a high-level stage. The stage is
purely a UI grouping; the `skill` column is preserved so finer breakdowns
remain possible from raw rows. Unknown skills land in `other`.

## API surface (server)

The `costs/` server domain reads from this table — it never writes. Only the
agent runtime appends cost rows.
