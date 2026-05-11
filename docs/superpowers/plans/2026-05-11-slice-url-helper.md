# Slice URL Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all hardcoded `new URL('../../../../slices/...', import.meta.url)` strings with a shared `sliceUrl()` helper that computes URLs from the already-known `REPO_ROOT`.

**Architecture:** Create `apps/server/src/shared/slice-url.ts` that exports `REPO_ROOT` and `sliceUrl(sliceName)`. The four affected files — `dispatch.ts`, `review-batch.ts`, `qa-batch.ts`, `transitions.ts` — import from `#shared/slice-url.js` and drop their local relative URL strings. No behavior change.

**Tech Stack:** Node.js built-ins (`node:path`, `node:url`), Vitest, TypeScript.

---

## File Map

| Action | Path |
|--------|------|
| Create | `apps/server/src/shared/slice-url.ts` |
| Create | `apps/server/src/shared/slice-url.test.ts` |
| Modify | `apps/server/src/shared/dispatch.ts` |
| Modify | `apps/server/src/domains/workflows/review-batch.ts` |
| Modify | `apps/server/src/domains/workflows/qa-batch.ts` |
| Modify | `apps/server/src/domains/issues/transitions.ts` |

---

### Task 1: Create `slice-url.ts` with test (TDD)

**Files:**
- Create: `apps/server/src/shared/slice-url.ts`
- Create: `apps/server/src/shared/slice-url.test.ts`

`slice-url.ts` lives at `apps/server/src/shared/` — four directory levels below repo root, same depth as `dispatch.ts`. `pathToFileURL` is used instead of string interpolation so path separators are handled correctly on any OS.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/shared/slice-url.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, sliceUrl } from './slice-url.js';

describe('sliceUrl', () => {
  it('returns a file:// URL', () => {
    expect(sliceUrl('investigate')).toMatch(/^file:\/\//);
  });

  it('points to the correct slice workflow path', () => {
    expect(sliceUrl('investigate')).toContain('/slices/investigate/workflow.js');
    expect(sliceUrl('qa')).toContain('/slices/qa/workflow.js');
    expect(sliceUrl('fix-issue')).toContain('/slices/fix-issue/workflow.js');
  });

  it('REPO_ROOT resolves above apps/server', () => {
    expect(REPO_ROOT).not.toMatch(/apps[/\\]server/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test
```

Expected: FAIL — `slice-url.js` not found.

- [ ] **Step 3: Write the implementation**

Create `apps/server/src/shared/slice-url.ts`:

```ts
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REPO_ROOT = join(import.meta.dirname, '../../../..');

export function sliceUrl(sliceName: string): string {
  return new URL(`slices/${sliceName}/workflow.js`, pathToFileURL(REPO_ROOT + '/')).href;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test
```

Expected: all three `sliceUrl` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/shared/slice-url.ts apps/server/src/shared/slice-url.test.ts
git commit -m "feat(server): add sliceUrl helper to centralise slice workflow URL construction"
```

---

### Task 2: Update `dispatch.ts`

**Files:**
- Modify: `apps/server/src/shared/dispatch.ts`

`dispatch.ts` already computes `REPO_ROOT` locally on line 79 and uses it as a param to workflow functions. We replace the local constant with the imported one, and replace all eight `new URL('../../../../slices/...', import.meta.url).href` expressions with `sliceUrl('...')`.

- [ ] **Step 1: Add the import and remove the local constant**

In `apps/server/src/shared/dispatch.ts`, add to the imports (keep all existing imports, only add this):

```ts
import { REPO_ROOT, sliceUrl } from './slice-url.js';
```

Remove line 79:
```ts
const REPO_ROOT = join(import.meta.dirname, '../../../..');
```

If `join` is no longer used after removing line 79, remove `join` from the `node:path` import. Check: `join` is also used in `dispatchParallelImplement` for `join(tmpdir(), ...)` — so keep the `join` import.

- [ ] **Step 2: Replace the eight dynamic import URL expressions**

Each pattern below follows the same structure — only the slice name changes. Replace each `new URL('../../../../slices/<name>/workflow.js', import.meta.url).href` with `sliceUrl('<name>')`.

| Line (approx) | Old expression | New expression |
|---|---|---|
| 121 | `new URL('../../../../slices/investigate/workflow.js', import.meta.url).href` | `sliceUrl('investigate')` |
| 177 | `new URL('../../../../slices/spec-author/workflow.js', import.meta.url).href` | `sliceUrl('spec-author')` |
| 253 | `new URL('../../../../slices/fix-issue/workflow.js', import.meta.url).href` | `sliceUrl('fix-issue')` |
| 348 | `new URL('../../../../slices/parallel-implement/workflow.js', import.meta.url).href` | `sliceUrl('parallel-implement')` |
| 476 | `new URL('../../../../slices/resolve-conflict/workflow.js', import.meta.url).href` | `sliceUrl('resolve-conflict')` |
| 544 | `new URL('../../../../slices/qa/workflow.js', import.meta.url).href` | `sliceUrl('qa')` |
| 600 | `new URL('../../../../slices/fix-feedback/workflow.js', import.meta.url).href` | `sliceUrl('fix-feedback')` |
| 721 | `new URL('../../../../slices/review/workflow.js', import.meta.url).href` | `sliceUrl('review')` |

After all eight are replaced, `import.meta.url` will no longer appear in `dispatch.ts`. The `import.meta.dirname` was only used for `REPO_ROOT` (now gone). Both can be removed as they will no longer appear in the file — but check first with a quick grep before deleting.

Each replacement looks like this (example for investigate):

Before:
```ts
const { runInvestigateWorkflow } = (await import(
  new URL('../../../../slices/investigate/workflow.js', import.meta.url).href
)) as { ... };
```

After:
```ts
const { runInvestigateWorkflow } = (await import(
  sliceUrl('investigate')
)) as { ... };
```

- [ ] **Step 3: Run typecheck and tests**

```bash
pnpm typecheck && pnpm test
```

Expected: no type errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/shared/dispatch.ts
git commit -m "refactor(server): use sliceUrl() in dispatch.ts, remove local REPO_ROOT"
```

---

### Task 3: Update `review-batch.ts`, `qa-batch.ts`, `transitions.ts`

**Files:**
- Modify: `apps/server/src/domains/workflows/review-batch.ts`
- Modify: `apps/server/src/domains/workflows/qa-batch.ts`
- Modify: `apps/server/src/domains/issues/transitions.ts`

All three files use the 5-level `../../../../../slices/` pattern (one level deeper than dispatch.ts because they live under `domains/`). They all already use the `#shared/` import alias.

- [ ] **Step 1: Update `review-batch.ts`**

Add import at top of `apps/server/src/domains/workflows/review-batch.ts`:

```ts
import { sliceUrl } from '#shared/slice-url.js';
```

Replace:

```ts
const { runReviewWorkflow } = (await import(
  new URL('../../../../../slices/review/workflow.js', import.meta.url).href
)) as {
  runReviewWorkflow: (
    item: WorkItem,
    source: StateSource,
    projectId: string,
    repo: string,
  ) => Promise<void>;
};
```

With:

```ts
const { runReviewWorkflow } = (await import(
  sliceUrl('review')
)) as {
  runReviewWorkflow: (
    item: WorkItem,
    source: StateSource,
    projectId: string,
    repo: string,
  ) => Promise<void>;
};
```

- [ ] **Step 2: Update `qa-batch.ts`**

Add import at top of `apps/server/src/domains/workflows/qa-batch.ts`:

```ts
import { sliceUrl } from '#shared/slice-url.js';
```

Replace:

```ts
const { runQaWorkflow } = (await import(
  new URL('../../../../../slices/qa/workflow.js', import.meta.url).href
)) as {
  runQaWorkflow: (
    item: WorkItem,
    source: StateSource,
    projectId: string,
    repo: string,
  ) => Promise<void>;
};
```

With:

```ts
const { runQaWorkflow } = (await import(
  sliceUrl('qa')
)) as {
  runQaWorkflow: (
    item: WorkItem,
    source: StateSource,
    projectId: string,
    repo: string,
  ) => Promise<void>;
};
```

- [ ] **Step 3: Update `transitions.ts`**

Add import at top of `apps/server/src/domains/issues/transitions.ts`:

```ts
import { sliceUrl } from '#shared/slice-url.js';
```

Replace the `loadMergeDecision` function body:

```ts
async function loadMergeDecision(): Promise<RunMergeDecisionFn> {
  const mod = (await import(
    new URL('../../../../../slices/merge-decision/workflow.js', import.meta.url).href
  )) as { runMergeDecision: RunMergeDecisionFn };
  return mod.runMergeDecision;
}
```

With:

```ts
async function loadMergeDecision(): Promise<RunMergeDecisionFn> {
  const mod = (await import(sliceUrl('merge-decision'))) as {
    runMergeDecision: RunMergeDecisionFn;
  };
  return mod.runMergeDecision;
}
```

- [ ] **Step 4: Run typecheck and tests**

```bash
pnpm typecheck && pnpm test
```

Expected: no type errors, all tests pass (including `review-batch.test.ts`, `qa-batch.test.ts`, and any tests covering `transitions.ts`).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/domains/workflows/review-batch.ts \
        apps/server/src/domains/workflows/qa-batch.ts \
        apps/server/src/domains/issues/transitions.ts
git commit -m "refactor(server): use sliceUrl() in review-batch, qa-batch, transitions"
```

---

### Task 4: Final verification

- [ ] **Step 1: Confirm no remaining raw slice URL strings**

```bash
grep -r "slices.*workflow\.js" apps/server/src --include="*.ts"
```

Expected: zero results. All references to slice workflow paths now go through `sliceUrl()`.

- [ ] **Step 2: Confirm no remaining `import.meta.url` in dispatch files**

```bash
grep -r "import\.meta\.url" apps/server/src/shared/dispatch.ts apps/server/src/domains/workflows/review-batch.ts apps/server/src/domains/workflows/qa-batch.ts apps/server/src/domains/issues/transitions.ts
```

Expected: zero results.

- [ ] **Step 3: Full check**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all pass.
