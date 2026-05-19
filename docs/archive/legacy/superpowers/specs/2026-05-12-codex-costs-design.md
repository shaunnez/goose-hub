# Codex Cost Tracking & Provider Breakdown

**Date:** 2026-05-12
**Status:** Approved

## Problem

Two issues:

1. **Bug** — Codex agent runs record `costUsd = 0`. Root cause: Codex CLI emits `turn.completed` with `usage.input_tokens` / `usage.output_tokens` but no `total_cost_usd`. `costFromCliEnvelope` collapses missing cost to `0`. The `CodexEnvelope.usage.costUsd` field is already typed `number | null`; line 491 of `codex-cli.ts` discards the null instead of branching to a pricing fallback.

2. **Feature** — Cost UI does not distinguish Claude vs Codex runs. Global costs page shows a single total; detail page shows model IDs but no provider grouping.

---

## Solution

### Part 1 — Pricing + cost fix (`core/`)

#### `core/agent-runtime/models.ts`

Add optional pricing to `ModelEntry`:

```ts
interface ModelEntry {
  id: string;
  tier: ModelTier;
  provider?: ModelProvider;
  deprecated?: boolean;
  pricing?: { inputPer1M: number; outputPer1M: number };
}
```

Populate for all six models:

| Model | inputPer1M | outputPer1M |
|---|---:|---:|
| `claude-opus-4-7` | 15.00 | 75.00 |
| `claude-sonnet-4-6` | 3.00 | 15.00 |
| `claude-haiku-4-5-20251001` | 0.80 | 4.00 |
| `gpt-5.5` | 5.00 | 30.00 |
| `gpt-5.4` | 2.50 | 15.00 |
| `gpt-5.4-mini` | 0.75 | 4.50 |

Claude pricing sourced from Anthropic's published API rates (approximate; update when rates change). Codex pricing from OpenAI pricing page as of 2026-05-12.

Add two helpers:

```ts
export function estimateCostUsd(modelId: string, inputTokens: number, outputTokens: number): number
// Returns 0 when model has no pricing entry — never throws.

export function tryProviderOf(modelId: string): ModelProvider
// Returns 'claude' on unknown model ID — never throws.
// Used everywhere cost reporting touches modelId from historical DB rows.
```

`providerOf` remains unchanged (still throws) for code paths that control model selection.

#### `core/agent-runtime/codex-cli.ts`

Change lines 489–491 from:

```ts
const usageInputTokens = envelope?.usage.inputTokens ?? 0;
const usageOutputTokens = envelope?.usage.outputTokens ?? 0;
const costUsd = envelope?.usage.costUsd ?? 0;
```

to:

```ts
const usageInputTokens = envelope?.usage.inputTokens ?? 0;
const usageOutputTokens = envelope?.usage.outputTokens ?? 0;
const rawCostUsd = envelope?.usage.costUsd ?? null;
const costUsd = rawCostUsd ?? estimateCostUsd(model, usageInputTokens, usageOutputTokens);
```

`costLabel` stays `'estimated'` — derived from token counts, not from CLI-reported USD.

#### Tests

- Lock `costFromCliEnvelope` behavior: assert it returns `costUsd: 0` (not null) when cost field is absent but tokens are present.
- Add `parseCodexEnvelope` test: NDJSON with `usage.input_tokens` / `usage.output_tokens` but no cost field → `costUsd === null`.
- Add `estimateCostUsd` unit tests: known inputs → expected USD output; unknown model ID → 0.
- Add `tryProviderOf` unit tests: known IDs → correct provider; unknown ID → `'claude'`.

---

### Part 2 — Server DTOs (`apps/server/`)

#### `apps/web/src/lib/types.ts` (and matching server-side type)

`CostRowDto` gains:
```ts
provider: 'claude' | 'codex';
```

`CostSummaryDto` gains:
```ts
byProvider: {
  claude: CostWindowTotals;
  codex: CostWindowTotals;
};
```

#### `apps/server/src/domains/costs/service.ts`

`getCostsForWorkItem`: for each row, append `provider: tryProviderOf(row.modelId)`.

`getCostSummary`: after computing `windows`, also compute `byProvider` by partitioning the same 30-day rows by `tryProviderOf(row.modelId)` and aggregating `totalUsd` / `totalRuns` / `hasEstimated` per provider.

---

### Part 3 — Detail page (`apps/web/`)

**`CostsSection.tsx`** — per-run raw table:

Add a **Provider** column. Render a small badge: `Claude` (blue-ish) / `Codex` (green-ish) using existing shadcn `Badge` component. Derive from `row.provider`. No other structural change to the table.

---

### Part 4 — Global costs page (`apps/web/`)

**`CostsPage.tsx`** — add a provider breakdown section above the existing stage chart.

Layout: three summary cards in a row — **Claude**, **Codex**, **Total**. Each card shows week and month figures from `summary.byProvider.claude`, `summary.byProvider.codex`, and the existing `summary.windows` respectively. Same `formatCost` / `~` prefix logic as existing cards.

If one provider has zero runs (common early on), show the card with `$0.00` rather than hiding it — avoids layout shift when Codex runs start appearing.

---

## Data flow

```
Codex CLI stdout
  → parseCodexEnvelope()         costUsd: number | null
  → rawCostUsd ?? estimateCostUsd()   costUsd: number (derived)
  → recordCost()                 agent_run_costs row: costUsd > 0, costLabel='estimated'
  → getCostSummary() / getCostsForWorkItem()
  → CostSummaryDto.byProvider / CostRowDto.provider
  → CostsPage / CostsSection
```

---

## Out of scope

- Cached-token pricing (Codex envelope doesn't expose cached-token counts; add when available)
- Per-provider budget caps
- Exact costs via direct API integration (`costFromApiUsage` path)
- Provider breakdown within the per-stage bar chart
