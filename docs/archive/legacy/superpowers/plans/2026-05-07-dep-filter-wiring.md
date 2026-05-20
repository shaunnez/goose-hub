# Dep Filter Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `filterEligibleByDependencies` into `dispatchFixIssue` so that issues with unmet `Depends on` references are blocked from dispatch at the point they would otherwise run the dev workflow.

**Architecture:** The function `filterEligibleByDependencies` in `core/projects/dependency-scheduler.ts` is fully implemented and unit-tested. It is never imported outside its own test file. The fix is a single insertion point in `dispatchFixIssue` inside `apps/server/src/shared/dispatch.ts`: after fetching the work item, before the dynamic workflow import, call the filter. If the item is not in the `eligible` partition, return early. The `SchedulerContext` it needs — `currentRepo`, `fetchTarget`, `source` — is all available in `dispatchFixIssue`'s existing call context.

**Tech Stack:** TypeScript, Vitest (vi.mock pattern), Drizzle/SQLite (no schema changes needed).

---

## File Map

| File | Change |
|------|--------|
| `apps/server/src/shared/dispatch.ts` | Add two imports; add ~10 lines inside `dispatchFixIssue` `try` block |
| `apps/server/src/shared/dispatch.test.ts` | Add mock stubs + two new test cases in the `dispatchFixIssue` describe block |

No other files change. `dependency-scheduler.ts` and `dependency-resolver.ts` are consumed as-is.

---

## Task 1: Write failing tests for the blocked-dep and satisfied-dep paths

**Files:**
- Modify: `apps/server/src/shared/dispatch.test.ts`

- [ ] **Step 1: Read the current top-of-file mock setup in dispatch.test.ts to understand the pattern**

  Open `apps/server/src/shared/dispatch.test.ts` and confirm the structure: top-level `vi.fn()` stubs, then `vi.mock(...)` calls, then a `beforeEach` that resets mocks. The new mocks follow this same pattern exactly.

- [ ] **Step 2: Add mock stubs and vi.mock calls for the two new imports**

  In `dispatch.test.ts`, add the following at the top-level (alongside the existing `vi.fn()` stubs and `vi.mock()` calls). Place the stubs immediately after the existing `mockGetProject` line, and the `vi.mock` calls immediately after the existing `vi.mock('./projects.js', ...)` block:

  ```typescript
  const mockFilterEligibleByDependencies = vi.fn();
  const mockCreateProjectAwareTargetSource = vi.fn();

  vi.mock('@goose-hub/core/projects/dependency-scheduler.js', () => ({
    filterEligibleByDependencies: mockFilterEligibleByDependencies,
  }));

  vi.mock('@goose-hub/core/state-source/dependency-resolver.js', () => ({
    createProjectAwareTargetSource: mockCreateProjectAwareTargetSource,
  }));
  ```

- [ ] **Step 3: Add default mock values in beforeEach**

  Inside the existing `beforeEach` block (after `mockGetProject.mockResolvedValue(null)`), add:

  ```typescript
  // By default, no dep check (no project config, so dep filter is skipped).
  // Individual tests override as needed.
  mockCreateProjectAwareTargetSource.mockResolvedValue(vi.fn());
  mockFilterEligibleByDependencies.mockResolvedValue({
    eligible: [],
    blocked: [],
    unregistered: [],
  });
  ```

- [ ] **Step 4: Add the two new test cases inside the existing `describe('dispatchFixIssue', ...)` block**

  Add these after the existing `'drops duplicate trigger for same issue while in-flight'` test:

  ```typescript
  it(
    'skips workflow and logs when item is dep-blocked',
    { timeout: 30_000 },
    async () => {
      const mockItem = {
        id: 'item-1',
        externalId: '42',
        title: 'blocked issue',
        body: 'Depends on #99',
        state: 'factory:dev-ready',
        schedule: 'current',
        type: 'feature',
      };
      const mockSource = {
        getItem: vi.fn().mockResolvedValue(mockItem),
        setLabelInGroup: vi.fn().mockResolvedValue(undefined),
        comment: vi.fn().mockResolvedValue(undefined),
      };
      mockGetSourceForSlug.mockResolvedValue(mockSource);
      mockGetProject.mockResolvedValue({
        budgets: { maxParallelAgents: 1 },
        source: { repo: 'shaunnez/goose-hub', type: 'github' },
      });
      mockFilterEligibleByDependencies.mockResolvedValue({
        eligible: [],
        blocked: [mockItem],
        unregistered: [],
      });

      const { dispatchFixIssue } = await import('./dispatch.js');
      await expect(dispatchFixIssue('slug', 42)).resolves.toBeUndefined();

      expect(mockFilterEligibleByDependencies).toHaveBeenCalledWith(
        [mockItem],
        expect.objectContaining({ currentRepo: 'shaunnez/goose-hub' }),
      );
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'dispatchFixIssue: item blocked by deps, skipping',
        expect.objectContaining({ slug: 'slug', issueNumber: 42 }),
      );
    },
  );

  it(
    'runs workflow when item has no unmet deps (eligible)',
    { timeout: 30_000 },
    async () => {
      const mockItem = {
        id: 'item-2',
        externalId: '43',
        title: 'clear issue',
        body: 'No deps',
        state: 'factory:dev-ready',
        schedule: 'current',
        type: 'feature',
      };
      const mockSource = {
        getItem: vi.fn().mockResolvedValue(mockItem),
        setLabelInGroup: vi.fn().mockResolvedValue(undefined),
        comment: vi.fn().mockResolvedValue(undefined),
      };
      mockGetSourceForSlug.mockResolvedValue(mockSource);
      mockGetProject.mockResolvedValue({
        budgets: { maxParallelAgents: 1 },
        source: { repo: 'shaunnez/goose-hub', type: 'github' },
      });
      mockFilterEligibleByDependencies.mockResolvedValue({
        eligible: [mockItem],
        blocked: [],
        unregistered: [],
      });

      // The dynamic import of slices/fix-issue/workflow.js will fail in the
      // test environment (slices/ is not compiled in unit test scope). That
      // error surfaces as a rejected promise, confirming the workflow dispatch
      // path was reached (dep filter did NOT short-circuit).
      const { dispatchFixIssue } = await import('./dispatch.js');
      // Resolves because errors from dynamic import are caught internally by
      // dispatchFixIssue's try/finally — or rejects if the import itself throws.
      // Either way, filterEligibleByDependencies must have been called.
      await dispatchFixIssue('slug', 43).catch(() => {
        // acceptable: dynamic import may fail in test env
      });

      expect(mockFilterEligibleByDependencies).toHaveBeenCalledWith(
        [mockItem],
        expect.objectContaining({ currentRepo: 'shaunnez/goose-hub' }),
      );
      // Confirm logger did NOT emit the blocked-by-deps message.
      expect(mockLoggerInfo).not.toHaveBeenCalledWith(
        'dispatchFixIssue: item blocked by deps, skipping',
        expect.anything(),
      );
    },
  );
  ```

- [ ] **Step 5: Run the new tests to confirm they FAIL**

  ```bash
  cd /Users/shaunnesbitt/projects/goose-hub
  pnpm --filter @goose-hub/server test apps/server/src/shared/dispatch.test.ts 2>&1 | grep -A 3 "blocked by deps\|eligible"
  ```

  Expected: both new tests FAIL with something like `AssertionError: expected ... to have been called with` because the implementation does not yet call `filterEligibleByDependencies`.

- [ ] **Step 6: Commit the failing tests**

  ```bash
  git add apps/server/src/shared/dispatch.test.ts
  git commit -m "test(dispatch): add failing tests for dep-blocked dispatch gate"
  ```

---

## Task 2: Wire filterEligibleByDependencies into dispatchFixIssue

**Files:**
- Modify: `apps/server/src/shared/dispatch.ts`

- [ ] **Step 1: Add the two new imports at the top of dispatch.ts**

  After the existing imports block (after line `import { getSourceForSlug } from './source.js';`), add:

  ```typescript
  import { filterEligibleByDependencies } from '@goose-hub/core/projects/dependency-scheduler.js';
  import { createProjectAwareTargetSource } from '@goose-hub/core/state-source/dependency-resolver.js';
  ```

- [ ] **Step 2: Insert dep check inside dispatchFixIssue's try block**

  Find the block in `dispatchFixIssue` that reads:
  ```typescript
  const item = await source.getItem(issueNumber.toString());

  const mockDeps: Record<string, unknown> | undefined =
  ```

  Add the dep-check block between `getItem` and `mockDeps`:

  ```typescript
  const item = await source.getItem(issueNumber.toString());

  // Dependency gate: skip dispatch if any dep is open or unregistered.
  // filterEligibleByDependencies applies schedule:blocked-by and needs-human
  // labels as side-effects, so we only need to check eligible.length here.
  const depProjectConfig = await getProject(slug);
  if (depProjectConfig != null) {
    const fetchTarget = await createProjectAwareTargetSource();
    const { eligible } = await filterEligibleByDependencies([item], {
      currentRepo: depProjectConfig.source.repo,
      fetchTarget,
      source,
    });
    if (eligible.length === 0) {
      logger.info('dispatchFixIssue: item blocked by deps, skipping', {
        slug,
        issueNumber,
      });
      return;
    }
  }

  const mockDeps: Record<string, unknown> | undefined =
  ```

- [ ] **Step 3: Run the new tests to confirm they PASS**

  ```bash
  cd /Users/shaunnesbitt/projects/goose-hub
  pnpm --filter @goose-hub/server test apps/server/src/shared/dispatch.test.ts 2>&1 | tail -20
  ```

  Expected: all tests in the file PASS, including both new ones.

- [ ] **Step 4: Run the full dep-scheduler unit tests to confirm nothing broken**

  ```bash
  pnpm --filter @goose-hub/core test core/projects/dependency-scheduler.test.ts 2>&1 | tail -10
  ```

  Expected: PASS (these tests were already green; this confirms the dep-scheduler module itself is untouched).

- [ ] **Step 5: Run typecheck**

  ```bash
  pnpm -r typecheck 2>&1 | grep -i "error\|ERR" | head -20
  ```

  Expected: no errors. If there are errors on the new imports, check the package exports in `core/package.json` — the paths `core/projects/dependency-scheduler.js` and `core/state-source/dependency-resolver.js` must be in the `exports` map.

- [ ] **Step 6: If typecheck fails on missing export paths, add them to core/package.json exports**

  Open `core/package.json` and find the `exports` field. Add:

  ```json
  "./projects/dependency-scheduler.js": "./src/projects/dependency-scheduler.ts",
  "./state-source/dependency-resolver.js": "./src/state-source/dependency-resolver.ts"
  ```

  Then re-run typecheck:
  ```bash
  pnpm -r typecheck 2>&1 | grep -i "error\|ERR" | head -20
  ```

- [ ] **Step 7: Run lint**

  ```bash
  pnpm -r lint 2>&1 | grep -i "error\|warn" | head -20
  ```

  Expected: clean.

- [ ] **Step 8: Run the full server test suite**

  ```bash
  pnpm --filter @goose-hub/server test 2>&1 | tail -20
  ```

  Expected: all PASS.

- [ ] **Step 9: Commit the implementation**

  ```bash
  git add apps/server/src/shared/dispatch.ts
  git commit -m "feat(dispatch): wire dep filter into dispatchFixIssue — blocks issues with open Depends-on refs"
  ```

---

## Self-Review

**Spec coverage check:**
- M11.03 AC: "Before dispatching a workflow, the scheduler calls `resolveDependency` on all deps" → covered by Task 2
- M11.03 AC: "Issues with at least one unsatisfied dep are skipped for dispatch in this tick" → covered (return early if `eligible.length === 0`)
- M11.03 AC: "Skipped issues receive `schedule:blocked-by` label" → handled inside `filterEligibleByDependencies` as a side-effect; no change needed here
- M11.03 AC: "Unregistered dep → not dispatched; escalated to `factory:needs-human`" → handled inside `filterEligibleByDependencies`; unregistered items end up in neither `eligible` nor `blocked` — they're in `unregistered`, so `eligible.length === 0` catches them correctly
- M11.03 AC: "Issues with zero deps, or all deps closed, are dispatched as normal" → Task 1 test 2 covers this

**Placeholder scan:** None found.

**Type consistency:** `depProjectConfig.source.repo` matches `SourceConfig.repo: string` from `core/types.ts`. `SchedulerContext` fields match `dependency-scheduler.ts` interface exactly. `createProjectAwareTargetSource` returns `Promise<FetchTargetFn>` which matches `ctx.fetchTarget` type.

**Out of scope:** `dispatchInvestigate` is not changed. Dep blocking only applies to the dev workflow dispatch (`factory:dev-ready`). If the same gate is needed for investigate, that's a separate issue.
