# Codex Cost Tracking & Provider Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Codex agent runs recording $0 cost, and add Claude vs Codex provider breakdown to both cost UI pages.

**Architecture:** Add per-token pricing to the models registry and derive cost from tokens when the Codex CLI envelope omits a USD figure. Propagate a `provider` field through the server DTOs and web types. The detail page gets a provider badge column; the global costs page gets a provider summary section.

**Tech Stack:** TypeScript, Vitest, Drizzle/SQLite (core), React + TanStack Query (web), shadcn/ui

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `core/agent-runtime/models.ts` | Modify | Add pricing to `ModelEntry`, add `estimateCostUsd`, add `tryProviderOf` |
| `core/agent-runtime/models.test.ts` | Create | Tests for `estimateCostUsd` and `tryProviderOf` |
| `core/agent-runtime/codex-cli.ts` | Modify | Use `estimateCostUsd` when Codex envelope has no explicit costUsd |
| `core/agent-runtime/codex-cli.test.ts` | Modify | Lock null costUsd propagation in `parseCodexEnvelope` |
| `core/cost/extract.test.ts` | Modify | Lock "tokens present, no cost field → costUsd:0" behavior |
| `core/cost/repository.ts` | Modify | Add `listCostsForProjectSince` |
| `apps/server/src/domains/costs/repository.ts` | Modify | Re-export `listCostsForProjectSince` |
| `apps/server/src/domains/costs/service.ts` | Modify | Add `provider` to `CostRowDto`, add `byProvider` to `CostSummaryDto` |
| `apps/web/src/lib/types.ts` | Modify | Mirror server DTO additions |
| `apps/web/src/components/detail/components/CostsSection.tsx` | Modify | Provider badge column in run table |
| `apps/web/src/components/costs/CostsPage.tsx` | Modify | Provider breakdown section |

---

## Task 1: Add pricing + helpers to models.ts

**Files:**
- Modify: `core/agent-runtime/models.ts`
- Create: `core/agent-runtime/models.test.ts`

- [ ] **Step 1: Write failing tests**

Create `core/agent-runtime/models.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { estimateCostUsd, tryProviderOf } from './models.js';

describe('estimateCostUsd', () => {
  it('computes cost for a known codex model', () => {
    // gpt-5.4: inputPer1M=2.50, outputPer1M=15.00
    // 1_000_000 input + 1_000_000 output = $2.50 + $15.00 = $17.50
    expect(estimateCostUsd('gpt-5.4', 1_000_000, 1_000_000)).toBeCloseTo(17.5, 5);
  });

  it('computes cost for a known claude model', () => {
    // claude-sonnet-4-6: inputPer1M=3.00, outputPer1M=15.00
    // 500_000 input + 200_000 output = $1.50 + $3.00 = $4.50
    expect(estimateCostUsd('claude-sonnet-4-6', 500_000, 200_000)).toBeCloseTo(4.5, 5);
  });

  it('returns 0 for unknown model IDs without throwing', () => {
    expect(estimateCostUsd('some-future-model', 100_000, 50_000)).toBe(0);
  });

  it('returns 0 when tokens are zero', () => {
    expect(estimateCostUsd('gpt-5.4', 0, 0)).toBe(0);
  });

  it('handles fractional token counts correctly', () => {
    // gpt-5.4-mini: inputPer1M=0.75, outputPer1M=4.50
    // 100 input tokens = 100/1_000_000 * 0.75 = 0.000075
    const result = estimateCostUsd('gpt-5.4-mini', 100, 0);
    expect(result).toBeCloseTo(0.000075, 8);
  });
});

describe('tryProviderOf', () => {
  it('returns codex for known codex model IDs', () => {
    expect(tryProviderOf('gpt-5.4')).toBe('codex');
    expect(tryProviderOf('gpt-5.5')).toBe('codex');
    expect(tryProviderOf('gpt-5.4-mini')).toBe('codex');
  });

  it('returns claude for known claude model IDs', () => {
    expect(tryProviderOf('claude-sonnet-4-6')).toBe('claude');
    expect(tryProviderOf('claude-opus-4-7')).toBe('claude');
    expect(tryProviderOf('claude-haiku-4-5-20251001')).toBe('claude');
  });

  it('returns claude for unknown model IDs without throwing', () => {
    expect(tryProviderOf('unknown-model-xyz')).toBe('claude');
    expect(tryProviderOf('')).toBe('claude');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @goose-hub/core test -- --run core/agent-runtime/models.test.ts
```

Expected: FAIL — `estimateCostUsd is not a function`

- [ ] **Step 3: Implement pricing + helpers in models.ts**

Replace the content of `core/agent-runtime/models.ts` with:

```ts
import type { ModelProvider, ModelTier } from '../types.js';

export type { ModelProvider, ModelTier };

export interface ModelEntry {
  id: string;
  tier: ModelTier;
  /** Provider that executes this model. Defaults to 'claude' when absent. */
  provider?: ModelProvider;
  deprecated?: boolean;
  /** Published per-1M-token rates (USD). Missing means we have no pricing data; estimateCostUsd returns 0. */
  pricing?: { inputPer1M: number; outputPer1M: number };
}

export const MODELS: ModelEntry[] = [
  { id: 'claude-opus-4-7',           tier: 'opus',   provider: 'claude', pricing: { inputPer1M: 15.00, outputPer1M: 75.00 } },
  { id: 'claude-sonnet-4-6',         tier: 'sonnet', provider: 'claude', pricing: { inputPer1M: 3.00,  outputPer1M: 15.00 } },
  { id: 'claude-haiku-4-5-20251001', tier: 'haiku',  provider: 'claude', pricing: { inputPer1M: 0.80,  outputPer1M: 4.00  } },
  { id: 'gpt-5.5',     tier: 'opus',   provider: 'codex', pricing: { inputPer1M: 5.00, outputPer1M: 30.00 } },
  { id: 'gpt-5.4',     tier: 'sonnet', provider: 'codex', pricing: { inputPer1M: 2.50, outputPer1M: 15.00 } },
  { id: 'gpt-5.4-mini', tier: 'haiku', provider: 'codex', pricing: { inputPer1M: 0.75, outputPer1M: 4.50  } },
];

const TIER_ORDER: ModelTier[] = ['haiku', 'sonnet', 'opus'];

export function defaultModelForTier(tier: ModelTier): string {
  const entry = MODELS.find(
    (m) => m.tier === tier && !m.deprecated && (m.provider ?? 'claude') === 'claude',
  );
  if (!entry) throw new Error(`No non-deprecated model found for tier: ${tier}`);
  return entry.id;
}

export function defaultModelForTierAndProvider(tier: ModelTier, provider: ModelProvider): string {
  const entry = MODELS.find(
    (m) => m.tier === tier && !m.deprecated && (m.provider ?? 'claude') === provider,
  );
  if (!entry) {
    throw new Error(`No non-deprecated ${provider} model found for tier: ${tier}`);
  }
  return entry.id;
}

export function providerOf(modelId: string): ModelProvider {
  const entry = MODELS.find((m) => m.id === modelId);
  if (!entry) throw new Error(`Unknown model ID: ${modelId}`);
  return entry.provider ?? 'claude';
}

/** Safe variant of providerOf — returns 'claude' for unknown model IDs. Never throws.
 * Use in cost reporting paths that touch historical DB rows with unrecognised model IDs. */
export function tryProviderOf(modelId: string): ModelProvider {
  return MODELS.find((m) => m.id === modelId)?.provider ?? 'claude';
}

export function tierOf(modelId: string): ModelTier {
  const entry = MODELS.find((m) => m.id === modelId);
  if (!entry) throw new Error(`Unknown model ID: ${modelId}`);
  return entry.tier;
}

export function modelsAtOrAboveTier(
  tier: ModelTier,
  provider: ModelProvider = 'claude',
): ModelEntry[] {
  const minIndex = TIER_ORDER.indexOf(tier);
  return MODELS.filter(
    (m) =>
      !m.deprecated &&
      TIER_ORDER.indexOf(m.tier) >= minIndex &&
      (m.provider ?? 'claude') === provider,
  );
}

/** Estimates cost in USD from token counts using published per-1M-token rates.
 * Returns 0 when the model has no pricing entry or when tokens are zero. Never throws. */
export function estimateCostUsd(modelId: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODELS.find((m) => m.id === modelId)?.pricing;
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing.inputPer1M +
         (outputTokens / 1_000_000) * pricing.outputPer1M;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @goose-hub/core test -- --run core/agent-runtime/models.test.ts
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add core/agent-runtime/models.ts core/agent-runtime/models.test.ts
git commit -m "feat(models): add pricing, estimateCostUsd, tryProviderOf"
```

---

## Task 2: Lock extract.test.ts behavior

**Files:**
- Modify: `core/cost/extract.test.ts`

This test locks the current behavior of `costFromCliEnvelope` so future changes can't accidentally break it. The behavior: tokens present + no explicit cost field → returns `costUsd: 0` (not null). This is the signal that `codex-cli.ts` depends on being preserved.

- [ ] **Step 1: Add the locking test**

In `core/cost/extract.test.ts`, add inside the `describe('costFromCliEnvelope', ...)` block after the existing tests:

```ts
  it('returns costUsd:0 (not null) when tokens are present but no cost field exists', () => {
    // This behavior is load-bearing: codex-cli.ts uses the null path on CodexEnvelope.usage.costUsd
    // (not on CostUsage) to detect "no explicit cost" and trigger pricing fallback.
    // costFromCliEnvelope is not on that path, but its contract must stay stable.
    const envelope = { usage: { input_tokens: 500, output_tokens: 200 } };
    expect(costFromCliEnvelope(envelope)).toEqual({
      inputTokens: 500,
      outputTokens: 200,
      costUsd: 0,
      costLabel: 'estimated',
    });
  });
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
pnpm --filter @goose-hub/core test -- --run core/cost/extract.test.ts
```

Expected: All tests PASS (this is locking existing behavior, not new code)

- [ ] **Step 3: Commit**

```bash
git add core/cost/extract.test.ts
git commit -m "test(extract): lock tokens-present/no-cost-field behavior"
```

---

## Task 3: Fix Codex cost recording

**Files:**
- Modify: `core/agent-runtime/codex-cli.ts`
- Modify: `core/agent-runtime/codex-cli.test.ts`

- [ ] **Step 1: Add failing test to codex-cli.test.ts**

In `core/agent-runtime/codex-cli.test.ts`, inside the `describe('parseCodexEnvelope', ...)` block, add:

```ts
  it('leaves costUsd as null when no cost field is present in the envelope', () => {
    const stdout = [
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: '{"ok":true}' },
      }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 300, output_tokens: 120 } }),
    ].join('\n');

    const envelope = parseCodexEnvelope(stdout);
    expect(envelope).not.toBeNull();
    expect(envelope?.usage.inputTokens).toBe(300);
    expect(envelope?.usage.outputTokens).toBe(120);
    expect(envelope?.usage.costUsd).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @goose-hub/core test -- --run core/agent-runtime/codex-cli.test.ts
```

Expected: FAIL on the new test — `costUsd` currently returns `0` (costFromCliEnvelope collapses null), but the `CodexEnvelope` type already says `costUsd: number | null`. The test will actually pass because `costFromCliEnvelope` returns `{..., costUsd: 0}` which the envelope maps to `cost?.costUsd ?? null` = `0 ?? null` = `0`.

Wait — trace through `parseCodexEnvelope`:
1. `cost = costFromCliEnvelope(envelope)` where envelope is `{ type: 'turn.completed', usage: { input_tokens: 300, output_tokens: 120 }, result: '{"ok":true}' }`
2. `costFromCliEnvelope` returns `{ inputTokens: 300, outputTokens: 120, costUsd: 0, costLabel: 'estimated' }` (not null, because tokens > 0)
3. `costUsd: cost?.costUsd ?? null` = `0 ?? null` = `0` (because 0 is not nullish)

So the test **will fail** as written — `costUsd` will be `0`, not `null`. Good — that's the expected failure.

- [ ] **Step 3: Update parseCodexEnvelope to propagate null cost signal**

In `core/agent-runtime/codex-cli.ts`, find the `parseCodexEnvelope` function. Change the cost extraction to preserve the "no explicit cost" signal.

Replace lines 233–249 (the cost extraction + return block):

```ts
  // Extract cost. costFromCliEnvelope returns costUsd:0 when no cost field is present
  // but tokens are non-zero. We need to distinguish "explicit $0" from "no cost field"
  // so that the caller can apply pricing fallback. We treat costUsd:0 with no
  // recognisable cost field in the raw envelope as "no explicit cost" → null.
  const rawCost = costFromCliEnvelope(envelope);
  const hasExplicitCostField =
    typeof envelope.total_cost_usd === 'number' ||
    typeof envelope.cost_usd === 'number' ||
    typeof envelope.cost === 'number';
  const resolvedCostUsd: number | null =
    hasExplicitCostField ? (rawCost?.costUsd ?? null) : null;

  const numTurns = pickNumber(envelope, ['num_turns', 'turns']);

  return {
    result,
    isError,
    errorDetail,
    usage: {
      inputTokens: rawCost?.inputTokens ?? 0,
      outputTokens: rawCost?.outputTokens ?? 0,
      costUsd: resolvedCostUsd,
    },
    numTurns,
  };
```

- [ ] **Step 4: Fix codex-cli.ts runtime to use estimateCostUsd**

In `core/agent-runtime/codex-cli.ts`, add the import for `estimateCostUsd` at the top of the file (alongside existing imports):

```ts
import { estimateCostUsd } from './models.js';
```

Then find lines 489–491 (the cost extraction in the `child.on('close', ...)` handler):

```ts
        const usageInputTokens = envelope?.usage.inputTokens ?? 0;
        const usageOutputTokens = envelope?.usage.outputTokens ?? 0;
        const costUsd = envelope?.usage.costUsd ?? 0;
```

Replace with:

```ts
        const usageInputTokens = envelope?.usage.inputTokens ?? 0;
        const usageOutputTokens = envelope?.usage.outputTokens ?? 0;
        const rawCostUsd = envelope?.usage.costUsd ?? null;
        const costUsd = rawCostUsd ?? estimateCostUsd(model, usageInputTokens, usageOutputTokens);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @goose-hub/core test -- --run core/agent-runtime/codex-cli.test.ts
```

Expected: All tests PASS including the new null-costUsd test

- [ ] **Step 6: Commit**

```bash
git add core/agent-runtime/codex-cli.ts core/agent-runtime/codex-cli.test.ts
git commit -m "fix(codex): compute cost from token pricing when CLI omits total_cost_usd"
```

---

## Task 4: Add listCostsForProjectSince to core repository

**Files:**
- Modify: `core/cost/repository.ts`
- Modify: `apps/server/src/domains/costs/repository.ts`

- [ ] **Step 1: Add function to core repository**

In `core/cost/repository.ts`, add after `listCostsForWorkItem` (after line 42):

```ts
export function listCostsForProjectSince(projectId: string, sinceIso: string): CostRow[] {
  const rows = db
    .select()
    .from(agentRunCosts)
    .where(and(eq(agentRunCosts.projectId, projectId), gte(agentRunCosts.createdAt, sinceIso)))
    .orderBy(asc(agentRunCosts.createdAt))
    .all();
  return rows.map(toRow);
}
```

- [ ] **Step 2: Re-export from server repository**

In `apps/server/src/domains/costs/repository.ts`, update the import + re-export:

```ts
import {
  type CostRow,
  listCostsForProjectSince as coreListCostsForProjectSince,
  listCostsForWorkItem as coreListCostsForWorkItem,
  totalsByStageForProjectSince as coreTotalsByStage,
  totalsForProjectSince as coreTotalsForProject,
} from '@goose-hub/core/cost/repository.js';

export type { CostRow, ProjectTotals, StageTotal } from '@goose-hub/core/cost/repository.js';

export function listCostsForWorkItem(workItemId: string): CostRow[] {
  return coreListCostsForWorkItem(workItemId);
}

export function listCostsForProjectSince(projectId: string, sinceIso: string): CostRow[] {
  return coreListCostsForProjectSince(projectId, sinceIso);
}

export function totalsForProjectSince(projectId: string, sinceIso: string) {
  return coreTotalsForProject(projectId, sinceIso);
}

export function totalsByStageForProjectSince(projectId: string, sinceIso: string) {
  return coreTotalsByStage(projectId, sinceIso);
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @goose-hub/core tsc --noEmit
pnpm --filter @goose-hub/server tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add core/cost/repository.ts apps/server/src/domains/costs/repository.ts
git commit -m "feat(cost-repo): add listCostsForProjectSince"
```

---

## Task 5: Update server service DTOs

**Files:**
- Modify: `apps/server/src/domains/costs/service.ts`

- [ ] **Step 1: Update service.ts**

Replace the entire content of `apps/server/src/domains/costs/service.ts`:

```ts
import type { CostLabel, Stage } from '@goose-hub/core/cost/types.js';
import { tryProviderOf } from '@goose-hub/core/agent-runtime/models.js';
import type { Result } from '#shared/middleware.js';
import {
  type CostRow,
  listCostsForProjectSince,
  listCostsForWorkItem,
  totalsByStageForProjectSince,
  totalsForProjectSince,
} from './repository.js';

export interface CostSummaryDto {
  projectId: string;
  windows: {
    week: { totalUsd: number; totalRuns: number; hasEstimated: boolean };
    month: { totalUsd: number; totalRuns: number; hasEstimated: boolean };
  };
  byStage: Array<{
    stage: Stage;
    totalUsd: number;
    totalRuns: number;
    hasEstimated: boolean;
  }>;
  byProvider: {
    claude: { totalUsd: number; totalRuns: number; hasEstimated: boolean };
    codex:  { totalUsd: number; totalRuns: number; hasEstimated: boolean };
  };
}

export interface CostRowDto {
  runId: string;
  workItemId: string | null;
  stage: Stage;
  skill: string;
  modelId: string;
  provider: 'claude' | 'codex';
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costLabel: CostLabel;
  personaId: string | null;
  createdAt: string;
}

export interface WorkItemCostsDto {
  workItemId: string;
  totalUsd: number;
  hasEstimated: boolean;
  rows: CostRowDto[];
}

function isoDaysAgo(days: number, now: Date = new Date()): string {
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function toProviderTotals(rows: CostRow[]): { totalUsd: number; totalRuns: number; hasEstimated: boolean } {
  return {
    totalUsd: rows.reduce((s, r) => s + r.costUsd, 0),
    totalRuns: rows.length,
    hasEstimated: rows.some((r) => r.costLabel === 'estimated'),
  };
}

export async function getCostSummary(
  projectId: string,
  now: Date = new Date(),
): Promise<Result<CostSummaryDto>> {
  if (!projectId.trim()) {
    return { ok: false, error: 'projectId is required', status: 400 };
  }
  const weekSince = isoDaysAgo(7, now);
  const monthSince = isoDaysAgo(30, now);

  const week = totalsForProjectSince(projectId, weekSince);
  const month = totalsForProjectSince(projectId, monthSince);
  const byStage = totalsByStageForProjectSince(projectId, monthSince);

  const monthRows = listCostsForProjectSince(projectId, monthSince);
  const claudeRows = monthRows.filter((r) => tryProviderOf(r.modelId) === 'claude');
  const codexRows  = monthRows.filter((r) => tryProviderOf(r.modelId) === 'codex');

  return {
    ok: true,
    data: {
      projectId,
      windows: { week, month },
      byStage,
      byProvider: {
        claude: toProviderTotals(claudeRows),
        codex:  toProviderTotals(codexRows),
      },
    },
  };
}

export async function getCostsForWorkItem(workItemId: string): Promise<Result<WorkItemCostsDto>> {
  if (!workItemId.trim()) {
    return { ok: false, error: 'workItemId is required', status: 400 };
  }
  const rows = listCostsForWorkItem(workItemId);
  const totalUsd = rows.reduce((s, r) => s + r.costUsd, 0);
  const hasEstimated = rows.some((r) => r.costLabel === 'estimated');
  return {
    ok: true,
    data: {
      workItemId,
      totalUsd,
      hasEstimated,
      rows: rows.map(toRowDto),
    },
  };
}

function toRowDto(r: CostRow): CostRowDto {
  return {
    runId: r.runId,
    workItemId: r.workItemId,
    stage: r.stage,
    skill: r.skill,
    modelId: r.modelId,
    provider: tryProviderOf(r.modelId),
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costUsd: r.costUsd,
    costLabel: r.costLabel,
    personaId: r.personaId,
    createdAt: r.createdAt,
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @goose-hub/server tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/domains/costs/service.ts
git commit -m "feat(costs-service): add provider to CostRowDto, byProvider to CostSummaryDto"
```

---

## Task 6: Update web types

**Files:**
- Modify: `apps/web/src/lib/types.ts`

- [ ] **Step 1: Update CostRowDto and CostSummaryDto**

In `apps/web/src/lib/types.ts`, find `CostRowDto` (around line 165) and add `provider`:

```ts
export interface CostRowDto {
  runId: string;
  workItemId: string | null;
  stage: CostStage;
  skill: string;
  modelId: string;
  provider: 'claude' | 'codex';
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costLabel: CostLabel;
  personaId: string | null;
  createdAt: string;
}
```

Find `CostSummaryDto` (around line 189) and add `byProvider`:

```ts
export interface CostSummaryDto {
  projectId: string;
  windows: { week: CostWindowTotals; month: CostWindowTotals };
  byStage: CostStageTotal[];
  byProvider: {
    claude: CostWindowTotals;
    codex: CostWindowTotals;
  };
}
```

- [ ] **Step 2: Typecheck web**

```bash
pnpm --filter @goose-hub/web tsc --noEmit
```

Expected: No errors (the new fields are used in Tasks 7 and 8; TypeScript won't complain about missing usage yet)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/types.ts
git commit -m "feat(web-types): add provider to CostRowDto, byProvider to CostSummaryDto"
```

---

## Task 7: Add provider badge to detail page

**Files:**
- Modify: `apps/web/src/components/detail/components/CostsSection.tsx`

The run table currently has `grid-cols-[120px_1fr_80px_80px]` with columns Stage | Skill | Tokens | Cost. We add a Provider column between Stage and Skill.

- [ ] **Step 1: Update the run table grid and header**

In `CostsSection.tsx`, find the raw run table section (around line 210). Change the header grid:

```tsx
{/* Raw run table */}
<div className="border border-line rounded-lg overflow-hidden min-w-0">
  <div className="grid grid-cols-[100px_62px_1fr_80px_80px] px-4 py-2.5 border-b border-line bg-bg-elev/50 text-[10.5px] uppercase tracking-wider text-fg-2">
    <span className="pr-3">Stage</span>
    <span className="pr-3">Provider</span>
    <span className="pr-4">Skill</span>
    <span className="pr-4">Tokens</span>
    <span>Cost</span>
  </div>
  {data.rows.map((r) => (
    <div
      key={r.runId}
      data-testid={`costs-row-${r.runId}`}
      className="grid grid-cols-[100px_62px_1fr_80px_80px] px-4 py-2.5 border-t border-line items-center text-[12px]"
    >
      <span className="text-fg-2 pr-3">{STAGE_LABEL[r.stage]}</span>
      <span className="pr-3">
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
            r.provider === 'codex'
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-blue-500/15 text-blue-400'
          }`}
        >
          {r.provider === 'codex' ? 'Codex' : 'Claude'}
        </span>
      </span>
      <span className="font-mono text-fg-3 text-[11.5px] pr-4 truncate">{r.skill}</span>
      <span className="font-mono text-fg-2 text-[11.5px] pr-4">
        {formatTokens(r.inputTokens + r.outputTokens)}
      </span>
      <span className="font-mono text-fg-2 text-[11.5px]">
        {formatCost(r.costUsd, r.costLabel)}
      </span>
    </div>
  ))}
</div>
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @goose-hub/web tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/detail/components/CostsSection.tsx
git commit -m "feat(costs-detail): add provider badge column to run table"
```

---

## Task 8: Add provider breakdown to global costs page

**Files:**
- Modify: `apps/web/src/components/costs/CostsPage.tsx`

- [ ] **Step 1: Add provider breakdown section**

In `CostsPage.tsx`, add a provider section between the existing window tiles and the stage breakdown. The full updated `data &&` block:

```tsx
{data && (
  <>
    <div className="flex gap-3 mb-6">
      <StatTile
        testId="cost-week"
        label="This week"
        value={formatCost(
          data.windows.week.totalUsd,
          data.windows.week.hasEstimated ? 'estimated' : 'exact',
        )}
        sub={`${data.windows.week.totalRuns} runs`}
      />
      <StatTile
        testId="cost-month"
        label="This month"
        value={formatCost(
          data.windows.month.totalUsd,
          data.windows.month.hasEstimated ? 'estimated' : 'exact',
        )}
        sub={`${data.windows.month.totalRuns} runs`}
      />
    </div>

    <section data-testid="provider-breakdown" className="border border-line rounded-lg p-5 mb-6">
      <h2 className="text-[11px] uppercase tracking-wider text-fg-2 mb-4">
        By provider · last 30 days
      </h2>
      <div className="flex gap-3">
        <StatTile
          testId="cost-provider-claude"
          label="Claude"
          value={formatCost(
            data.byProvider.claude.totalUsd,
            data.byProvider.claude.hasEstimated ? 'estimated' : 'exact',
          )}
          sub={`${data.byProvider.claude.totalRuns} run${data.byProvider.claude.totalRuns === 1 ? '' : 's'}`}
        />
        <StatTile
          testId="cost-provider-codex"
          label="Codex"
          value={formatCost(
            data.byProvider.codex.totalUsd,
            data.byProvider.codex.hasEstimated ? 'estimated' : 'exact',
          )}
          sub={`${data.byProvider.codex.totalRuns} run${data.byProvider.codex.totalRuns === 1 ? '' : 's'}`}
        />
      </div>
    </section>

    <section data-testid="stage-breakdown" className="border border-line rounded-lg p-5">
      <h2 className="text-[11px] uppercase tracking-wider text-fg-2 mb-4">
        Per-stage breakdown · last 30 days
      </h2>
      {data.byStage.length === 0 ? (
        <div
          data-testid="costs-empty-state"
          className="text-center text-[13px] text-fg-3 py-8"
        >
          <p className="mb-1 font-medium text-fg-2">No agent runs yet</p>
          <p>Cost rows are written as runs complete.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {(() => {
            const max = Math.max(...data.byStage.map((s) => s.totalUsd));
            return data.byStage.map((s) => (
              <StageBar
                key={s.stage}
                stage={s.stage}
                totalUsd={s.totalUsd}
                hasEstimated={s.hasEstimated}
                totalRuns={s.totalRuns}
                maxUsd={max}
              />
            ));
          })()}
        </div>
      )}
    </section>
  </>
)}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @goose-hub/web tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Run full test suite**

```bash
pnpm -r test -- --run
```

Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/costs/CostsPage.tsx
git commit -m "feat(costs-page): add provider breakdown section"
```

---

## Self-Review

**Spec coverage:**
- ✓ Bug fix: `estimateCostUsd` computes cost when Codex CLI omits `total_cost_usd` (Tasks 1, 3)
- ✓ `costLabel: 'estimated'` preserved throughout (Task 3 — `costLabel` unchanged)
- ✓ `tryProviderOf` returns `'claude'` for unknown IDs, never throws (Task 1)
- ✓ `CostRowDto.provider` added server-side (Task 5) and in web types (Task 6)
- ✓ `CostSummaryDto.byProvider` computed from month rows (Task 5)
- ✓ Detail page: provider badge column in run table (Task 7)
- ✓ Global costs page: provider breakdown section (Task 8)
- ✓ Empty provider cards shown at $0 rather than hidden (Task 8 — cards always render)

**Placeholder scan:** No TBDs, no vague steps. All code is complete.

**Type consistency:**
- `tryProviderOf` defined in Task 1, used in Task 5
- `estimateCostUsd` defined in Task 1, used in Task 3
- `listCostsForProjectSince` defined in Task 4, used in Task 5
- `CostRowDto.provider` added in Tasks 5 and 6, consumed in Task 7
- `CostSummaryDto.byProvider` added in Tasks 5 and 6, consumed in Task 8
- `data.byProvider.claude` / `data.byProvider.codex` match the `CostWindowTotals` shape used in existing tiles
