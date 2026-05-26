# slices/record-decision

M19.06: decision-record persistence — synchronous SQLite write with iteration + phase metadata.

Closes #563.

## What it does

Adds decision-record persistence for the MCP `mcp__factory-tools__record_decision` tool, which agents call synchronously to persist structured `DecisionRecord` entries to the `agent_decisions` SQLite table. This is an A/B evaluation against the existing two-stream decision model (live `[decision]` markers + end-of-run schema field).

Shipped behind `experimental.recordDecisionTool: true` in project config (default: false).

## Components

| Path | Export | Purpose |
|------|--------|---------|
| `core/db/schema.ts` | `agentDecisions` | New `agent_decisions` table |
| `core/db/migrations/0007_agent_decisions.sql` | — | DDL migration |
| `core/types.ts` | `ProjectConfig.experimental.recordDecisionTool` | Feature flag |
| `core/tool-layer/tools/record-decision.ts` | `recordDecision`, `readRunDecisions` | Business logic |
| `core/tool-layer/mcp/tools/context.ts` | `recordDecisionTool` | MCP wrapper |
| `scripts/eval-decision-streams.ts` | — | A/B eval harness |

## `agent_decisions` table

```
id TEXT PRIMARY KEY         -- randomUUID()
run_id TEXT NOT NULL        -- links to the agent run
iteration INTEGER           -- iteration within the run (default 0)
phase TEXT                  -- e.g. 'plan', 'implement', '' (default '')
kind TEXT NOT NULL          -- DecisionKind; unknown values coerced to 'UNKNOWN'
what TEXT NOT NULL          -- summary (maps to DecisionSummary.summary)
why TEXT NOT NULL           -- rationale (maps to DecisionSummary.evidence)
ts TEXT                     -- ISO timestamp (set by SQLite default)
```

Deduplication: `UNIQUE (run_id, kind, what)` — a second call with the same triple is a no-op returning `{ recorded: false, id: <existing>, reason: 'duplicate' }`.

## Holdout discipline

The MCP `record_decision` context tool stays available to `qa` and `reviewer` so holdout runs can emit their own live decision summaries. Holdout isolation is enforced by context assembly and role-specific prompts: QA/reviewer do not receive implementation reasoning or developer decision records, but they may write their own verification/review decisions.

## Reconciliation at run end

When the flag is on and the run made tool calls, `readRunDecisions(runId)` returns the DB rows as `DecisionSummary[]`. The orchestrator can use these in place of (or merged with) the end-of-run schema field extractions.

## A/B evaluation

```sh
# Compare all runs in the DB
pnpm tsx scripts/eval-decision-streams.ts

# Focus on one run
pnpm tsx scripts/eval-decision-streams.ts --run-id <id>

# JSON output for piping
pnpm tsx scripts/eval-decision-streams.ts --json
```

After 5–10 M19 runs with the flag on, decide whether to promote, discard, or keep as hybrid (per issue #563 open question).

## State transitions

This slice contains no workflow or state transition logic. It is a pure infrastructure addition consumed by the orchestrator.
