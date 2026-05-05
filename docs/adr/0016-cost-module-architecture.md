# ADR 0016: Cost Module Architecture

**Status:** Accepted  
**Date:** 2026-05-05  
**Milestone:** M9 — Retrospective and Learning Loop

## Context

M9 required persisting actual or estimated agent-run costs so the UI could show per-stage breakdowns and a project-level cost dashboard. Two cost sources need to coexist:

1. **Claude CLI** — emits a `total_cost_usd` field in its `--output-format json` envelope, but the number is a rollup the CLI computed internally. It cannot be independently verified, so it is labelled `'estimated'`.
2. **Direct Anthropic API** (future) — returns authoritative `usage.input_tokens` and `usage.output_tokens` from the API response. Costs derived from this source are labelled `'exact'`.

The design question was where to put extraction logic, what shape the DB row should take, and how to enforce the estimated/exact distinction throughout the stack.

## Decision

### 1. New `core/cost/` module — single owner of cost persistence

All cost logic lives in `core/cost/`: extraction (`extract.ts`), persistence (`repository.ts`), skill-to-stage mapping (`skill-stage.ts`), and shared types (`types.ts`). No other module reimplements these functions.

The `costs/` server domain only reads — it never writes. Only the agent runtime appends rows, called once per successful skill run via `recordCost()`.

### 2. `CostUsage` type carries `costLabel` from the point of construction

`CostUsage` is the transfer object between extraction and storage. It includes `costLabel: 'estimated' | 'exact'` as a required field. This makes the distinction impossible to lose in transit: the label is set at the moment cost data is parsed, not added as an afterthought before storage.

`costFromCliEnvelope()` always returns `costLabel: 'estimated'`. `costFromApiUsage()` always returns `costLabel: 'exact'`. There is no code path that stores a cost row without a label.

### 3. One row per `runId` in `agent_run_costs`

The `runId` unique index means duplicate inserts (from retry loops or webhook re-deliveries) are silently ignored. Every run produces exactly one cost row, even if `costUsd` is `0` — this ensures every run appears on the dashboard regardless of whether the CLI reported a cost.

### 4. `skill-stage.ts` maps skill names to UI stage buckets

The `stage` column groups costs into `triage`, `investigate`, `dev`, `qa`, `review`, `retrospective`, `other`. The `skill` column is also persisted so finer-grained breakdown remains possible from raw queries. Stage is UI-only metadata; it never influences workflow logic.

### 5. UI labelling convention: `~$0.04` for estimated, `$0.04` for exact

Estimated costs render with a tilde prefix or `est.` badge. Exact costs render without qualification. A legend explains the distinction on first encounter. This convention is enforced in the frontend components, not in the DB schema.

## Consequences

**Positive:**
- Every cost row has a verifiable provenance label; the UI cannot silently show an estimated figure as authoritative.
- The zero-cost fallback means dashboards always reflect every run, making spend gaps visible.
- Duplicate-insert safety via unique index requires no application-layer deduplication.

**Trade-offs:**
- CLI-sourced costs are inherently imprecise (the CLI's rollup may differ from per-model API prices). Until direct API integration is added, all production cost data will be `'estimated'`. The label is the honest acknowledgement of this.
- `skill-stage.ts` must be updated when new skills are added. An unknown skill falls into `other` rather than failing — a deliberate soft fallback.

## Alternatives Considered

**Alternative A: Store costs inline on agent run events** — add cost fields to existing `agent.run-completed` event payloads. Rejected: event payloads are for observability, not persistent queries. A dedicated table supports indexed queries by project, stage, and time range without scanning the event log.

**Alternative B: Infer estimated/exact from model ID** — assume Claude CLI runs are always estimated, API runs always exact, and derive the label from context rather than storing it. Rejected: too fragile as the runtime evolves. Explicit `costLabel` in `CostUsage` at construction time is unambiguous and self-documenting.
