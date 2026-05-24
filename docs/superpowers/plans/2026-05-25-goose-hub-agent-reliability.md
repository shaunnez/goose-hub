# Goose Hub Agent Reliability & Cost Accuracy Implementation Plan

> **For agentic workers:** Implement task-by-task; steps use checkbox (`- [ ]`) syntax for tracking.
> - **Claude Code executor:** use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.
> - **Codex / any other executor (no superpowers):** ignore the sub-skill requirement. Execute tasks sequentially in order, run the listed verification command after each, and commit per the step. These skills are a Claude-Code convenience, not a hard dependency.
>
> **Commands (this repo):** run tests with `pnpm test <path> [-t "name"]` (root wrapper `scripts/run-vitest-with-db.ts` injects a temp `DB_PATH`; bare `vitest` breaks DB-touching tests). Typecheck: `pnpm typecheck`. Builds: `pnpm --filter @goose-hub/web build`, `pnpm --filter @goose-hub/server build`. Migrations: `pnpm db:generate`, `pnpm db:migrate`. Package filters always use the scoped names `@goose-hub/web`, `@goose-hub/server`, `@goose-hub/core`.

**Goal:** Make goose-hub-self agent workflows cost-accurate and behaviourally correct — fix cost telemetry blindness, durable persistence + resume, parallel-WP dependency materialization, runaway implement loops, brittle QA contracts, premature gate advancement, repo_intel index flakiness, and workflow-vs-product observability.

**Architecture:** Six workstreams, dependency-ordered. WS1 (cost telemetry) and WS2-audit are fully specified with verified code anchors and ship independently. WS2-index and WS3–WS6 are planning anchors, not implementation specs: they carry confirmed entry points and explicit "read-first" steps because their orchestration files (dispatchParallelImplement, QA/spec contract evaluators, gate routing) were not fully read during planning. Code for those later workstreams must be finalized in smaller dated plans after the read-first pass, not guessed here.

**Tech Stack:** Node + pnpm + TypeScript, Drizzle + SQLite (`drizzle-kit generate`/`migrate`), Vitest, React + Vite (apps/web), codex-cli runtime (`codex exec --json`, ChatGPT OAuth).

---

## Implementation boundary

- **Implement now:** WS1 and WS2 Task 1 are ready to code from this document.
- **Do not implement directly from this document:** WS2 Task 2 and WS3–WS6. First complete their read-first step, expand the section into its own dated implementation plan with concrete TDD steps, then implement that smaller plan.
- **Do not ship this as one branch/PR:** each workstream should land independently. WS3 in particular is high-risk and must be its own plan/issue because it changes git branch ownership, push timing, resume semantics, and dependency ordering.
- **Cross-workstream prerequisite:** before implementing WS3 or WS4, define the small F12 event-contract subset they need (`runDisposition` and `parallel-implement.wp-persisted`). WS6 can own the UI/timeline presentation later, but WS3/WS4 must not invent incompatible event shapes.
- **Cost policy:** OAuth usage is plan-based, so `costUsd` remains synthetic telemetry, not bill truth. WS1 must label this clearly in `core/cost/README.md` and the cost UI.

---

## Verified facts driving this plan

- Codex `turn.completed` reports `usage:{input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens}`. Live probe (gpt-5.4, OAuth): `input_tokens:15497, cached_input_tokens:3456 (22%), output_tokens:20, reasoning_output_tokens:13`.
- `core/cost/extract.ts:costFromCliEnvelope` reads only `input_tokens`/`output_tokens`/`cost` → drops `cached_input_tokens` and `reasoning_output_tokens`. `agent_run_costs` has no columns for them.
- `core/agent-runtime/models.ts:estimateCostUsd` bills all input at full `inputPer1M`, no cache discount, ignores reasoning tokens.
- `agent_runs` table written only by `core/agent-runtime/claude-cli.ts` (5 inserts); `codex-cli.ts` never writes it → empty for codex (goose-hub-self) runs. Read by `apps/server/src/domains/roster/repository.ts:147` for persona stats.
- WP commits made on **detached HEAD** scratch worktrees (`core/workspaces/orchestrator-git.ts:39` `git worktree add --detach`) → unreachable, GC-eligible until `orchestratorPushBranch`/`openPR` runs.
- `dispatchResumeIssue` (`apps/server/src/shared/dispatch-routing.ts:201`) forces state back to a stage trigger and re-runs the whole stage; for `factory:in-progress` → `factory:dev-ready` + `dispatchFixIssue` (`:169`).
- Budget enforced only post-run in `codex-cli.ts:824` close handler; `emitBudgetExceededIfNeeded` rejects → orchestrator never receives output → green work discarded.
- `repo-intel.ts:191` emits audit `status:'failed'` for `not-found` (a successful empty query), making misses look like errors. Index freshness keyed on a single global db path vs per-worktree source mtimes (`core/symbol-index/freshness.ts`, `core/route-index/lookup.ts:47`) → constant staleness in fresh worktrees.

---

## Workstream sequencing

```
WS1 Cost Telemetry (F2 + F11) ........ independent, ship first
WS2 repo_intel audit (F10) ........... Task 1 independent, ship early
WS2 repo_intel index freshness ....... read-first, separate plan
F12 event-contract subset ............ prerequisite before WS3/WS4
WS3 Persistence + Resume + WP deps (F4 → F1 → F5) ... F4 enables F1 and F5
WS4 Implement-WP cost control (F3) ... depends on WS3 integration branch
WS5 QA/spec contract + fix-feedback routing (F6 + F7) ... independent
WS6 Gates + Observability (F9 + F12) ... consumes/extends the F12 event contract
F8  Scout over-routing ............... DEFERRED (owner: user, later)
```

---

# WS1 — Cost Telemetry Accuracy (F2 + F11)

**Goal:** Capture `cached_input_tokens` + `reasoning_output_tokens` from codex, store them, compute cache-discounted + reasoning-inclusive cost, write `agent_runs` for codex runs, and surface cache hit % + effective cost in timeline, per-issue cost page, and global project costs.

**This workstream is fully specified — every file below was read during planning.**

## File Structure

- `core/cost/types.ts` — add `cachedInputTokens`, `reasoningOutputTokens` to `CostRecord` + `CostUsage`.
- `core/cost/extract.ts` — parse new fields from codex/claude envelopes.
- `core/agent-runtime/models.ts` — add `cachedInputPer1M` to pricing; extend `estimateCostUsd` with cache discount + reasoning.
- `core/db/schema.ts` — add two columns to `agentRunCosts`.
- `core/db/migrations/0041_*.sql` — generated migration.
- `core/cost/repository.ts` — persist + return new fields.
- `core/agent-runtime/codex-parser.ts` — surface new usage fields.
- `core/agent-runtime/codex-cli.ts` — pass new fields to `recordCost` + `run-completed` payload + write `agentRuns`.
- `core/agent-runtime/run-record.ts` (new) — shared `recordAgentRun()` helper called by both runtimes.
- `core/agent-runtime/claude-cli.ts` — replace 5 inline `agentRuns` inserts with the shared helper.
- `apps/server/src/domains/costs/service.ts` + `repository.ts` — add fields to DTOs + totals (list vs effective).
- `apps/web/src/components/costs/CostsPage.tsx`, `CostLegend.tsx`, `detail/components/CostBadge.tsx` — display cache %.

## Task 1: CostUsage / CostRecord carry cache + reasoning tokens

**Files:**
- Modify: `core/cost/types.ts`
- Test: `core/cost/extract.test.ts`

- [ ] **Step 1: Write failing test** (append to `core/cost/extract.test.ts`)

```typescript
import { describe, expect, it } from 'vitest';
import { costFromCliEnvelope } from './extract.js';

describe('costFromCliEnvelope cached + reasoning tokens', () => {
  it('extracts cached_input_tokens and reasoning_output_tokens from codex usage', () => {
    const envelope = {
      usage: {
        input_tokens: 15497,
        cached_input_tokens: 3456,
        output_tokens: 20,
        reasoning_output_tokens: 13,
      },
    };
    const result = costFromCliEnvelope(envelope);
    expect(result).not.toBeNull();
    expect(result?.inputTokens).toBe(15497);
    expect(result?.cachedInputTokens).toBe(3456);
    expect(result?.outputTokens).toBe(20);
    expect(result?.reasoningOutputTokens).toBe(13);
  });

  it('defaults cached + reasoning to 0 when absent (claude envelope)', () => {
    const result = costFromCliEnvelope({
      usage: { input_tokens: 100, output_tokens: 5 },
    });
    expect(result?.cachedInputTokens).toBe(0);
    expect(result?.reasoningOutputTokens).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm test core/cost/extract.test.ts -t "cached"`
Expected: FAIL — `cachedInputTokens` undefined.

- [ ] **Step 3: Add fields to `core/cost/types.ts`**

In `CostRecord` (after `outputTokens: number;`) add:
```typescript
  cachedInputTokens: number;
  reasoningOutputTokens: number;
```
In `CostUsage` (after `outputTokens: number;`) add:
```typescript
  cachedInputTokens: number;
  reasoningOutputTokens: number;
```

- [ ] **Step 4: Update `core/cost/extract.ts` `costFromCliEnvelope`**

After the existing `outputTokens` line, add extraction (handle codex + OpenAI nested aliases):
```typescript
  const cachedInputTokens =
    numericField(usage, ['cached_input_tokens', 'cachedInputTokens']) ??
    numericField(
      (usage.prompt_tokens_details ?? {}) as Record<string, unknown>,
      ['cached_tokens'],
    ) ??
    0;
  const reasoningOutputTokens =
    numericField(usage, ['reasoning_output_tokens', 'reasoningOutputTokens']) ??
    numericField(
      (usage.completion_tokens_details ?? {}) as Record<string, unknown>,
      ['reasoning_tokens'],
    ) ??
    0;
```
Add both to the returned object and to `costFromApiUsage` (default `cachedInputTokens: input.cachedInputTokens ?? 0`, `reasoningOutputTokens: input.reasoningOutputTokens ?? 0` — widen its param type accordingly).

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm test core/cost/extract.test.ts -t "cached"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add core/cost/types.ts core/cost/extract.ts core/cost/extract.test.ts
git commit -m "feat(cost): capture cached_input + reasoning_output tokens from CLI envelopes"
```

## Task 2: Cache-discounted, reasoning-inclusive cost in models.ts

**Files:**
- Modify: `core/agent-runtime/models.ts`
- Test: `core/agent-runtime/models.test.ts`

- [ ] **Step 1: Write failing test** (append to `models.test.ts`)

```typescript
import { estimateCostUsd } from './models.js';

describe('estimateCostUsd cache discount + reasoning', () => {
  it('bills cached input at the cached rate and reasoning at output rate', () => {
    // gpt-5.4: inputPer1M 2.5, cachedInputPer1M 0.625, outputPer1M 15
    const cost = estimateCostUsd('gpt-5.4', 1_000_000, 100_000, {
      cachedInputTokens: 400_000,
      reasoningOutputTokens: 50_000,
    });
    // input: 600k*2.5 + 400k*0.625 = 1.5 + 0.25 = 1.75
    // output: (100k+50k)*15 = 2.25
    expect(cost).toBeCloseTo(1.75 + 2.25, 6);
  });

  it('is backwards compatible without opts (no cache, no reasoning)', () => {
    const cost = estimateCostUsd('gpt-5.4', 1_000_000, 0);
    expect(cost).toBeCloseTo(2.5, 6);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test core/agent-runtime/models.test.ts -t "cache discount"`
Expected: FAIL — 4th arg ignored / `cachedInputPer1M` missing.

- [ ] **Step 3: Add `cachedInputPer1M` to every pricing entry in `MODELS`**

Codex (cached ≈ 0.25× input): `gpt-5.5` → `cachedInputPer1M: 1.25`; `gpt-5.4` → `0.625`; `gpt-5.4-mini` → `0.1875`.
Claude (cache read ≈ 0.1× input): set each claude entry's `cachedInputPer1M` to `inputPer1M * 0.1`.
Update the `pricing` type to include `cachedInputPer1M: number`.

> NOTE: OAuth billing is plan-based, so these are synthetic estimate ratios for telemetry only. Document this in `core/cost/README.md`.

- [ ] **Step 4: Extend `estimateCostUsd`**

```typescript
export function estimateCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  opts: { cachedInputTokens?: number; reasoningOutputTokens?: number } = {},
): number {
  const pricing = MODELS.find((m) => m.id === modelId)?.pricing;
  if (!pricing) return 0;
  const cached = Math.min(opts.cachedInputTokens ?? 0, inputTokens);
  const uncachedInput = inputTokens - cached;
  const totalOutput = outputTokens + (opts.reasoningOutputTokens ?? 0);
  return (
    (uncachedInput / 1_000_000) * pricing.inputPer1M +
    (cached / 1_000_000) * pricing.cachedInputPer1M +
    (totalOutput / 1_000_000) * pricing.outputPer1M
  );
}
```

- [ ] **Step 5: Run, verify pass**

Run: `pnpm test core/agent-runtime/models.test.ts -t "cache discount"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add core/agent-runtime/models.ts core/agent-runtime/models.test.ts core/cost/README.md
git commit -m "feat(cost): cache-discounted + reasoning-inclusive cost estimation"
```

## Task 3: DB columns + migration for cached/reasoning tokens

**Files:**
- Modify: `core/db/schema.ts:426` (`agentRunCosts`)
- Create: `core/db/migrations/0041_*.sql` (generated)
- Modify: `core/cost/repository.ts` (`recordCost`, `toRow`)

- [ ] **Step 1: Add columns to `agentRunCosts` in `schema.ts`** (after `outputTokens`)

```typescript
    cachedInputTokens: integer('cached_input_tokens').default(0).notNull(),
    reasoningOutputTokens: integer('reasoning_output_tokens').default(0).notNull(),
```

- [ ] **Step 2: Generate migration**

Run: `pnpm db:generate`
Expected: new file `core/db/migrations/0041_*.sql` adding both columns. Inspect it ALTERs `agent_run_costs`.

- [ ] **Step 3: Persist in `recordCost` (`core/cost/repository.ts`)**

Add to the `.values({...})` object:
```typescript
      cachedInputTokens: record.cachedInputTokens,
      reasoningOutputTokens: record.reasoningOutputTokens,
```
Update `toRow` (and `CostRow`/`WorkItemToolStatsRow` mappers) to carry both fields.

- [ ] **Step 4: Run migration + repository tests**

Run: `pnpm db:migrate && pnpm test core/cost/repository.test.ts`
Expected: PASS (existing tests still green; add a `recordCost` assertion for the new columns if the file has one).

- [ ] **Step 5: Commit**

```bash
git add core/db/schema.ts core/db/migrations core/cost/repository.ts core/cost/repository.test.ts
git commit -m "feat(cost): persist cached_input + reasoning_output token columns"
```

## Task 4: Wire codex runtime to record new tokens + cost

**Files:**
- Modify: `core/agent-runtime/codex-parser.ts:172-182` (usage object)
- Modify: `core/agent-runtime/codex-cli.ts:803-821` (cost calc + recordCost), `:879-903` (run-completed payload)
- Test: `core/agent-runtime/codex-cli-runtime.test.ts`

- [ ] **Step 1: Widen `parseCodexEnvelope` usage** — change `usage` type in `codex-parser.ts:7` to include `cachedInputTokens: number; reasoningOutputTokens: number;` and populate from `rawCost`:
```typescript
      cachedInputTokens: rawCost?.cachedInputTokens ?? 0,
      reasoningOutputTokens: rawCost?.reasoningOutputTokens ?? 0,
```

- [ ] **Step 2: Write failing test** — assert a codex envelope with `cached_input_tokens` produces a `recordCost` call with discounted `costUsd` and the new fields populated (mirror existing runtime test mocking pattern in `codex-cli-runtime.test.ts`).

- [ ] **Step 3: Run, verify fail.** `pnpm test core/agent-runtime/codex-cli-runtime.test.ts -t "cached"`

- [ ] **Step 4: Update `codex-cli.ts`** — read `usageCachedInputTokens`/`usageReasoningOutputTokens` from envelope; pass `{cachedInputTokens, reasoningOutputTokens}` as 4th arg to `estimateCostUsd` (line ~806); add both to the `recordCost({...})` call (line ~809) and to the `run-completed` `cost` payload (line ~887).

- [ ] **Step 5: Run, verify pass.**

- [ ] **Step 6: Commit**

```bash
git add core/agent-runtime/codex-parser.ts core/agent-runtime/codex-cli.ts core/agent-runtime/codex-cli-runtime.test.ts
git commit -m "feat(cost): codex runtime records cached + reasoning tokens with discounted cost"
```

## Task 5: Shared `recordAgentRun` helper; codex writes `agent_runs` (F11)

**Files:**
- Create: `core/agent-runtime/run-record.ts`
- Modify: `core/agent-runtime/claude-cli.ts` (replace 5 inline inserts at `:279,:331,:357,:424,:505`)
- Modify: `core/agent-runtime/codex-cli.ts` (call on completion + on each failure path)
- Test: `core/agent-runtime/run-record.test.ts`

- [ ] **Step 1: Write failing test** (`run-record.test.ts`)

```typescript
import { describe, expect, it } from 'vitest';
import { recordAgentRun } from './run-record.js';
import { db } from '../db/db.js';
import { agentRuns } from '../db/schema.js';
import { eq } from 'drizzle-orm';

describe('recordAgentRun', () => {
  it('inserts an agent_runs row idempotently on runId', () => {
    const runId = `test-${Date.now()}`;
    const row = {
      runId, personaId: 'p1', workItemId: 'github:x#1', projectId: 'proj',
      role: 'Developer' as const, skill: 'implement-wp', outcome: 'success' as const,
    };
    recordAgentRun(row);
    recordAgentRun(row); // duplicate — must not throw or double-insert
    const found = db.select().from(agentRuns).where(eq(agentRuns.runId, runId)).all();
    expect(found).toHaveLength(1);
    expect(found[0].outcome).toBe('success');
  });
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm test core/agent-runtime/run-record.test.ts`

- [ ] **Step 3: Implement `run-record.ts`**

```typescript
import { db } from '../db/db.js';
import { agentRuns } from '../db/schema.js';
import type { Role } from '../types.js';

export interface AgentRunRecord {
  runId: string;
  personaId: string;
  workItemId: string | null;
  projectId: string;
  role: Role;
  skill: string;
  outcome: 'success' | 'failure';
}

/** Persists an agent_runs row. Idempotent on runId. Called by both runtimes. */
export function recordAgentRun(record: AgentRunRecord): void {
  db.insert(agentRuns)
    .values({
      runId: record.runId,
      personaId: record.personaId,
      workItemId: record.workItemId,
      projectId: record.projectId,
      role: record.role,
      skill: record.skill,
      outcome: record.outcome,
    })
    .onConflictDoNothing({ target: agentRuns.runId })
    .run();
}
```

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Refactor `claude-cli.ts`** — replace each of the 5 `db.insert(agentRuns)...` blocks with `recordAgentRun({...})`. Verify the role/personaId/outcome values match what each site currently inserts. Run `pnpm test core/agent-runtime/claude-cli.test.ts` — expected PASS (no behavior change).

- [ ] **Step 6: Wire `codex-cli.ts`** — call `recordAgentRun({outcome:'success', ...})` immediately before `resolve(...)` (after `run-completed`, ~line 904); call `recordAgentRun({outcome:'failure', ...})` on each terminal `reject` path that emits `agent.run-failed`. Derive `role` from `spec.role`, `personaId` from `personaId ?? spec.personaId ?? 'unknown'` (the column is `notNull`; use a stable fallback). Add a codex runtime test asserting an `agent_runs` row exists post-run.

- [ ] **Step 7: Run full agent-runtime suite + commit**

```bash
pnpm test core/agent-runtime/
git add core/agent-runtime/run-record.ts core/agent-runtime/run-record.test.ts core/agent-runtime/claude-cli.ts core/agent-runtime/codex-cli.ts core/agent-runtime/codex-cli-runtime.test.ts
git commit -m "feat(observability): codex runtime writes agent_runs via shared recordAgentRun (F11)"
```

## Task 6: Surface cache % + effective cost in server DTOs

**Files:**
- Modify: `apps/server/src/domains/costs/service.ts` (`CostRowDto`, summary totals)
- Modify: `apps/server/src/domains/costs/repository.ts` (select + totals SQL)
- Test: `apps/server/src/domains/costs/service.test.ts`

- [ ] **Step 1: Write failing test** — a `CostRowDto` carries `cachedInputTokens` + `reasoningOutputTokens`, and `cacheHitRatio = cachedInputTokens / max(inputTokens,1)`.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Add `cachedInputTokens`, `reasoningOutputTokens`, `cacheHitRatio` to `CostRowDto`** and populate in the row mapper. Add `cachedInputTokens` totals to `CostSummaryDto.byStage`/`byProvider`/`windows` so global project costs show aggregate cache hit %.

- [ ] **Step 4: Update `repository.ts`** select to include the two new columns; extend `totalsByStageForProjectSince`/`totalsForProjectSince` SUM aggregates with `cached_input_tokens`.

- [ ] **Step 5: Run, verify pass + commit**

```bash
pnpm test apps/server/src/domains/costs/
git add apps/server/src/domains/costs
git commit -m "feat(cost): expose cache hit ratio + reasoning tokens in cost API"
```

## Task 7: Display cache % in web (timeline, per-issue, global)

**Files:**
- Modify: `apps/web/src/components/costs/CostsPage.tsx` (global) + `CostLegend.tsx`
- Modify: `apps/web/src/components/detail/components/CostBadge.tsx` (per-issue/timeline)
- Modify: `apps/web/src/lib/types.ts` + `apps/web/src/lib/api/settings.ts` cost DTO types
- Test: existing component tests under `apps/web/src/components/costs` / `detail`

- [ ] **Step 1: Extend web cost DTO types** in `apps/web/src/lib/types.ts` to match Task 6 (`cachedInputTokens`, `reasoningOutputTokens`, `cacheHitRatio`).

- [ ] **Step 2: Write failing component test** — `CostBadge` renders `cache 22%` when `cacheHitRatio` is 0.22.

- [ ] **Step 3: Run, verify fail.** `pnpm test apps/web/src/components/detail/components/CostBadge`

- [ ] **Step 4: Render cache % + reasoning token count** in `CostBadge.tsx` (per-issue timeline badge) and an aggregate cache-hit stat on `CostsPage.tsx` (global). Add a legend entry in `CostLegend.tsx` noting costs are synthetic estimates under OAuth.

- [ ] **Step 5: Run, verify pass.**

- [ ] **Step 6: Typecheck + build both apps + commit**

```bash
pnpm typecheck && pnpm --filter @goose-hub/web build && pnpm --filter @goose-hub/server build
git add apps/web/src
git commit -m "feat(cost-ui): show cache hit % + reasoning tokens in timeline, issue, and global costs"
```

## WS1 acceptance

- [ ] `pnpm typecheck && pnpm test && pnpm --filter @goose-hub/web build && pnpm --filter @goose-hub/server build` all pass.
- [ ] A fresh codex run writes an `agent_run_costs` row with non-zero `cached_input_tokens` and a discounted `cost_usd`, plus an `agent_runs` row.
- [ ] Timeline, per-issue cost page, and global Costs page all show cache hit %.

---

# WS2 — repo_intel Index Freshness + Audit Telemetry (F10)

**Goal:** Stop repo_intel misses being logged as failures, and stop fresh worktrees thrashing/missing the index.

## Task 1: Relabel `not-found` from `failed` to a non-error status (fully specified)

**Files:**
- Modify: `core/tool-layer/mcp/tools/repo-intel.ts:190-199`
- Modify: `core/tool-layer/mcp/audit.ts` (allow new status if `emitToolCall` enumerates it)
- Test: `core/tool-layer/mcp/tools/repo-intel.test.ts`

- [ ] **Step 1: Write failing test** — a `find-symbol` query with no match emits an audit call with `status:'ok'` and `noMatches:true` (NOT `status:'failed'`); an `invalid-args` query still emits `status:'failed'`.

- [ ] **Step 2: Run, verify fail.** `pnpm test core/tool-layer/mcp/tools/repo-intel.test.ts -t "not-found"`

- [ ] **Step 3: Change the post-dispatch `emitToolCall`** (`repo-intel.ts:191`):
```typescript
  const isMiss = !result.ok && result.reason === 'not-found';
  emitToolCall(ctx, {
    tool: 'repo_intel.query',
    input: auditInput(input),
    status: result.ok || isMiss ? 'ok' : 'failed',
    noMatches: isMiss,
    repo_intel_intent: input.intent,
    inputKeys,
    ...duplicateAuditFields(duplicate),
  });
```
If `emitToolCall`'s `status` is a closed union that rejects this, no signature change is needed (still `'ok'`); confirm `audit.ts` accepts `status:'ok' + noMatches:true`.

- [ ] **Step 4: Run, verify pass + commit**

```bash
git add core/tool-layer/mcp/tools/repo-intel.ts core/tool-layer/mcp/tools/repo-intel.test.ts
git commit -m "fix(repo-intel): log not-found as successful empty query, not a failure (F10)"
```

## Task 2: Per-worktree index freshness — READ-FIRST

> **Read before coding:** `core/symbol-index/lookup.ts`, `core/symbol-index/db.ts:defaultDbPath`, `core/symbol-index/freshness.ts` (full), `core/route-index/freshness.ts`, and how scout/implement workspaces are created (search `createWpScratchWorktree` callers + workspace setup in `apps/server`). Determine whether `lookupSymbol` derives `dbPath` from `worktreePath` or uses the global `~/.factory/symbol-index.db`.

> **Implementation gate:** do not code this task directly from the bullets below. After the read-first step, create a focused dated plan for the index path/freshness change with exact tests and rollback behavior.

**Confirmed problem:** freshness compares a single global index db mtime against per-worktree source mtimes; fresh checkouts always look stale → `route-index/lookup.ts:47` returns `null` (`index-stale`) or rebuilds every call.

**Approach (finalize after read):** key the index db path to the worktree (e.g. `<worktreePath>/.factory/index.db`), built once at workspace setup; on `stale`, rebuild-in-place rather than returning `null`. Add a test that a freshly created worktree yields a non-null lookup.

- [ ] Read the files above.
- [ ] Write failing test for fresh-worktree lookup returning results.
- [ ] Implement per-worktree db path + rebuild-on-stale.
- [ ] `pnpm test core/symbol-index core/route-index` green; commit.

---

# WS3 — Durable Persistence + Resume + WP Dependency Materialization (F4 → F1 → F5)

**Goal:** WP commits land on a named per-run integration branch (durable, pushable); resume reattaches to last committed WP; dependent WPs see prerequisite commits.

> **Read before coding:** `apps/server/src/shared/dispatch-dev.ts` (full — `dispatchParallelImplement`, `dispatchFixIssue`, `openPRImpl`/`orchestratorCommitWpImpl` wiring at `:546-567`), `core/connectors/github/open-pr.ts`, the parallel-implement orchestrator (search `parallel-implement.wp-committed` emitters), and `core/workspaces/orchestrator-git.ts` (read — done).

> **Implementation gate:** do not implement WS3 directly from this section. Split it into a standalone plan/issue after reading the files above. The plan must answer branch naming, parent-worktree checkout state, push timing, cherry-pick/merge conflict behavior, resume idempotency, and what happens when a persisted WP later fails verification.

**Confirmed anchors:** `orchestrator-git.ts:31` (`--detach`), `:89` `orchestratorCommitWp`, `:143` `orchestratorPushBranch`, `dispatch-routing.ts:161-186` (`RESUME_WORKFLOWS`), `:201` `dispatchResumeIssue`.

**F4 approach:** create a named branch `factory/run/<runId>` at implement start; after each `orchestratorCommitWp`, fast-forward/cherry-pick the WP commit onto that branch in the parent worktree and `orchestratorPushBranch` immediately. Emit the F12 prerequisite event `parallel-implement.wp-persisted` recording branch + pushed SHA. openPR targets this branch.

**F1 approach:** in `RESUME_WORKFLOWS`, for `factory:spec-ready`/`factory:in-progress`, before re-dispatching, read `wp-persisted` events for the issue; pass already-persisted WP IDs to `dispatchParallelImplement` so it skips them and resumes from the first unpersisted WP.

**F5 approach:** topo-sort WPs by spec-declared deps; run independent WPs in parallel from the integration branch tip; run dependent WPs sequentially, each `createWpScratchWorktree(repo, runId, wpId, integrationBranchTip)` so they branch off the branch that already contains prerequisite commits. Replace the hard retry on `no observed changed files` with a single diagnosis + stop.

- [ ] Read the files above; expand this section into its own dated plan with full code + TDD steps.
- [ ] Tasks: (a) integration-branch helper + push-per-WP; (b) `wp-persisted` event + persistence verification; (c) resume skip-persisted-WPs; (d) dep-aware WP ordering off integration tip; (e) no-op-WP hard stop.

---

# WS4 — Implement-WP Cost Control (F3)

**Goal:** Commit green work before budget discards it; cap repeated edit/test loops.

> **Read before coding:** the parallel-implement orchestrator (WP iteration loop, where it calls the runtime and where it would commit), `core/agent-runtime/codex-cli.ts:623` (tool-call budget) and `:824` (post-run budget reject), `core/agent-runtime/budget-guard.ts` (read — done).

> **Implementation gate:** do not implement WS4 until WS3's integration-branch persistence exists and the F12 `runDisposition`/`wp-persisted` contract is defined.

**Confirmed problem:** `emitBudgetExceededIfNeeded` (`budget-guard.ts`) rejects post-run → orchestrator never gets output → green WP discarded (#1035 WP2 had green tests/lint/typecheck then lost to `$10.36 > $10`).

**Approach (finalize after read):** (a) when a WP iteration reaches green (targeted tests + lint + typecheck pass), commit it via WS3's integration branch BEFORE the budget check can reject; (b) add a mid-run edit/test-loop cap (count Edit→test cycles per WP) that forces a diagnosis artifact before another cycle; (c) size per-WP `maxBudgetUsd` to story shape (smaller default for bug-type issues).

- [ ] Read; expand into own plan; depends on WS3 integration branch existing.

---

# WS5 — QA/Spec Contract Quality + Fix-Feedback Routing (F6 + F7)

**Goal:** Stop deterministic QA failing on text/symbol matching of passing code; stop routing out-of-scope findings into fix-feedback; no empty no-op commits.

> **Read before coding:** the spec-author skill (`skills/spec-author/`), the acceptance-contract / executable-check evaluator (search `outputExpectation`, `contains`, and the deterministic QA tiers — structural/functional/regression), the fix-feedback dispatch (search `fix-feedback` / `needs-fix` in `apps/server/src/shared`), and `orchestratorCommitAll:122` (allow-empty commit at #1037 cycle 1).

> **Implementation gate:** do not implement WS5 directly from this section. First create a focused plan that names the canonical executable-check shape, the structured evidence artifact, and the exact out-of-scope QA routing behavior.

**Confirmed problems:** (F6a) `outputExpectation.contains:"POST /inbox"` matched against Vitest stdout that lacks test names (#1037); (F6b) human-readable contract label `InvestigationAccordionSectionConfig` treated as a required export (#1036); (F7) out-of-scope QA finding routed to fix-feedback + an empty no-op commit (#1037 cycle 1).

**Approach (finalize after read):** (F6a) executable checks assert exit-code + structured evidence (parse Vitest JSON reporter), not stdout substring; (F6b) contract symbol checks only enforce exports the spec explicitly flags as real exports — labels are descriptive; (F7) skip fix-feedback when QA tags a finding out-of-scope; in `orchestratorCommitAll`, drop `--allow-empty` / detect zero-diff and skip the commit.

- [ ] Read; expand into own plan.

---

# WS6 — Gates + Workflow Observability (F9 + F12)

**Goal:** Unresolved dev-review blockers never advance; first-class workflow-health signals.

> **Read before coding:** dev-review flow + `dev-review-response` handling (search `dev-review-response`, `maxRevisionTurns`, timeout/redundant-read abort), `core/event-stream/kinds.ts` (event kinds), and timeline rendering (`core/workflows/timeline-sections.ts`, `apps/web/src/components/detail/lib/timeline/`).

> **Implementation gate:** define the minimal F12 event-contract subset before WS3/WS4 if they are implemented first. The full WS6 plan should then consume that contract and add gate routing plus timeline presentation.

**Confirmed problems:** (F9) dev-review found blockers, `dev-review-response` timed out on redundant-read abort, workflow proceeded to PR/QA anyway (#1036). (F12) timeline cannot distinguish persisted-PR-commit vs orphaned-uncommitted-repair, budget-killed vs complete, product vs spec-contract QA failure.

**Approach (finalize after read):** (F9) gate node: if dev-review emitted unresolved blockers AND the revision response did not resolve them (incl. timeout), force `gate-pending`/back-to-dev rather than advancing. (F12) (1) terminal `runDisposition` enum on `agent.run-completed`/`run-failed`: `completed | budget-killed | orphaned-restart | blocked-gate | persistence-failed`; (2) `parallel-implement.wp-persisted` verification event (shared with WS3); (3) QA-failure `category` field: `product | spec-contract | regression-unrelated | orchestration`; (4) timeline badges driven off these.

- [ ] Read; expand into own plan. F12's `runDisposition` is consumed by WS3 (orphan vs complete) — define the enum here, stamp it in WS3/WS4.

---

## Self-review notes

- **Spec coverage:** F1✓(WS3) F2✓(WS1) F3✓(WS4) F4✓(WS3) F5✓(WS3) F6✓(WS5) F7✓(WS5) F8=deferred F9✓(WS6) F10✓(WS2) F11✓(WS1) F12✓(WS6).
- **Execution-ready now:** WS1 (all tasks, verified code) and WS2 Task 1 only. WS2 Task 2 + WS3–WS6 carry confirmed anchors but require the listed read-first step and a smaller dated implementation plan before code is written — this is deliberate (no fabricated code for unread files).
- **Do not implement as one branch:** land WS1 first, optionally WS2 Task 1 as a tiny follow-up, then plan WS3 separately. Define the F12 event-contract subset before any WS3/WS4 implementation starts.
- **Type consistency:** `cachedInputTokens`/`reasoningOutputTokens` names identical across types.ts, extract.ts, models.ts opts, schema columns (`cached_input_tokens`), repository, codex-cli, DTOs, web types. `recordAgentRun` signature shared by both runtimes.
