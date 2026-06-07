# Audit Fix Plan 2: Cross-Slice Boundary Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate all cross-slice import violations identified in the June 2026 code-quality audit: promote two spec-author helpers to `core/`, and add a public `index.ts` barrel to `costs/` so other components can import it without reaching into its internals.

**Architecture:** Move `path-normalization.ts` and `prd-planning-context.ts` from `slices/spec-author/` into `core/engineering-specs/` (which already exists). Keep the spec-author slice importing from `core/` via its own barrel — the files move, the spec-author slice keeps using them. The parallel-implement slice also imports from core directly. For web: add `costs/index.ts` so `detail/CostsSection.tsx` imports via the public interface.

**Tech Stack:** TypeScript, pnpm workspaces

**Note on remaining web cross-slice imports:** The four web cross-slice imports flagged in the audit (`settings → bootstrap`, `chrome/TopBar → search`, `office → chrome/AppShell`) require judgment calls about whether to create public index barrels in each component or restructure the layout. These are noted below in Task 4 but scoped narrowly — create the missing barrels, not full restructures.

---

### Task 1: Promote `path-normalization.ts` to `core/engineering-specs/`

**Files:**
- Create: `core/engineering-specs/path-normalization.ts` (copy of slice file, no changes needed)
- Modify: `slices/spec-author/path-normalization.ts` → re-export from core
- Modify: `slices/parallel-implement/workflow.ts` → import from core

The existing `core/engineering-specs/` directory has `repository.ts`, `repository.test.ts`, `types.ts`, and `README.md`.

- [ ] **Step 1: Read the source file**

```bash
cat slices/spec-author/path-normalization.ts
```

- [ ] **Step 2: Read the core/engineering-specs/ README to understand conventions**

```bash
cat core/engineering-specs/README.md
```

- [ ] **Step 3: Copy to core**

Create `core/engineering-specs/path-normalization.ts` with the same content as `slices/spec-author/path-normalization.ts`. The file already imports only from `@goose-hub/core` and `@goose-hub/skills`, so no import-path changes are needed when it moves to core.

- [ ] **Step 4: Re-export from spec-author for backwards compat**

Replace `slices/spec-author/path-normalization.ts` body with a re-export:

```typescript
export {
  type SpecPathNormalizationField,
  normalizeEngineeringSpecPaths,
} from '@goose-hub/core/engineering-specs/path-normalization.js';
```

- [ ] **Step 5: Update parallel-implement/workflow.ts import**

In `slices/parallel-implement/workflow.ts` at line 63, change:

```typescript
import { normalizeEngineeringSpecPaths } from '../spec-author/path-normalization.js';
```

to:

```typescript
import { normalizeEngineeringSpecPaths } from '@goose-hub/core/engineering-specs/path-normalization.js';
```

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @goose-hub/core tsc --noEmit
pnpm --filter goose-hub-slices tsc --noEmit 2>/dev/null || pnpm tsc --noEmit
```

- [ ] **Step 7: Run tests for parallel-implement and spec-author**

```bash
pnpm test -- slices/parallel-implement
pnpm test -- slices/spec-author
```

- [ ] **Step 8: Commit**

```bash
git add core/engineering-specs/path-normalization.ts \
        slices/spec-author/path-normalization.ts \
        slices/parallel-implement/workflow.ts
git commit -m "fix: promote normalizeEngineeringSpecPaths to core/engineering-specs (cross-slice violation)"
```

---

### Task 2: Promote `prd-planning-context.ts` to `core/engineering-specs/`

**Files:**
- Create: `core/engineering-specs/prd-planning-context.ts`
- Modify: `slices/spec-author/prd-planning-context.ts` → re-export from core
- Modify: `slices/parallel-implement/workflow.ts` → import from core
- Modify: `slices/parallel-implement/wp-builder.ts` → import from core

- [ ] **Step 1: Read the source file**

```bash
cat slices/spec-author/prd-planning-context.ts
```

- [ ] **Step 2: Create in core**

Create `core/engineering-specs/prd-planning-context.ts` with the same content. The file imports only from `@goose-hub/core/...`, so no path changes needed after it moves.

- [ ] **Step 3: Re-export from spec-author**

Replace `slices/spec-author/prd-planning-context.ts` with:

```typescript
export type { PrdPlanningContext } from '@goose-hub/core/engineering-specs/prd-planning-context.js';
export { buildPrdPlanningContext } from '@goose-hub/core/engineering-specs/prd-planning-context.js';
```

(adjust the exports to match whatever the file actually exports — check Step 1 output)

- [ ] **Step 4: Update parallel-implement/workflow.ts import**

At line 64, change:

```typescript
import { buildPrdPlanningContext } from '../spec-author/prd-planning-context.js';
```

to:

```typescript
import { buildPrdPlanningContext } from '@goose-hub/core/engineering-specs/prd-planning-context.js';
```

- [ ] **Step 5: Update parallel-implement/wp-builder.ts import**

At line 42, change:

```typescript
import type { PrdPlanningContext } from '../spec-author/prd-planning-context.js';
```

to:

```typescript
import type { PrdPlanningContext } from '@goose-hub/core/engineering-specs/prd-planning-context.js';
```

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @goose-hub/core tsc --noEmit
pnpm tsc --noEmit  # or however slices typecheck
```

- [ ] **Step 7: Run affected tests**

```bash
pnpm test -- slices/parallel-implement
pnpm test -- slices/spec-author
```

- [ ] **Step 8: Verify no other slices still import from spec-author paths**

```bash
grep -rn "spec-author/prd-planning-context\|spec-author/path-normalization" slices/ --include="*.ts"
```

Expected: only the re-export files themselves (spec-author/path-normalization.ts and spec-author/prd-planning-context.ts).

- [ ] **Step 9: Commit**

```bash
git add core/engineering-specs/prd-planning-context.ts \
        slices/spec-author/prd-planning-context.ts \
        slices/parallel-implement/workflow.ts \
        slices/parallel-implement/wp-builder.ts
git commit -m "fix: promote PrdPlanningContext/buildPrdPlanningContext to core/engineering-specs (cross-slice violation)"
```

---

### Task 3: Add public `index.ts` barrel to `apps/web/src/components/costs/`

**Files:**
- Create: `apps/web/src/components/costs/index.ts`

`detail/CostsSection.tsx` imports `CostLegend` directly from `@/components/costs/CostLegend` — a cross-slice import into an internal file. Adding an `index.ts` gives a public interface.

- [ ] **Step 1: Read what costs/ exports**

```bash
ls apps/web/src/components/costs/
grep -n "^export" apps/web/src/components/costs/CostLegend.tsx apps/web/src/components/costs/CostsPage.tsx apps/web/src/components/costs/StageBar.tsx
```

- [ ] **Step 2: Create `index.ts`**

```typescript
export { CostLegend } from './CostLegend';
export { CostsPage } from './CostsPage';
export { StageBar } from './StageBar';
```

Adjust the exports to match what each file actually exports (check Step 1 output — use named or default as appropriate).

- [ ] **Step 3: Update CostsSection.tsx**

In `apps/web/src/components/detail/components/CostsSection.tsx` line 1, change:

```typescript
import { CostLegend } from '@/components/costs/CostLegend';
```

to:

```typescript
import { CostLegend } from '@/components/costs';
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @goose-hub/web tsc --noEmit
```

- [ ] **Step 5: Run web tests**

```bash
pnpm --filter @goose-hub/web test -- --reporter=verbose
```

- [ ] **Step 6: Confirm no other direct-to-file imports remain**

```bash
grep -rn "from '@/components/costs/" apps/web/src/ | grep -v "components/costs/index"
```

Expected: no output (all imports now go through the barrel).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/costs/index.ts \
        apps/web/src/components/detail/components/CostsSection.tsx
git commit -m "fix: add public index.ts to components/costs; update CostsSection import (cross-slice violation)"
```

---

### Task 4: Resolve remaining web cross-slice imports

**Files (investigate and fix):**
- `apps/web/src/components/settings/components/SettingsPage.tsx:1` → `@/components/bootstrap/components/BootstrapWizard`
- `apps/web/src/components/chrome/TopBar.tsx:1` → `@/components/search/components/SearchModal`
- `apps/web/src/components/office/components/OfficePage.tsx` → `@/components/chrome/AppShell`

The fix for each is the same pattern: check if the target component directory has an `index.ts`, and if not, add one and update the import.

- [ ] **Step 1: Check bootstrap for a public index**

```bash
ls apps/web/src/components/bootstrap/
grep -n "BootstrapWizard" apps/web/src/components/bootstrap/index.ts 2>/dev/null || echo "no index"
```

If no index: create `apps/web/src/components/bootstrap/index.ts`:

```typescript
export { BootstrapWizard } from './components/BootstrapWizard';
```

Update `SettingsPage.tsx:1`:

```typescript
import { BootstrapWizard } from '@/components/bootstrap';
```

- [ ] **Step 2: Check search for a public index**

```bash
ls apps/web/src/components/search/
grep -n "SearchModal" apps/web/src/components/search/index.ts 2>/dev/null || echo "no index"
```

If no index: create `apps/web/src/components/search/index.ts`:

```typescript
export { SearchModal } from './components/SearchModal';
```

Update `TopBar.tsx:1`:

```typescript
import { SearchModal } from '@/components/search';
```

- [ ] **Step 3: Check chrome for a public index**

```bash
ls apps/web/src/components/chrome/
grep -n "AppShell" apps/web/src/components/chrome/index.ts 2>/dev/null || echo "no index"
```

If no index: create `apps/web/src/components/chrome/index.ts`:

```typescript
export { AppShell } from './AppShell';
```

Find the exact import in `OfficePage.tsx`:

```bash
grep -n "AppShell" apps/web/src/components/office/components/OfficePage.tsx
```

Update that import to use the barrel.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @goose-hub/web tsc --noEmit
```

- [ ] **Step 5: Run web tests**

```bash
pnpm --filter @goose-hub/web test
```

- [ ] **Step 6: Confirm no remaining cross-component deep imports**

```bash
grep -rn "from '@/components/bootstrap/components/\|from '@/components/search/components/\|from '@/components/chrome/[A-Z]" apps/web/src/ | grep -v "\.test\."
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/bootstrap/index.ts \
        apps/web/src/components/search/index.ts \
        apps/web/src/components/chrome/index.ts \
        apps/web/src/components/settings/components/SettingsPage.tsx \
        apps/web/src/components/chrome/TopBar.tsx \
        apps/web/src/components/office/components/OfficePage.tsx
git commit -m "fix: add index.ts barrels to bootstrap/search/chrome; fix 3 web cross-slice imports"
```

---

### Wrap-up: final cross-slice audit

- [ ] **Step 1: Confirm zero remaining cross-slice imports in slices/**

```bash
grep -rn "\.\./[a-z]" slices/parallel-implement/ --include="*.ts" | grep -v "node_modules"
```

Expected: no inter-slice relative imports.

- [ ] **Step 2: Full typecheck**

```bash
pnpm --filter @goose-hub/core tsc --noEmit
pnpm --filter @goose-hub/server tsc --noEmit
pnpm --filter @goose-hub/web tsc --noEmit
```

- [ ] **Step 3: Full test suite**

```bash
pnpm --filter @goose-hub/core test
pnpm --filter @goose-hub/server test
pnpm --filter @goose-hub/web test
```
