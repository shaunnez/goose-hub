# spec-author specMode Plumbing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bugs that cause spec-author to silently run full validation for T2 routes and to route localized T2 bugs through spec-author instead of fix-issue.

**Architecture:** Two independent fixes. Bug A: `dispatchFixIssue` resolves pipeline from stored route but never applies the bug-locality check that the no-route fallback already applies — add a single guard after pipeline resolution. Bug B: `specMode` exists in `ValidationOptions` and is already implemented in `validateEngineeringSpec`, but `SpecAuthorWorkflowDeps` has no `specMode` field and the workflow never passes it to the validator — thread it through from dispatch to workflow to call site.

**Tech Stack:** TypeScript, Vitest, pnpm workspace monorepo. All files in `slices/spec-author/` and `apps/server/src/shared/`.

---

## File Map

| File | Change |
|------|--------|
| `slices/spec-author/workflow.ts` | Add `specMode` to `SpecAuthorWorkflowDeps`; pass it to `validateEngineeringSpec` |
| `apps/server/src/shared/dispatch-dev.ts` | Add `specMode` param to `dispatchSpecAuthor`; add T2 bug downgrade in `dispatchFixIssue` |
| `slices/spec-author/slice.test.ts` | Tests: specMode threaded through workflow |
| `apps/server/src/shared/dispatch.test.ts` | Tests: T2 bug downgrade; specMode routing |

---

## Task 1: Thread specMode through the workflow

**Context:** `SpecAuthorWorkflowDeps` (line 34 of `slices/spec-author/workflow.ts`) has no `specMode` field. `validateEngineeringSpec` is called at line 756 without `specMode`, so it always defaults to `'full'` even when the route is T2/lite.

**Files:**
- Modify: `slices/spec-author/workflow.ts:34-39` (SpecAuthorWorkflowDeps)
- Modify: `slices/spec-author/workflow.ts:756-760` (validateEngineeringSpec call)

- [ ] **Step 1: Write the failing test**

Add to `slices/spec-author/slice.test.ts` in the existing validation describe block (after line 973):

```typescript
it('passes specMode from deps to validateEngineeringSpec', async () => {
  mockValidateEngineeringSpec.mockReturnValue({ ok: true });

  const { runSpecAuthorWorkflow } = await import('./workflow.js');
  await runSpecAuthorWorkflow(
    makeWorkItem(),
    makeMockSource(),
    'goose-hub-self',
    '/repo',
    { specMode: 'lite' },
  );

  expect(mockValidateEngineeringSpec).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ specMode: 'lite' }),
  );
});

it('defaults specMode to full when not in deps', async () => {
  mockValidateEngineeringSpec.mockReturnValue({ ok: true });

  const { runSpecAuthorWorkflow } = await import('./workflow.js');
  await runSpecAuthorWorkflow(makeWorkItem(), makeMockSource(), 'goose-hub-self', '/repo');

  expect(mockValidateEngineeringSpec).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ specMode: 'full' }),
  );
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/shaunnesbitt/projects/goose-hub
pnpm vitest run slices/spec-author/slice.test.ts 2>&1 | tail -20
```

Expected: both new tests FAIL — `specMode: 'lite'` not in the call args.

- [ ] **Step 3: Add specMode to SpecAuthorWorkflowDeps**

In `slices/spec-author/workflow.ts`, replace the `SpecAuthorWorkflowDeps` interface:

```typescript
export interface SpecAuthorWorkflowDeps {
  createWorktreeImpl?: typeof createWorktree;
  resolveWorkflowBaseImpl?: typeof resolveWorkflowBase;
  prdArtifactThresholdBytes?: number;
  createWpIssueProjections?: boolean;
  specMode?: 'lite' | 'full';
}
```

- [ ] **Step 4: Pass specMode to validateEngineeringSpec**

In `slices/spec-author/workflow.ts`, replace the `validateEngineeringSpec` call at line 756:

```typescript
      return {
        runId,
        spec: normalized.spec,
        validation: validateEngineeringSpec(normalized.spec, {
          issueType: workItem.type === 'bug' ? 'bug' : 'feature',
          repoRoot: worktreePath,
          specMode: deps.specMode ?? 'full',
        }),
      };
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
pnpm vitest run slices/spec-author/slice.test.ts 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 6: Typecheck**

```bash
pnpm tsc -p slices/spec-author/tsconfig.json --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add slices/spec-author/workflow.ts slices/spec-author/slice.test.ts
git commit -m "feat(spec-author): thread specMode from deps through to validateEngineeringSpec"
```

---

## Task 2: Thread specMode through dispatchSpecAuthor

**Context:** `dispatchSpecAuthor` calls `runSpecAuthorWorkflow` without any `specMode`. The naive fix would add `specMode` as a third arg, but `withParallelLock` stores `dispatchFn` typed as `(slug, issueNumber) => Promise<void>` — a queued dispatch drains with only two args, silently dropping any third. Instead, derive specMode inside `dispatchSpecAuthor` from `loadLatestRoute` (already imported in this file) after loading the item. `dispatchFixIssue` needs no change.

**Files:**
- Modify: `apps/server/src/shared/dispatch-dev.ts:411-451` (dispatchSpecAuthor internal specMode derivation)

- [ ] **Step 0: Add the spec-author workflow mock to dispatch.test.ts**

`dispatch.test.ts` does not yet mock the spec-author workflow. Add in three places:

**At the top with the other mock stubs (around line 12):**
```typescript
const mockRunSpecAuthorWorkflow = vi.fn();
```

**After the other `vi.mock(...)` calls for slices (around line 104):**
```typescript
vi.mock('../../../../slices/spec-author/workflow.js', () => ({
  runSpecAuthorWorkflow: mockRunSpecAuthorWorkflow,
}));
```

**In the `beforeEach` block, with the other `.mockResolvedValue(undefined)` defaults (around line 190):**
```typescript
mockRunSpecAuthorWorkflow.mockResolvedValue(undefined);
```

- [ ] **Step 1: Write the failing test**

Find the dispatch.test.ts section for `dispatchFixIssue` (around line 1139). Add a new test after the existing T2 tests:

```typescript
it('passes specMode lite to runSpecAuthorWorkflow when pipeline is spec-author-lite', async () => {
  const item = {
    id: 'github:shaunnez/goose-hub#700',
    externalId: '700',
    repoRef: 'shaunnez/goose-hub',
    title: 'T2 feature needs spec',
    body: 'body',
    state: 'factory:dev-ready',
    priority: 'medium',
    type: 'feature',
    schedule: 'current',
  };
  const source = {
    repoRef: 'shaunnez/goose-hub',
    getItem: vi.fn().mockResolvedValue(item),
    transitionState: vi.fn().mockResolvedValue(undefined),
    comment: vi.fn().mockResolvedValue(undefined),
  };
  mockGetSourceForSlug.mockResolvedValue(source);
  mockGetProject.mockResolvedValue({ id: 'project-config-id', budgets: { maxParallelAgents: 1 } });
  mockGetUseMultiAgentPipeline.mockReturnValue(true);
  mockFilterEligibleByDependencies.mockResolvedValue({ eligible: [item], blocked: [], unregistered: [] });
  mockLoadLatestRoute.mockReturnValue({
    tier: 'T2',
    selectedStages: ['triage', 'investigate', 'spec-author', 'implement', 'qa', 'review', 'retro'],
    budgetCaps: { maxUsd: 2, maxScouts: 3, allowWave2: false, reviewerSlots: 1 },
    evidence: { reasons: [], signals: {} },
    escalationTriggers: [],
    requiresHumanApproval: false,
    source: 'investigation',
    rootCauseSignature: 'route|github:shaunnez/goose-hub#700|workflow-routing',
  });
  mockSelectFixIssuePipeline.mockReturnValue('spec-author-lite');

  const { dispatchFixIssue } = await import('./dispatch.js');
  await dispatchFixIssue('goose-hub-self', 700);

  expect(mockRunSpecAuthorWorkflow).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    'goose-hub-self',
    expect.any(String),
    expect.objectContaining({ specMode: 'lite' }),
  );
});
```

> This mock was added in Task 2 Step 0. Confirm it is present before running.

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm vitest run apps/server/src/shared/dispatch.test.ts -t "passes specMode lite" 2>&1 | tail -20
```

Expected: FAIL — specMode not in call args.

- [ ] **Step 3: Derive specMode inside dispatchSpecAuthor from the stored route**

`withParallelLock` queues `dispatchFn` as `(slug, issueNumber) => Promise<void>` — any extra arg would be silently dropped on drain. Derive specMode from the route inside the function instead.

In `apps/server/src/shared/dispatch-dev.ts`, update `dispatchSpecAuthor` to derive specMode after loading the item. No change to the function signature. The call site in `dispatchFixIssue` is unchanged.

```typescript
export async function dispatchSpecAuthor(slug: string, issueNumber: number): Promise<void> {
  await withParallelLock(slug, issueNumber, 'dispatchSpecAuthor', dispatchSpecAuthor, async () => {
    // Cross-package boundary: slices/ is not a workspace package (rule 28a).
    const { runSpecAuthorWorkflow } = (await import(sliceUrl('spec-author'))) as {
      runSpecAuthorWorkflow: (
        item: unknown,
        source: unknown,
        slug: string,
        repoRoot: string,
        deps?: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    const source = await getSourceForSlug(slug);
    if (source == null) {
      logger.error('dispatchSpecAuthor: no source for slug', { slug });
      return;
    }
    const item = await source.getItem(issueNumber.toString());

    const depProjectConfig = await getProject(slug);
    if (depProjectConfig != null) {
      const fetchTarget = await createProjectAwareTargetSource();
      const { eligible } = await filterEligibleByDependencies([item], {
        currentRepo: primaryRepoRef(depProjectConfig),
        fetchTarget,
        source,
      });
      if (eligible.length === 0) {
        logger.info('dispatchSpecAuthor: item blocked by deps, skipping', { slug, issueNumber });
        return;
      }
    }

    // Derive specMode from stored route — safe to re-read here because withParallelLock
    // drops any extra args on the queued-drain path.
    const routeForSpec = loadLatestRoute({ projectId: slug, workItemId: (item as { id: string }).id });
    const specMode: 'lite' | 'full' =
      routeForSpec != null && selectFixIssuePipeline(routeForSpec) === 'spec-author-lite'
        ? 'lite'
        : 'full';

    const mockDeps: Record<string, unknown> | undefined =
      process.env.MOCK_AGENTS === 'true'
        ? { createWorktreeImpl: () => '/mock/worktree' }
        : undefined;

    await runSpecAuthorWorkflow(item, source, slug, REPO_ROOT, { ...mockDeps, specMode });
  });
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
pnpm vitest run apps/server/src/shared/dispatch.test.ts -t "passes specMode lite" 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
pnpm tsc -p apps/server/tsconfig.json --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/shared/dispatch-dev.ts apps/server/src/shared/dispatch.test.ts
git commit -m "feat(dispatch): derive specMode from stored route inside dispatchSpecAuthor"
```

---

## Task 3: Downgrade T2 bugs with high-confidence investigation to fix-issue

**Context:** When a stored route decision is T2, `dispatchFixIssue` calls `selectFixIssuePipeline` which returns `spec-author-lite`. But the no-route fallback (line 486-489) already applies `resolveFixIssuePipelineForBug` to redirect localized bugs (≤3 non-test key files, `confidence: 'high'`, single/small-swarm plan) to fix-issue. The stored-route path skips this check. This caused issue #3 to run spec-author for a single-file bug.

**Architectural note:** This downgrade is a dispatch-time override — it does not fix the upstream routing decision that selected T2. The routing workflow may have received contextual files (e.g. AppShell.tsx alongside the real edit file) and counted them as complexity, inflating the tier. A durable fix would improve the route signal used by the routing workflow. This plan addresses the immediate symptom: localized bugs that pass the `resolveFixIssuePipelineForBug` check are always redirected to fix-issue regardless of stored tier.

**Files:**
- Modify: `apps/server/src/shared/dispatch-dev.ts:482-502` (pipeline resolution in dispatchFixIssue)

- [ ] **Step 1: Write the failing test**

Find or add a describe block for T2 bug downgrade in `apps/server/src/shared/dispatch.test.ts`. You'll need to set up an `agent.investigation-complete` event in `eventStore` with a high-confidence, low-keyfile payload. Look at how `mockEventStore.replay` is set up in existing tests for the pattern.

Add this test:

```typescript
it('downgrades T2 bug with high-confidence localized investigation to fix-issue', async () => {
  const item = {
    id: 'github:shaunnez/goose-hub#701',
    externalId: '701',
    repoRef: 'shaunnez/goose-hub',
    title: 'localized bug',
    body: 'body',
    state: 'factory:dev-ready',
    priority: 'medium',
    type: 'bug',
    schedule: 'current',
  };
  const source = {
    repoRef: 'shaunnez/goose-hub',
    getItem: vi.fn().mockResolvedValue(item),
    transitionState: vi.fn().mockResolvedValue(undefined),
    comment: vi.fn().mockResolvedValue(undefined),
  };
  mockGetSourceForSlug.mockResolvedValue(source);
  mockGetProject.mockResolvedValue({ id: 'project-config-id', budgets: { maxParallelAgents: 1 } });
  mockGetUseMultiAgentPipeline.mockReturnValue(true);
  mockFilterEligibleByDependencies.mockResolvedValue({ eligible: [item], blocked: [], unregistered: [] });
  mockLoadLatestRoute.mockReturnValue({
    tier: 'T2',
    selectedStages: ['triage', 'investigate', 'spec-author', 'implement', 'qa', 'review', 'retro'],
    budgetCaps: { maxUsd: 2, maxScouts: 3, allowWave2: false, reviewerSlots: 1 },
    evidence: { reasons: [], signals: {} },
    escalationTriggers: [],
    requiresHumanApproval: false,
    source: 'investigation',
    rootCauseSignature: 'route|github:shaunnez/goose-hub#701|workflow-routing',
  });
  mockSelectFixIssuePipeline.mockReturnValue('spec-author-lite');
  // Two non-test production files — matches the real issue #3 shape where the real edit
  // file plus a contextual file (e.g. AppShell.tsx) were both counted as complexity.
  // resolveFixIssuePipelineForBug filters out *.test.ts, so a test file would not
  // reproduce the actual regression.
  mockEventStoreReplay.mockImplementation(({ kind }: { kind: string }) => {
    if (kind === 'agent.investigation-complete') {
      return [{
        payload: {
          investigationRunId: 'inv-run-1',
          investigate: {
            confidence: 'high',
            keyFiles: [
              { path: 'slices/qa/workflow.ts' },
              { path: 'apps/web/src/components/AppShell.tsx' },
            ],
          },
          investigationPlan: { mode: 'single', wave2Needed: false },
        },
      }];
    }
    return [];
  });

  const { dispatchFixIssue } = await import('./dispatch.js');
  await dispatchFixIssue('goose-hub-self', 701);

  // Should have used fix-issue, not spec-author
  expect(mockRunFixIssueWorkflow).toHaveBeenCalled();
  expect(mockRunSpecAuthorWorkflow).not.toHaveBeenCalled();
});

it('does NOT downgrade T2 feature to fix-issue', async () => {
  const item = {
    id: 'github:shaunnez/goose-hub#702',
    externalId: '702',
    repoRef: 'shaunnez/goose-hub',
    title: 'T2 feature',
    body: 'body',
    state: 'factory:dev-ready',
    priority: 'medium',
    type: 'feature',
    schedule: 'current',
  };
  const source = {
    repoRef: 'shaunnez/goose-hub',
    getItem: vi.fn().mockResolvedValue(item),
    transitionState: vi.fn().mockResolvedValue(undefined),
    comment: vi.fn().mockResolvedValue(undefined),
  };
  mockGetSourceForSlug.mockResolvedValue(source);
  mockGetProject.mockResolvedValue({ id: 'project-config-id', budgets: { maxParallelAgents: 1 } });
  mockGetUseMultiAgentPipeline.mockReturnValue(true);
  mockFilterEligibleByDependencies.mockResolvedValue({ eligible: [item], blocked: [], unregistered: [] });
  mockLoadLatestRoute.mockReturnValue({
    tier: 'T2',
    selectedStages: ['triage', 'investigate', 'spec-author', 'implement', 'qa', 'review', 'retro'],
    budgetCaps: { maxUsd: 2, maxScouts: 3, allowWave2: false, reviewerSlots: 1 },
    evidence: { reasons: [], signals: {} },
    escalationTriggers: [],
    requiresHumanApproval: false,
    source: 'investigation',
    rootCauseSignature: 'route|github:shaunnez/goose-hub#702|workflow-routing',
  });
  mockSelectFixIssuePipeline.mockReturnValue('spec-author-lite');

  const { dispatchFixIssue } = await import('./dispatch.js');
  await dispatchFixIssue('goose-hub-self', 702);

  // Feature at T2 stays in spec-author
  expect(mockRunSpecAuthorWorkflow).toHaveBeenCalled();
  expect(mockRunFixIssueWorkflow).not.toHaveBeenCalled();
});

it('does NOT downgrade T3 bug to fix-issue', async () => {
  const item = {
    id: 'github:shaunnez/goose-hub#703',
    externalId: '703',
    repoRef: 'shaunnez/goose-hub',
    title: 'complex bug',
    body: 'body',
    state: 'factory:dev-ready',
    priority: 'high',
    type: 'bug',
    schedule: 'current',
  };
  const source = {
    repoRef: 'shaunnez/goose-hub',
    getItem: vi.fn().mockResolvedValue(item),
    transitionState: vi.fn().mockResolvedValue(undefined),
    comment: vi.fn().mockResolvedValue(undefined),
  };
  mockGetSourceForSlug.mockResolvedValue(source);
  mockGetProject.mockResolvedValue({ id: 'project-config-id', budgets: { maxParallelAgents: 1 } });
  mockGetUseMultiAgentPipeline.mockReturnValue(true);
  mockFilterEligibleByDependencies.mockResolvedValue({ eligible: [item], blocked: [], unregistered: [] });
  mockLoadLatestRoute.mockReturnValue({
    tier: 'T3',
    selectedStages: ['triage', 'investigate', 'spec-author', 'implement', 'qa', 'review', 'retro'],
    budgetCaps: { maxUsd: 5, maxScouts: 6, allowWave2: true, reviewerSlots: 2 },
    evidence: { reasons: [], signals: {} },
    escalationTriggers: [],
    requiresHumanApproval: false,
    source: 'investigation',
    rootCauseSignature: 'route|github:shaunnez/goose-hub#703|workflow-routing',
  });
  mockSelectFixIssuePipeline.mockReturnValue('spec-author-full');

  const { dispatchFixIssue } = await import('./dispatch.js');
  await dispatchFixIssue('goose-hub-self', 703);

  expect(mockRunSpecAuthorWorkflow).toHaveBeenCalled();
  expect(mockRunFixIssueWorkflow).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm vitest run apps/server/src/shared/dispatch.test.ts -t "downgrade T2 bug" 2>&1 | tail -30
```

Expected: T2-bug-downgrade test FAILS; T2-feature and T3-bug tests may pass already (no code change yet).

- [ ] **Step 3: Add the downgrade guard in dispatchFixIssue**

In `apps/server/src/shared/dispatch-dev.ts`, in `dispatchFixIssue`, replace the pipeline resolution block (lines ~482-502). The current code is:

```typescript
      const routeDecision = loadLatestRoute({ projectId: slug, workItemId: routingItem.id });
      const pipeline =
        routeDecision != null
          ? selectFixIssuePipeline(routeDecision)
          : routingItem.type === 'bug' &&
              resolveFixIssuePipelineForBug(slug, routingItem.id) === 'legacy'
            ? 'fix-issue'
            : 'spec-author-full';
```

Replace with:

```typescript
      const routeDecision = loadLatestRoute({ projectId: slug, workItemId: routingItem.id });
      let pipeline: FixIssuePipeline =
        routeDecision != null
          ? selectFixIssuePipeline(routeDecision)
          : routingItem.type === 'bug' &&
              resolveFixIssuePipelineForBug(slug, routingItem.id) === 'legacy'
            ? 'fix-issue'
            : 'spec-author-full';

      // T2 routes bugs to spec-author-lite, but a high-confidence localized bug
      // should go straight to fix-issue — same check the no-route fallback applies.
      if (
        pipeline === 'spec-author-lite' &&
        routingItem.type === 'bug' &&
        resolveFixIssuePipelineForBug(slug, routingItem.id) === 'legacy'
      ) {
        pipeline = 'fix-issue';
      }
```

> **Note:** You'll also need to import `FixIssuePipeline` from `@goose-hub/core/workflow-routing/pipeline-selector.js` if it's not already imported. Check line 17 of dispatch-dev.ts — `selectFixIssuePipeline` is already imported from there; add `type FixIssuePipeline` to that import.

- [ ] **Step 4: Run all three tests**

```bash
pnpm vitest run apps/server/src/shared/dispatch.test.ts -t "downgrade T2 bug|does NOT downgrade T2 feature|does NOT downgrade T3" 2>&1 | tail -30
```

Expected: all three PASS.

- [ ] **Step 5: Run full dispatch test suite**

```bash
pnpm vitest run apps/server/src/shared/dispatch.test.ts 2>&1 | tail -20
```

Expected: all tests PASS. No regressions.

- [ ] **Step 6: Typecheck**

```bash
pnpm tsc -p apps/server/tsconfig.json --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/shared/dispatch-dev.ts apps/server/src/shared/dispatch.test.ts
git commit -m "fix(dispatch): downgrade T2 bug with high-confidence localized investigation to fix-issue"
```

---

## Task 4: Final verification

- [ ] **Step 1: Run all affected test suites**

```bash
pnpm vitest run slices/spec-author/slice.test.ts apps/server/src/shared/dispatch.test.ts 2>&1 | tail -20
```

Expected: all PASS.

- [ ] **Step 2: Full typecheck for both apps**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Build**

```bash
pnpm build 2>&1 | tail -20
```

Expected: clean build.
