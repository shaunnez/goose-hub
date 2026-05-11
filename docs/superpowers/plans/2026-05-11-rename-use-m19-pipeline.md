# Rename `useM19Pipeline` → `useMultiAgentPipeline` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename every occurrence of `useM19Pipeline` / `use_m19_pipeline` to `useMultiAgentPipeline` / `use_multi_agent_pipeline` so the flag name is stable beyond Milestone 19.

**Architecture:** DB column renamed via a Drizzle migration; TypeScript symbols renamed across schema, repository, server router, dispatch, and web client layers. No behaviour changes — pure rename.

**Tech Stack:** Drizzle ORM + SQLite, TypeScript, React, Vitest, Biome

---

## File map

| File | Change |
|------|--------|
| `core/db/schema.ts:269` | Rename column field `useM19Pipeline` → `useMultiAgentPipeline`, keep SQL column name via new string arg |
| `core/db/migrations/XXXX_rename_use_m19_pipeline.sql` | New migration — `ALTER TABLE … RENAME COLUMN` |
| `core/db/repositories/project-settings.ts` | Rename `GlobalBudgetPatch` field, three exported functions, local usages |
| `core/db/repositories/project-settings.test.ts` | Update fixture field names |
| `apps/server/src/domains/project-settings/model-router.ts` | Rename Zod field, function calls, comments |
| `apps/server/src/shared/dispatch.ts` | Rename import, local var `useM19`, log keys |
| `apps/server/src/shared/dispatch.test.ts` | Rename test description + fixture field |
| `apps/web/src/lib/types.ts:403` | Rename DTO field |
| `apps/web/src/lib/api.ts:579` | Rename param |
| `apps/web/src/components/settings/components/PipelinePanel.tsx` | Rename `data-testid`, display label, field access |

---

### Task 1: DB schema + migration

**Files:**
- Modify: `core/db/schema.ts:269`
- Create: `core/db/migrations/XXXX_rename_use_m19_pipeline.sql` (name assigned by drizzle-kit)

- [ ] **Step 1: Update schema.ts**

Change line 269 in `core/db/schema.ts` from:
```ts
useM19Pipeline: integer('use_m19_pipeline'),
```
to:
```ts
useMultiAgentPipeline: integer('use_multi_agent_pipeline'),
```

- [ ] **Step 2: Generate the migration**

```bash
pnpm --filter server db:generate
```

drizzle-kit will detect the column rename and may ask "Is `use_m19_pipeline` renamed to `use_multi_agent_pipeline`?" — answer **yes**.

- [ ] **Step 3: Inspect the generated migration**

Open the newest file in `core/db/migrations/`. It must contain a `RENAME COLUMN` statement, **not** a DROP + ADD pair. If it shows DROP + ADD, replace the file contents with:

```sql
ALTER TABLE `project_settings` RENAME COLUMN `use_m19_pipeline` TO `use_multi_agent_pipeline`;
```

A DROP + ADD would silently zero out the flag for all existing projects.

- [ ] **Step 4: Run the migration**

```bash
pnpm --filter server db:migrate
```

Expected: no errors, exits 0.

- [ ] **Step 5: Commit**

```bash
git add core/db/schema.ts core/db/migrations/
git commit -m "rename: use_m19_pipeline → use_multi_agent_pipeline (schema + migration)"
```

---

### Task 2: Repository layer

**Files:**
- Modify: `core/db/repositories/project-settings.ts`
- Modify: `core/db/repositories/project-settings.test.ts`

- [ ] **Step 1: Update `GlobalBudgetPatch` type (line 17)**

```ts
// Before
useM19Pipeline?: number | null;
// After
useMultiAgentPipeline?: number | null;
```

- [ ] **Step 2: Rename `deriveUseM19Pipeline` → `deriveUseMultiAgentPipeline` (line 36)**

```ts
export function deriveUseMultiAgentPipeline(row: ProjectSettingsRow | null): boolean {
  return row?.useMultiAgentPipeline === 1;
}
```

- [ ] **Step 3: Rename `getUseM19Pipeline` → `getUseMultiAgentPipeline` (line 40)**

```ts
export function getUseMultiAgentPipeline(projectId: string): boolean {
  try {
    return deriveUseMultiAgentPipeline(readProjectSettings(projectId));
  } catch (err) {
    logger.warn('getUseMultiAgentPipeline: read failed, defaulting to false', {
      projectId,
      error: String(err),
    });
    return false;
  }
}
```

- [ ] **Step 4: Rename `setUseM19Pipeline` → `setUseMultiAgentPipeline` (line 52)**

```ts
export function setUseMultiAgentPipeline(projectId: string, enabled: boolean, by: string): void {
  writeProjectSettings(projectId, { useMultiAgentPipeline: enabled ? 1 : 0 }, by);
}
```

- [ ] **Step 5: Update test fixtures in `project-settings.test.ts`**

Replace all three occurrences of `useM19Pipeline` with `useMultiAgentPipeline`:
- line ~20: `useM19Pipeline: null` → `useMultiAgentPipeline: null`
- line ~39: `useM19Pipeline: 0` → `useMultiAgentPipeline: 0`
- line ~58: `useM19Pipeline: 1` → `useMultiAgentPipeline: 1`

- [ ] **Step 6: Run repository tests**

```bash
pnpm --filter core vitest run repositories/project-settings
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add core/db/repositories/project-settings.ts core/db/repositories/project-settings.test.ts
git commit -m "rename: getUseM19Pipeline → getUseMultiAgentPipeline (repo layer)"
```

---

### Task 3: Server router

**Files:**
- Modify: `apps/server/src/domains/project-settings/model-router.ts`

- [ ] **Step 1: Update Zod schema field (line 277)**

```ts
// Before
useM19Pipeline: z.boolean(),
// After
useMultiAgentPipeline: z.boolean(),
```

- [ ] **Step 2: Update GET handler (line 288)**

```ts
// Before
useM19Pipeline: getUseM19Pipeline(project.id),
// After
useMultiAgentPipeline: getUseMultiAgentPipeline(project.id),
```

- [ ] **Step 3: Update PATCH handler (line 306)**

```ts
// Before
setUseM19Pipeline(project.id, parsed.data.useM19Pipeline, 'ui');
// After
setUseMultiAgentPipeline(project.id, parsed.data.useMultiAgentPipeline, 'ui');
```

- [ ] **Step 4: Update import at top of file**

```ts
// Before
import { …, getUseM19Pipeline, setUseM19Pipeline } from '…/project-settings.js';
// After
import { …, getUseMultiAgentPipeline, setUseMultiAgentPipeline } from '…/project-settings.js';
```

- [ ] **Step 5: Update comments (lines 280, 292)** — change any `useM19Pipeline` in comment text to `useMultiAgentPipeline`.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter server tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/domains/project-settings/model-router.ts
git commit -m "rename: useM19Pipeline → useMultiAgentPipeline (server router)"
```

---

### Task 4: Dispatch layer

**Files:**
- Modify: `apps/server/src/shared/dispatch.ts`
- Modify: `apps/server/src/shared/dispatch.test.ts`

- [ ] **Step 1: Update import (line 3)**

```ts
// Before
import { getUseM19Pipeline } from '@goose-hub/core/db/repositories/project-settings.js';
// After
import { getUseMultiAgentPipeline } from '@goose-hub/core/db/repositories/project-settings.js';
```

- [ ] **Step 2: Rename all `getUseM19Pipeline(…)` call sites**

There are 4 call sites (lines ~219, ~311, ~478, ~650, ~1258). Replace each `getUseM19Pipeline(` with `getUseMultiAgentPipeline(`.

- [ ] **Step 3: Rename local variable `useM19` → `useMultiAgent`**

Replace every occurrence of `const useM19 =` and references to `useM19` (as a variable, not a log key) with `useMultiAgent`. There are ~8 occurrences across the four dispatch functions plus line ~1258.

- [ ] **Step 4: Update log key names**

Replace log-object keys `useM19Pipeline: useM19` with `useMultiAgentPipeline: useMultiAgent` (lines ~220, ~315, ~479, ~651).

- [ ] **Step 5: Update dispatch.test.ts**

- Line ~233: rename test description `'reads useM19Pipeline flag…'` → `'reads useMultiAgentPipeline flag…'`
- Line ~243: rename fixture key `useM19Pipeline: false` → `useMultiAgentPipeline: false`

- [ ] **Step 6: Run dispatch tests**

```bash
pnpm --filter server vitest run shared/dispatch
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/shared/dispatch.ts apps/server/src/shared/dispatch.test.ts
git commit -m "rename: useM19Pipeline → useMultiAgentPipeline (dispatch layer)"
```

---

### Task 5: Web client

**Files:**
- Modify: `apps/web/src/lib/types.ts:401-403`
- Modify: `apps/web/src/lib/api.ts:579-580`
- Modify: `apps/web/src/components/settings/components/PipelinePanel.tsx`

- [ ] **Step 1: Update DTO in `types.ts`**

```ts
export interface PipelineSettingsDto {
  slug: string;
  useMultiAgentPipeline: boolean;
}
```

- [ ] **Step 2: Update API function in `api.ts`**

```ts
export async function patchPipelineSettings(slug: string, useMultiAgentPipeline: boolean): Promise<void> {
  await patchJson(`/projects/${slug}/settings/pipeline`, { useMultiAgentPipeline });
}
```

- [ ] **Step 3: Update `PipelinePanel.tsx`**

Three spots:
1. `data-testid`: `"use-m19-pipeline-toggle"` → `"use-multi-agent-pipeline-toggle"`
2. `checked={data.useM19Pipeline}` → `checked={data.useMultiAgentPipeline}`
3. `onChange={(e) => patch.mutate(e.target.checked)}` — no change needed
4. `<span className="font-mono">useM19Pipeline</span>` → `<span className="font-mono">useMultiAgentPipeline</span>`
5. `{data.useM19Pipeline ? (` → `{data.useMultiAgentPipeline ? (`

Full updated JSX for the label block:
```tsx
<label className="flex items-center gap-2 text-[12.5px]">
  <input
    type="checkbox"
    data-testid="use-multi-agent-pipeline-toggle"
    checked={data.useMultiAgentPipeline}
    onChange={(e) => patch.mutate(e.target.checked)}
    disabled={patch.isPending}
    className="h-4 w-4 rounded border-line"
  />
  <span className="font-mono">useMultiAgentPipeline</span>
  {data.useMultiAgentPipeline ? (
    <span className="text-[11px] text-accent">enabled</span>
  ) : (
    <span className="text-[11px] text-fg-3">disabled</span>
  )}
</label>
```

- [ ] **Step 4: Typecheck web**

```bash
pnpm --filter web tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Run lint**

```bash
pnpm biome check apps/web/src apps/server/src
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/types.ts apps/web/src/lib/api.ts apps/web/src/components/settings/components/PipelinePanel.tsx
git commit -m "rename: useM19Pipeline → useMultiAgentPipeline (web client)"
```

---

### Task 6: Final verification

- [ ] **Step 1: Confirm no `m19` references remain in renamed symbols**

```bash
grep -r "useM19Pipeline\|use_m19_pipeline\|getUseM19\|setUseM19\|deriveUseM19" \
  core/db apps/server/src apps/web/src
```

Expected: zero results (or only comments in migration SQL that are fine to leave).

- [ ] **Step 2: Full typecheck both apps**

```bash
pnpm --filter server tsc --noEmit && pnpm --filter web tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Full test suite**

```bash
pnpm vitest run
```

Expected: all pass.

- [ ] **Step 4: Lint clean**

```bash
pnpm biome check apps/web/src apps/server/src core
```

Expected: no errors.
