# Retrospective Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two confirmed bugs in the retrospective workflow — the agent receives no prior decision summaries to analyze, and the decision summaries it produces are never emitted as events — then wire the remaining deep-trigger conditions so the right tier fires automatically.

**Architecture:** Three changes to two files. `core/workflows/retrospective.ts` gets (1) a pre-run fetch of `agent.decision-summary` events for the work item, injected into `runSummary.decisionSummaries` context, and (2) a post-run emit loop that reads `parsed.data.decisionSummaries` (not the always-empty `result.decisionSummaries`). `apps/server/src/domains/workflows/retro-batch.ts` gets an expanded `computeTriggers` that detects `retries-ge-2`, `budget-exceeded`, `priority-high`, `priority-critical`, `needs-human`, and `first-run-in-milestone` from the event store and work item metadata.

**Tech Stack:** TypeScript, Vitest, Drizzle/SQLite event store (`eventStore.replay`), Zod schemas in `core/retrospective/schemas.ts` and `skills/retrospective-{light,deep}/schema.ts`

---

## Background: how decision summaries flow

Every skill (triage, implement, qa, etc.) includes `decisionSummaries` in its Zod output schema. The calling workflow reads `parsed.data.decisionSummaries` and emits each as an `agent.decision-summary` event in the event store.

The retrospective skill is supposed to **receive** those prior events as context (so the agent can reflect on what happened) and then **produce** its own `decisionSummaries` in its output. Both halves are broken:

- **Input bug** (`retrospective.ts:97`): `runSummary.decisionSummaries` is hardcoded `[]` — the workflow never fetches prior events.
- **Output bug** (`retrospective.ts:125`): the loop iterates `result.decisionSummaries`, which `claude-cli.ts` hardcodes as `[]`. The actual summaries are in `parsed.data.decisionSummaries`.

---

## Files

| File | Change |
|------|--------|
| `core/workflows/retrospective.ts` | Bug A fix (fetch prior events into context) + Bug B fix (emit output decision summaries) |
| `core/workflows/slice.test.ts` | Tests for Bug A and Bug B fixes |
| `apps/server/src/domains/workflows/retro-batch.ts` | Wire remaining deep triggers in `computeTriggers` |
| `apps/server/src/domains/workflows/retro-batch.test.ts` | Tests for new trigger conditions |

No new files. No schema changes. `TriggerContext` already has all the fields needed; `retro-batch.ts` just isn't populating them.

---

## Task 1: Fix Bug A — fetch prior decision summaries into retro context

**Files:**
- Modify: `core/workflows/retrospective.ts`

The `runRetrospectiveWorkflow` function currently passes `decisionSummaries: []` to the agent. Fix: fetch all `agent.decision-summary` events for the work item from the event store and inject them.

- [ ] **Step 1: Write the failing test**

In `core/workflows/slice.test.ts`, add inside `describe('tier selection')` (or a new describe block):

```typescript
it('passes prior decision summaries from event store to run context', async () => {
  const { runRetrospectiveWorkflow } = await import('./retrospective.js');
  const { eventStore } = await import('../event-stream/store.js');

  vi.mocked(eventStore.replay).mockReturnValue([
    {
      id: 1,
      projectId: 'test-project',
      workItemId: 'github:owner/repo#42',
      kind: 'agent.decision-summary',
      payload: { skill: 'implement', kind: 'PLAN', summary: 'Added widget', evidence: 'tests' },
      runId: 'run-1',
      personaId: null,
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 2,
      projectId: 'test-project',
      workItemId: 'github:owner/repo#42',
      kind: 'agent.run-started',           // non-decision event — must be filtered out
      payload: { skill: 'implement' },
      runId: 'run-1',
      personaId: null,
      createdAt: '2026-01-01T00:00:00Z',
    },
  ]);
  mockRun.mockResolvedValueOnce(makeLightResult());

  await runRetrospectiveWorkflow({
    workItem: makeWorkItem(),
    stateSource: makeSource(),
    projectId: 'test-project',
    policy: 'always-light',
  });

  const runSpec = mockRun.mock.calls[0][0] as {
    context: { runSummary: { decisionSummaries: unknown[] } };
  };
  expect(runSpec.context.runSummary.decisionSummaries).toHaveLength(1);
  expect(runSpec.context.runSummary.decisionSummaries[0]).toMatchObject({
    kind: 'PLAN',
    summary: 'Added widget',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/shaunnesbitt/projects/goose-hub
pnpm --filter @goose-hub/core vitest run core/workflows/slice.test.ts
```

Expected: FAIL — `decisionSummaries` has length 0.

- [ ] **Step 3: Implement the fix in `core/workflows/retrospective.ts`**

Find the section that builds the `context` object passed to `runtime.run` (around line 85). Replace the hardcoded `decisionSummaries: []` with a lookup:

```typescript
// Before the runtime.run call, fetch prior decision summaries for this work item:
const priorDecisionEvents = eventStore
  .replay({ projectId, workItemId: workItem.id })
  .filter((e) => e.kind === 'agent.decision-summary');

const priorDecisionSummaries = priorDecisionEvents.map((e) => {
  const p = e.payload as { kind?: string; summary?: string; evidence?: string };
  return { kind: p.kind ?? 'VERDICT', summary: p.summary ?? '', evidence: p.evidence };
});
```

Then in the `runtime.run` call, replace:

```typescript
runSummary: { personaId, role: 'retrospector', outcome: 'success', decisionSummaries: [] },
```

with:

```typescript
runSummary: {
  personaId,
  role: 'retrospector',
  outcome: 'success',
  decisionSummaries: priorDecisionSummaries,
},
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @goose-hub/core vitest run core/workflows/slice.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add core/workflows/retrospective.ts core/workflows/slice.test.ts
git commit -m "fix(retro): pass prior decision summaries from event store into retro context"
```

---

## Task 2: Fix Bug B — emit retro output decision summaries as events

**Files:**
- Modify: `core/workflows/retrospective.ts`
- Modify: `core/workflows/slice.test.ts`

The loop at `retrospective.ts:125` iterates `result.decisionSummaries` (always `[]`). Fix: read from `parsed.data.decisionSummaries` instead.

- [ ] **Step 1: Write the failing test**

Add to `core/workflows/slice.test.ts`:

```typescript
it('emits agent.decision-summary events from the retro output', async () => {
  const { runRetrospectiveWorkflow } = await import('./retrospective.js');
  const { eventStore } = await import('../event-stream/store.js');

  const resultWithSummaries = {
    output: {
      summary: '- All good.\n- No issues.\n- Keep it up.',
      improvementCandidates: [],
      decisionSummaries: [
        { kind: 'VERDICT', summary: 'Clean run — no friction detected' },
      ],
    },
    decisionSummaries: [], // runtime always returns [] — this is the bug we're fixing
    events: [],
  };
  mockRun.mockResolvedValueOnce(resultWithSummaries);

  await runRetrospectiveWorkflow({
    workItem: makeWorkItem(),
    stateSource: makeSource(),
    projectId: 'test-project',
    policy: 'always-light',
  });

  const summaryEvents = vi
    .mocked(eventStore.appendEvent)
    .mock.calls.filter(([e]) => e.kind === 'agent.decision-summary');

  expect(summaryEvents).toHaveLength(1);
  const payload = summaryEvents[0][0].payload as { kind: string; summary: string };
  expect(payload.kind).toBe('VERDICT');
  expect(payload.summary).toBe('Clean run — no friction detected');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @goose-hub/core vitest run core/workflows/slice.test.ts
```

Expected: FAIL — `summaryEvents` has length 0.

- [ ] **Step 3: Fix the emit loop in `core/workflows/retrospective.ts`**

The current code (around line 125):

```typescript
for (const ds of result.decisionSummaries) {
  eventStore.appendEvent({
    kind: 'agent.decision-summary',
    projectId,
    workItemId: workItem.id,
    runId,
    payload: { skill: skillName, ...ds },
  });
}
```

Replace with a read from the parsed output. Move this block to be **inside** the `if (parsed.success)` branch, after the `persistCandidates` call:

```typescript
if (parsed.success) {
  if (parsed.data.improvementCandidates.length > 0) {
    persistCandidates(projectId, personaId, workItem.id, parsed.data.improvementCandidates);
  }
  for (const ds of parsed.data.decisionSummaries) {
    eventStore.appendEvent({
      kind: 'agent.decision-summary',
      projectId,
      workItemId: workItem.id,
      runId,
      payload: { skill: skillName, ...ds },
    });
  }
}
```

Remove the old `for (const ds of result.decisionSummaries)` loop entirely.

- [ ] **Step 4: Run all retro workflow tests**

```bash
pnpm --filter @goose-hub/core vitest run core/workflows/slice.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add core/workflows/retrospective.ts core/workflows/slice.test.ts
git commit -m "fix(retro): emit decision summaries from parsed output, not result stub"
```

---

## Task 3: Wire remaining deep triggers in `retro-batch.ts`

**Files:**
- Modify: `apps/server/src/domains/workflows/retro-batch.ts`
- Modify: `apps/server/src/domains/workflows/retro-batch.test.ts`

`TriggerContext` already has the right fields. `computeTriggers` only populates `qaFailed`. Wire the remaining four:

| Trigger field | Detection logic |
|---|---|
| `qaFailed` | already wired |
| `humanRequested` | any `gate.awaiting-human` event for this work item |
| `firstRunInMilestone` | no prior `retrospective.completed` events exist for this project in the current milestone |
| `retriesGe2` | two or more `agent.retry-escalated` events for this work item |
| `budgetExceeded` | any `project.budget-exceeded` event for this project |

Note: `qualityScoreDeclining` is not wired here — it requires persona stats queries and remains deferred. `priority-high` / `priority-critical` are read from `workItem.priority` directly (the `WorkItem` interface has a `priority` field typed `'critical' | 'high' | 'medium' | 'low'`).

`TriggerContext` does not currently have `priorityHigh`, `priorityCritical`, `retriesGe2`, or `budgetExceeded`. These must be added first in `core/workflows/retrospective.ts` and `selectTier` must check them.

### Step 3a: Extend TriggerContext and selectTier

- [ ] **Step 1: Write the failing tests for new trigger fields**

Add to `core/workflows/slice.test.ts`:

```typescript
it('auto + retriesGe2 → retrospective-deep', async () => {
  const { runRetrospectiveWorkflow } = await import('./retrospective.js');
  mockRun.mockResolvedValueOnce(makeDeepResult());

  await runRetrospectiveWorkflow({
    workItem: makeWorkItem(),
    stateSource: makeSource(),
    projectId: 'test-project',
    policy: 'auto',
    triggers: { retriesGe2: true },
  });

  const spec = mockRun.mock.calls[0][0] as { skill: string };
  expect(spec.skill).toBe('retrospective-deep');
});

it('auto + budgetExceeded → retrospective-deep', async () => {
  const { runRetrospectiveWorkflow } = await import('./retrospective.js');
  mockRun.mockResolvedValueOnce(makeDeepResult());

  await runRetrospectiveWorkflow({
    workItem: makeWorkItem(),
    stateSource: makeSource(),
    projectId: 'test-project',
    policy: 'auto',
    triggers: { budgetExceeded: true },
  });

  const spec = mockRun.mock.calls[0][0] as { skill: string };
  expect(spec.skill).toBe('retrospective-deep');
});

it('auto + priorityHigh → retrospective-deep', async () => {
  const { runRetrospectiveWorkflow } = await import('./retrospective.js');
  mockRun.mockResolvedValueOnce(makeDeepResult());

  await runRetrospectiveWorkflow({
    workItem: makeWorkItem(),
    stateSource: makeSource(),
    projectId: 'test-project',
    policy: 'auto',
    triggers: { priorityHigh: true },
  });

  const spec = mockRun.mock.calls[0][0] as { skill: string };
  expect(spec.skill).toBe('retrospective-deep');
});

it('auto + humanRequested → retrospective-deep', async () => {
  const { runRetrospectiveWorkflow } = await import('./retrospective.js');
  mockRun.mockResolvedValueOnce(makeDeepResult());

  await runRetrospectiveWorkflow({
    workItem: makeWorkItem(),
    stateSource: makeSource(),
    projectId: 'test-project',
    policy: 'auto',
    triggers: { humanRequested: true },
  });

  // humanRequested was already in selectTier, this just verifies it still works
  const spec = mockRun.mock.calls[0][0] as { skill: string };
  expect(spec.skill).toBe('retrospective-deep');
});
```

- [ ] **Step 2: Run tests to verify new ones fail**

```bash
pnpm --filter @goose-hub/core vitest run core/workflows/slice.test.ts
```

Expected: `retriesGe2` and `budgetExceeded` and `priorityHigh` tests FAIL (fields don't exist on TriggerContext).

- [ ] **Step 3: Extend TriggerContext and selectTier in `core/workflows/retrospective.ts`**

```typescript
export interface TriggerContext {
  firstRunInMilestone?: boolean;
  qaFailed?: boolean;
  qualityScoreDeclining?: boolean;
  humanRequested?: boolean;
  retriesGe2?: boolean;
  budgetExceeded?: boolean;
  priorityHigh?: boolean;
}

function selectTier(policy: RetrospectivePolicy, triggers: TriggerContext): 'light' | 'deep' {
  if (policy === 'always-light') return 'light';
  if (policy === 'always-deep') return 'deep';
  if (
    triggers.firstRunInMilestone ||
    triggers.qaFailed ||
    triggers.qualityScoreDeclining ||
    triggers.humanRequested ||
    triggers.retriesGe2 ||
    triggers.budgetExceeded ||
    triggers.priorityHigh
  ) {
    return 'deep';
  }
  return 'light';
}
```

- [ ] **Step 4: Run all retrospective workflow tests**

```bash
pnpm --filter @goose-hub/core vitest run core/workflows/slice.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add core/workflows/retrospective.ts core/workflows/slice.test.ts
git commit -m "feat(retro): extend TriggerContext with retriesGe2, budgetExceeded, priorityHigh"
```

### Step 3b: Wire detection in retro-batch.ts

- [ ] **Step 6: Write failing tests for computeTriggers**

In `apps/server/src/domains/workflows/retro-batch.test.ts`, add tests for the new trigger detections. Find the existing `computeTriggers` test block (or add a new `describe('computeTriggers')`) and add:

```typescript
it('sets retriesGe2=true when 2+ agent.retry-escalated events exist for the work item', async () => {
  const { runRetroBatch } = await import('./retro-batch.js');
  const cfg = makeConfig();
  mockGetProject.mockResolvedValue(cfg);

  // Two retry events for work item 42
  mockReplay.mockReturnValue([
    makeEvent('agent.retry-escalated', { attempt: 1 }),
    makeEvent('agent.retry-escalated', { attempt: 2 }),
  ]);

  const deepRuntime = makeMockRuntime({ kind: 'deep' });
  const source = makeSource([makeWorkItem()]);
  mockGetSourceForSlug.mockResolvedValue(source);

  await runRetroBatch('goose-hub-self', source);

  const spec = deepRuntime.run.mock.calls[0][0] as { skill: string };
  expect(spec.skill).toBe('retrospective-deep');
});

it('sets budgetExceeded=true when project.budget-exceeded event exists', async () => {
  const { runRetroBatch } = await import('./retro-batch.js');
  const cfg = makeConfig();
  mockGetProject.mockResolvedValue(cfg);

  mockReplay.mockReturnValue([
    makeEvent('project.budget-exceeded', { dailyTokens: 5000001 }),
  ]);

  const deepRuntime = makeMockRuntime({ kind: 'deep' });
  const source = makeSource([makeWorkItem()]);
  mockGetSourceForSlug.mockResolvedValue(source);

  await runRetroBatch('goose-hub-self', source);

  const spec = deepRuntime.run.mock.calls[0][0] as { skill: string };
  expect(spec.skill).toBe('retrospective-deep');
});

it('sets priorityHigh=true for high-priority work items', async () => {
  const { runRetroBatch } = await import('./retro-batch.js');
  const cfg = makeConfig();
  mockGetProject.mockResolvedValue(cfg);
  mockReplay.mockReturnValue([]);

  const deepRuntime = makeMockRuntime({ kind: 'deep' });
  const source = makeSource([makeWorkItem({ priority: 'high' })]);
  mockGetSourceForSlug.mockResolvedValue(source);

  await runRetroBatch('goose-hub-self', source);

  const spec = deepRuntime.run.mock.calls[0][0] as { skill: string };
  expect(spec.skill).toBe('retrospective-deep');
});

it('sets priorityHigh=true for critical-priority work items', async () => {
  const { runRetroBatch } = await import('./retro-batch.js');
  const cfg = makeConfig();
  mockGetProject.mockResolvedValue(cfg);
  mockReplay.mockReturnValue([]);

  const deepRuntime = makeMockRuntime({ kind: 'deep' });
  const source = makeSource([makeWorkItem({ priority: 'critical' })]);
  mockGetSourceForSlug.mockResolvedValue(source);

  await runRetroBatch('goose-hub-self', source);

  const spec = deepRuntime.run.mock.calls[0][0] as { skill: string };
  expect(spec.skill).toBe('retrospective-deep');
});

it('sets humanRequested=true when gate.awaiting-human event exists', async () => {
  const { runRetroBatch } = await import('./retro-batch.js');
  const cfg = makeConfig();
  mockGetProject.mockResolvedValue(cfg);

  mockReplay.mockReturnValue([
    makeEvent('gate.awaiting-human', { reason: 'manual review requested' }),
  ]);

  const deepRuntime = makeMockRuntime({ kind: 'deep' });
  const source = makeSource([makeWorkItem()]);
  mockGetSourceForSlug.mockResolvedValue(source);

  await runRetroBatch('goose-hub-self', source);

  const spec = deepRuntime.run.mock.calls[0][0] as { skill: string };
  expect(spec.skill).toBe('retrospective-deep');
});

it('sets firstRunInMilestone=true when no prior retrospective.completed events for this project', async () => {
  const { runRetroBatch } = await import('./retro-batch.js');
  const cfg = makeConfig();
  mockGetProject.mockResolvedValue(cfg);

  // No prior retrospective.completed events in replay
  mockReplay.mockReturnValue([]);

  // But mock a project-scoped replay (no workItemId filter) that also returns nothing
  // (the firstRunInMilestone check replays without workItemId to check project-wide)

  const deepRuntime = makeMockRuntime({ kind: 'deep' });
  const source = makeSource([makeWorkItem()]);
  mockGetSourceForSlug.mockResolvedValue(source);

  await runRetroBatch('goose-hub-self', source);

  const spec = deepRuntime.run.mock.calls[0][0] as { skill: string };
  expect(spec.skill).toBe('retrospective-deep');
});
```

Note: you'll need to check the existing test file for what `makeEvent`, `makeConfig`, `makeSource`, `makeWorkItem`, `makeMockRuntime` helpers look like and replicate the pattern. If these helpers don't exist yet, create them inline matching the existing test fixtures in the file.

- [ ] **Step 7: Run tests to verify new ones fail**

```bash
pnpm --filter @goose-hub/server vitest run src/domains/workflows/retro-batch.test.ts
```

Expected: new trigger tests FAIL.

- [ ] **Step 8: Implement expanded `computeTriggers` in `retro-batch.ts`**

Replace the current `computeTriggers` function:

```typescript
function computeTriggers(slug: string, workItem: WorkItem): TriggerContext {
  const events = eventStore.replay({ projectId: slug, workItemId: workItem.id });

  const qaFailed = events.some(
    (e) =>
      e.kind === 'qa.completed' &&
      (e.payload as { verdict?: string } | null)?.verdict === 'fail',
  );

  const humanRequested = events.some((e) => e.kind === 'gate.awaiting-human');

  const retriesGe2 =
    events.filter((e) => e.kind === 'agent.retry-escalated').length >= 2;

  const budgetExceeded = eventStore
    .replay({ projectId: slug })
    .some((e) => e.kind === 'project.budget-exceeded');

  const priorityHigh =
    workItem.priority === 'high' || workItem.priority === 'critical';

  // firstRunInMilestone: true if no prior retrospective.completed events exist for
  // this project (regardless of work item) — meaning this is the first retro this project
  // has ever run. Gives a deep retro on the very first run for calibration.
  const priorRetros = eventStore
    .replay({ projectId: slug })
    .filter((e) => e.kind === 'retrospective.completed');
  const firstRunInMilestone = priorRetros.length === 0;

  return { qaFailed, humanRequested, retriesGe2, budgetExceeded, priorityHigh, firstRunInMilestone };
}
```

- [ ] **Step 9: Run all retro-batch tests**

```bash
pnpm --filter @goose-hub/server vitest run src/domains/workflows/retro-batch.test.ts
```

Expected: all tests PASS.

- [ ] **Step 10: Run full test suite**

```bash
cd /Users/shaunnesbitt/projects/goose-hub
pnpm typecheck
pnpm test
```

Expected: typecheck clean, all tests PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/server/src/domains/workflows/retro-batch.ts apps/server/src/domains/workflows/retro-batch.test.ts
git commit -m "feat(retro): wire remaining deep triggers — retries, budget, priority, human, firstRun"
```

---

## Self-review

**Spec coverage:**
- Bug A (empty decision summaries into context) → Task 1 ✓
- Bug B (output summaries not emitted as events) → Task 2 ✓
- Deep triggers (retries-ge-2, budget-exceeded, priority-high/critical, needs-human, first-run) → Task 3 ✓
- `qualityScoreDeclining` → intentionally deferred (requires persona stats queries, out of scope)

**Placeholder scan:** None. All code blocks are complete.

**Type consistency:**
- `TriggerContext` extended in Task 3a is used identically in Task 3b
- `priorDecisionSummaries` shape `{ kind, summary, evidence? }` matches `DecisionSummarySchema` fields
- `parsed.data.decisionSummaries` is typed by Zod inference — no manual shape casting needed

**Potential issue:** `computeTriggers` calls `eventStore.replay({ projectId: slug })` (no `workItemId`) for `budgetExceeded` and `firstRunInMilestone`. This scans the full project event log. For a long-running project this could be slow. Acceptable for local-first single-user tool; add a note in the commit if it becomes a problem.
