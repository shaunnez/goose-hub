# Audit Fix Plan 1: Dead Code Sweep + Missing Files + Server Hardening

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove confirmed dead code, add required slice files, and fix two unvalidated-input bugs in the issues router — all identified in the June 2026 code-quality audit.

**Architecture:** Purely subtractive changes plus a few new stub files. No new abstractions. Each task is independently mergeable and verifiable.

**Tech Stack:** TypeScript, Hono, Zod, Vitest, React

---

### Task 1: Delete unused `RightRail.tsx`

**Files:**
- Delete: `apps/web/src/components/detail/components/RightRail.tsx`

The file is 190 lines, ~130 of which are commented-out code. It renders only a placeholder stub and has zero importers.

- [ ] **Step 1: Confirm no importers**

```bash
grep -rn "RightRail" apps/web/src/
```

Expected: no output (file exports only to itself).

- [ ] **Step 2: Delete the file**

```bash
rm apps/web/src/components/detail/components/RightRail.tsx
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @goose-hub/web tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "remove: delete unused RightRail.tsx stub (all code commented out, zero importers)"
```

---

### Task 2: Delete unused `core/tool-layer/mcp/tools/workflow.ts`

**Files:**
- Delete: `core/tool-layer/mcp/tools/workflow.ts`
- Delete: `core/tool-layer/mcp/tools/workflow.test.ts`

The file is self-documented as "unused / deprecated until adopted" and nothing imports it.

- [ ] **Step 1: Confirm no importers**

```bash
grep -rn "tool-layer/mcp/tools/workflow" core/ apps/ slices/ --include="*.ts" --include="*.tsx" | grep -v "workflow\.ts\|workflow\.test\.ts"
```

Expected: no output.

- [ ] **Step 2: Delete both files**

```bash
rm core/tool-layer/mcp/tools/workflow.ts core/tool-layer/mcp/tools/workflow.test.ts
```

- [ ] **Step 3: Run core tests**

```bash
pnpm --filter @goose-hub/core test
```

Expected: all tests pass (the deleted test file is gone, not failing).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "remove: delete core/tool-layer/mcp/tools/workflow.ts (self-documented unused/deprecated)"
```

---

### Task 3: Remove deprecated `deskPositions()` from layout.ts

**Files:**
- Modify: `apps/web/src/components/office/lib/layout.ts`

`deskPositions()` is marked `@deprecated v1` and has zero importers.

- [ ] **Step 1: Confirm no importers**

```bash
grep -rn "deskPositions" apps/web/src/
```

Expected: only the definition in `layout.ts`.

- [ ] **Step 2: Read the file to find the function**

```bash
grep -n "deskPositions" apps/web/src/components/office/lib/layout.ts
```

Note the line range, then open the file to see the full function body.

- [ ] **Step 3: Delete the function**

Remove the `deskPositions` export and its JSDoc from `layout.ts`. The function starts at line 54 (per audit). Delete from the `/** @deprecated` JSDoc comment through the closing `}`.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @goose-hub/web tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/office/lib/layout.ts
git commit -m "remove: delete deprecated deskPositions() (zero importers, @deprecated v1)"
```

---

### Task 4: Remove dead `rejectPRD` import from issues router

**Files:**
- Modify: `apps/server/src/domains/issues/router.ts`

The route at `/reject-prd` returns a hardcoded 410 and never calls `rejectPRD`. The import at line 25 is dead weight.

- [ ] **Step 1: Confirm route does not call rejectPRD**

```bash
grep -n "rejectPRD" apps/server/src/domains/issues/router.ts
```

Expected: only one line — the import. The route body does not call the function.

- [ ] **Step 2: Remove the import**

In `apps/server/src/domains/issues/router.ts`, find the import statement that includes `rejectPRD` and remove it from the destructure list. For example, if the import reads:

```typescript
import {
  approvePRD,
  declinePRD,
  rejectPRD,
  revisePRD,
} from './prd-actions.js';
```

Change it to:

```typescript
import {
  approvePRD,
  declinePRD,
  revisePRD,
} from './prd-actions.js';
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @goose-hub/server tsc --noEmit
```

- [ ] **Step 4: Run router tests**

```bash
pnpm --filter @goose-hub/server test -- --reporter=verbose domains/issues/router
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/domains/issues/router.ts
git commit -m "remove: dead rejectPRD import from issues router (route is a 410 tombstone)"
```

---

### Task 5: Remove dead `eslint-disable` comments

**Files:**
- Modify: `apps/web/src/components/detail/components/MoveToCurrentDialog.tsx` (line 129)
- Modify: `apps/web/src/components/office/game/choreography/Timeline.ts` (line 64)

Project uses Biome, not ESLint. These suppressions do nothing.

- [ ] **Step 1: Delete the comment in MoveToCurrentDialog.tsx**

Open `apps/web/src/components/detail/components/MoveToCurrentDialog.tsx`. Find line 129:

```typescript
    // eslint-disable-next-line react-hooks/exhaustive-deps
```

Delete that line.

- [ ] **Step 2: Delete the comment in Timeline.ts**

Open `apps/web/src/components/office/game/choreography/Timeline.ts`. Find the `eslint-disable` comment around line 64 and delete it.

- [ ] **Step 3: Typecheck + Biome**

```bash
pnpm --filter @goose-hub/web tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/detail/components/MoveToCurrentDialog.tsx \
        apps/web/src/components/office/game/choreography/Timeline.ts
git commit -m "remove: dead eslint-disable comments (project uses Biome)"
```

---

### Task 6: Remove commented-out imports

**Files:**
- Modify: `apps/web/src/App.tsx` (line 2)
- Modify: `apps/web/src/components/detail/components/LeftRail.tsx` (line 2)
- Modify: `apps/web/src/components/detail/components/InvestigationSection.tsx` (line 15)
- Modify: `apps/web/src/components/detail/components/DetailPage.tsx` (line 55)
- Modify: `apps/web/src/components/board/components/Board.tsx` (line 40)

- [ ] **Step 1: Delete each commented import**

`apps/web/src/App.tsx:2`:
```typescript
// import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
```
Delete that line.

`apps/web/src/components/detail/components/LeftRail.tsx:2`:
```typescript
// import { GRILL_ACTIVE_STATES, PRD_ACTIVE_STATES } from '@/lib/constants';
```
Delete that line.

`apps/web/src/components/detail/components/InvestigationSection.tsx:15`:
```typescript
// import { Filter, RefreshCw } from 'lucide-react';
```
Delete that line.

For `DetailPage.tsx` and `Board.tsx`, grep for commented imports at the top of the file and delete them:

```bash
grep -n "^// import" apps/web/src/components/detail/components/DetailPage.tsx
grep -n "^// import" apps/web/src/components/board/components/Board.tsx
```

Delete whichever lines are found.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @goose-hub/web tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/App.tsx \
        apps/web/src/components/detail/components/LeftRail.tsx \
        apps/web/src/components/detail/components/InvestigationSection.tsx \
        apps/web/src/components/detail/components/DetailPage.tsx \
        apps/web/src/components/board/components/Board.tsx
git commit -m "remove: commented-out import lines in 5 web files"
```

---

### Task 7: Add required `README.md` to `slices/feature-grounding/`

**Files:**
- Create: `slices/feature-grounding/README.md`

- [ ] **Step 1: Read the workflow to understand what the slice does**

```bash
head -60 slices/feature-grounding/workflow.ts
```

- [ ] **Step 2: Write the README**

Create `slices/feature-grounding/README.md` with this content (adjust the summary if the file read differs from below):

```markdown
# feature-grounding slice

## What this slice does

Runs the feature-grounding agent. Given a work item, it researches the
codebase to produce context that downstream implementation workflows consume:
relevant files, existing patterns, and a grounded understanding of how the
requested feature fits the current architecture.

## Files

- `workflow.ts` — entry point; drives the agent run and emits a
  `FeatureGroundingOutput` schema result.

## Tests

- `slice.test.ts` — smoke test; run with `pnpm test` inside `slices/feature-grounding/`.

## Usage

Called by `parallel-implement` and `fix-issue` workflows when grounding context
is required before implementation begins.
```

- [ ] **Step 3: Commit**

```bash
git add slices/feature-grounding/README.md
git commit -m "docs: add required README.md to slices/feature-grounding"
```

---

### Task 8: Fix stale `slice.test.ts` reference in `slices/grill-prd-ui/README.md`

**Files:**
- Modify: `slices/grill-prd-ui/README.md`

The README references `slice.test.ts` but the file does not exist.

- [ ] **Step 1: Confirm file is missing**

```bash
ls slices/grill-prd-ui/
```

Expected: `README.md` only (no `slice.test.ts`).

- [ ] **Step 2: Remove the stale reference**

Find line 85 in `slices/grill-prd-ui/README.md`:

```markdown
- `slice.test.ts` — slice-level smoke test that asserts the approve/reject helpers work end-to-end against the in-memory state source.
```

Delete that line (or replace it with a note that tests live in `prd-actions.test.ts` if that is accurate).

- [ ] **Step 3: Commit**

```bash
git add slices/grill-prd-ui/README.md
git commit -m "docs: remove stale slice.test.ts reference from grill-prd-ui README"
```

---

### Task 9: Add required files to `apps/web/src/components/costs/`

**Files:**
- Create: `apps/web/src/components/costs/README.md`
- Create: `apps/web/src/components/costs/slice.test.ts`

- [ ] **Step 1: Confirm current state**

```bash
ls apps/web/src/components/costs/
```

- [ ] **Step 2: Create README.md**

```markdown
# costs

UI components for displaying agent-run cost data on the detail page.

## Files

- `CostLegend.tsx` — legend explaining estimated vs. actual cost markers.
- `CostsPage.tsx` — full costs breakdown page for a work item.
- `StageBar.tsx` — horizontal bar chart of costs per workflow stage.

## Public interface

Import via the `index.ts` barrel:

```typescript
import { CostLegend } from '@/components/costs/index';
```

## Tests

- `slice.test.ts` — smoke tests that components render without crashing.
```

- [ ] **Step 3: Create slice.test.ts**

```typescript
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CostLegend } from './CostLegend';
import { StageBar } from './StageBar';

describe('costs slice smoke tests', () => {
  it('renders CostLegend without crashing', () => {
    const { container } = render(<CostLegend />);
    expect(container).toBeTruthy();
  });

  it('renders StageBar without crashing', () => {
    const { container } = render(<StageBar stages={[]} totalCost={0} />);
    expect(container).toBeTruthy();
  });
});
```

Note: adjust prop types to match the actual component signatures after reading `StageBar.tsx`.

- [ ] **Step 4: Run the test**

```bash
pnpm --filter @goose-hub/web test -- costs/slice.test
```

Fix any import or prop errors until the test passes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/costs/README.md \
        apps/web/src/components/costs/slice.test.ts
git commit -m "docs: add required README.md + slice.test.ts to components/costs"
```

---

### Task 10: Add required files to `apps/web/src/components/interventions/`

**Files:**
- Create: `apps/web/src/components/interventions/README.md`
- Create: `apps/web/src/components/interventions/slice.test.ts`

- [ ] **Step 1: Read the component to understand what it does**

```bash
head -30 apps/web/src/components/interventions/OperatorQueuePage.tsx
```

- [ ] **Step 2: Create README.md**

```markdown
# interventions

UI for the operator intervention queue. Displays pending Factory interventions
for the logged-in user and lets the operator approve or reject them.

## Files

- `OperatorQueuePage.tsx` — full-page intervention queue.
- `OperatorQueuePage.test.tsx` — existing Vitest tests for the page.

## Tests

- `slice.test.ts` — smoke tests for the intervention components.
- `OperatorQueuePage.test.tsx` — existing integration tests.
```

- [ ] **Step 3: Create slice.test.ts**

```typescript
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  fetchProjectInterventions: vi.fn().mockResolvedValue([]),
  decideIntervention: vi.fn(),
  fetchIssues: vi.fn().mockResolvedValue([]),
  fetchProjectConfigs: vi.fn().mockResolvedValue([]),
}));

describe('interventions slice smoke test', () => {
  it('module loads without throwing', async () => {
    const mod = await import('./OperatorQueuePage');
    expect(mod.OperatorQueuePage).toBeDefined();
  });
});
```

- [ ] **Step 4: Run the test**

```bash
pnpm --filter @goose-hub/web test -- interventions/slice.test
```

Fix any errors until the test passes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/interventions/README.md \
        apps/web/src/components/interventions/slice.test.ts
git commit -m "docs: add required README.md + slice.test.ts to components/interventions"
```

---

### Task 11: Zod-coerce issues router query params

**Files:**
- Modify: `apps/server/src/domains/issues/router.ts`

Two routes use raw `Number()` on query strings. `Number('')` returns `0` and `Number('abc')` returns `NaN` — both can reach the service layer silently.

Fix the events route (lines ~70-82) and the artifacts route (lines ~113-120) to use `z.coerce.number()` with validation before passing to the service.

- [ ] **Step 1: Read the routes**

```bash
sed -n '60,130p' apps/server/src/domains/issues/router.ts
```

- [ ] **Step 2: Add Zod schemas at top of the events route handler**

Replace the events route handler's query-param parsing:

```typescript
// Before
const limitStr = c.req.query('limit');
const beforeStr = c.req.query('before');
const afterStr = c.req.query('after');
const opts =
  limitStr != null
    ? {
        limit: Number(limitStr),
        before: beforeStr != null ? Number(beforeStr) : undefined,
        after: afterStr != null ? Number(afterStr) : undefined,
      }
    : undefined;
```

With:

```typescript
const EventsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
  before: z.coerce.number().int().positive().optional(),
  after: z.coerce.number().int().positive().optional(),
});

const queryParse = EventsQuerySchema.safeParse({
  limit: c.req.query('limit'),
  before: c.req.query('before'),
  after: c.req.query('after'),
});
if (!queryParse.success) {
  return c.json({ error: 'Invalid query parameters' }, 400);
}
const opts =
  queryParse.data.limit != null
    ? {
        limit: queryParse.data.limit,
        before: queryParse.data.before,
        after: queryParse.data.after,
      }
    : undefined;
```

- [ ] **Step 3: Fix the artifacts route**

Replace:

```typescript
offset: offset == null ? undefined : Number(offset),
limit: limit == null ? undefined : Number(limit),
```

With:

```typescript
const ArtifactQuerySchema = z.object({
  offset: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
const artifactQuery = ArtifactQuerySchema.safeParse({ offset, limit });
if (!artifactQuery.success) {
  return c.json({ error: 'Invalid query parameters' }, 400);
}
```

And use `artifactQuery.data.offset` / `artifactQuery.data.limit` in the service call.

Ensure `z` is imported at the top of the router:

```typescript
import { z } from 'zod';
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @goose-hub/server tsc --noEmit
```

- [ ] **Step 5: Run router tests**

```bash
pnpm --filter @goose-hub/server test -- --reporter=verbose domains/issues/router
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/domains/issues/router.ts
git commit -m "fix: Zod-coerce issues router query params (prevent NaN reaching service layer)"
```

---

### Wrap-up: full typecheck + test suite

- [ ] **Step 1: Full typecheck both apps**

```bash
pnpm --filter @goose-hub/server tsc --noEmit
pnpm --filter @goose-hub/web tsc --noEmit
```

- [ ] **Step 2: Run all server tests**

```bash
pnpm --filter @goose-hub/server test
```

- [ ] **Step 3: Run all web tests**

```bash
pnpm --filter @goose-hub/web test
```

Expected: green across both. Fix any regressions before reporting complete.
