# Fix prd-drafting Stuck State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When write-prd completes but the issue stays in `prd-drafting` (no `prd.drafted` event), surface a Retry button on both the run group and the pending banner, and make resume skip re-grilling and go directly to write-prd.

**Architecture:** Three layers — (1) a shared `computeIsWritePrdStuck` detector in `detail/lib/timeline.ts` used by both `RunGroupWrapper` and `PendingNextRunBanner`; (2) a backend `skipGrill` mode in the grill-and-prd workflow plus a `prd.drafted` sentinel guard; (3) a new `dispatchRetryWritePrd` dispatch function wired into `RESUME_WORKFLOWS` so the POST `/resume` endpoint skips re-grilling.

**Tech Stack:** TypeScript, React, Vitest, Hono, eventStore (SQLite-backed in-memory facade), GitHub labels as state source.

---

## File Map

| File | Change |
|------|--------|
| `apps/web/src/components/detail/lib/timeline.ts` | ADD `computeIsLive` export (moved from banner), ADD `computeIsWritePrdStuck` |
| `apps/web/src/components/detail/lib/timeline.test.ts` | ADD tests for `computeIsLive` (from its new location) and `computeIsWritePrdStuck` |
| `apps/web/src/components/detail/components/PendingNextRunBanner.tsx` | REMOVE local `computeIsLive`, IMPORT from `../lib/timeline`, ADD stuck detection + amber alert + Retry button |
| `apps/web/src/components/detail/components/PendingNextRunBanner.test.tsx` | UPDATE import of `computeIsLive`, ADD tests for stuck banner |
| `apps/web/src/components/detail/components/timeline/RunGroupWrapper.tsx` | ADD `computeIsWritePrdStuck` to `canResume` |
| `core/workflows/grill-and-prd.ts` | ADD `skipGrill?: boolean` to input type, ADD skip-grill branch, ADD `prd.drafted` sentinel guard |
| `slices/grill-and-prd/slice.test.ts` | ADD tests for `skipGrill: true` path |
| `apps/server/src/shared/dispatch.ts` | ADD `dispatchRetryWritePrd`, UPDATE `RESUME_WORKFLOWS` |

---

## Task 1: Add `computeIsLive` and `computeIsWritePrdStuck` to `detail/lib/timeline.ts`

**Files:**
- Modify: `apps/web/src/components/detail/lib/timeline.ts`
- Modify: `apps/web/src/components/detail/lib/timeline.test.ts`

`computeIsLive` is currently defined (and exported) from `PendingNextRunBanner.tsx`. Per STANDARDS, shared utilities used by 2+ components belong in `detail/lib/`. Moving it here lets `computeIsWritePrdStuck` call it without a cross-component import. The existing `PendingNextRunBanner.test.tsx` imports `computeIsLive` from the banner file — that import will break and must be updated in Task 2.

- [ ] **Step 1.1: Write failing tests for `computeIsLive` and `computeIsWritePrdStuck` in `timeline.test.ts`**

Add a new `describe` block at the bottom of the existing `timeline.test.ts`. The `makeEvent` helper is already defined in that file — reuse it.

```typescript
// At bottom of apps/web/src/components/detail/lib/timeline.test.ts
// (after the existing groupEvents describe blocks)

import { computeIsLive, computeIsWritePrdStuck } from './timeline';

describe('computeIsLive', () => {
  it('returns false when no events', () => {
    expect(computeIsLive([])).toBe(false);
  });

  it('returns false when no agent.run-started', () => {
    expect(computeIsLive([makeEvent(1, 'state.transitioned', null)])).toBe(false);
  });

  it('returns true when run-started with no terminal event after', () => {
    expect(
      computeIsLive([
        makeEvent(1, 'agent.run-started', 'r1'),
        makeEvent(2, 'agent.spawned', 'r1'),
      ]),
    ).toBe(true);
  });

  it('returns false when run-started followed by agent.run-completed', () => {
    expect(
      computeIsLive([
        makeEvent(1, 'agent.run-started', 'r1'),
        makeEvent(2, 'agent.run-completed', 'r1'),
      ]),
    ).toBe(false);
  });

  it('returns false when run-started followed by prd.drafted', () => {
    expect(
      computeIsLive([
        makeEvent(1, 'agent.run-started', 'r1'),
        makeEvent(2, 'prd.drafted', 'r1'),
      ]),
    ).toBe(false);
  });
});

describe('computeIsWritePrdStuck', () => {
  it('returns false when no agent.run-completed for write-prd', () => {
    expect(
      computeIsWritePrdStuck([
        makeEvent(1, 'agent.run-started', 'r1', { payload: { skill: 'write-prd' } }),
      ]),
    ).toBe(false);
  });

  it('returns false when write-prd completed AND prd.drafted present', () => {
    expect(
      computeIsWritePrdStuck([
        makeEvent(1, 'agent.run-started', 'r1', { payload: { skill: 'write-prd' } }),
        makeEvent(2, 'agent.run-completed', 'r1', { payload: { skill: 'write-prd' } }),
        makeEvent(3, 'prd.drafted', 'r1'),
      ]),
    ).toBe(false);
  });

  it('returns true when write-prd completed with no prd.drafted and not live', () => {
    expect(
      computeIsWritePrdStuck([
        makeEvent(1, 'agent.run-started', 'r1', { payload: { skill: 'write-prd' } }),
        makeEvent(2, 'agent.run-completed', 'r1', { payload: { skill: 'write-prd' } }),
      ]),
    ).toBe(true);
  });

  it('returns false when write-prd still running (live)', () => {
    // run-started with no terminal event → computeIsLive returns true → stuck returns false
    expect(
      computeIsWritePrdStuck([
        makeEvent(1, 'agent.run-started', 'r1', { payload: { skill: 'write-prd' } }),
        makeEvent(2, 'agent.log', 'r1'),
      ]),
    ).toBe(false);
  });

  it('returns true even when agent.run-failed present (belt-and-suspenders: isFailed handles that)', () => {
    // The RunGroupWrapper canResume already covers isFailed; computeIsWritePrdStuck
    // is additive so returning true here is harmless (OR with isFailed = still true).
    expect(
      computeIsWritePrdStuck([
        makeEvent(1, 'agent.run-started', 'r1', { payload: { skill: 'write-prd' } }),
        makeEvent(2, 'agent.run-completed', 'r1', { payload: { skill: 'write-prd' } }),
        makeEvent(3, 'agent.run-failed', 'r1', { payload: { skill: 'write-prd' } }),
      ]),
    ).toBe(true);
  });
});
```

Note: the `makeEvent` helper in `timeline.test.ts` currently takes `(id, kind, runId, overrides?)`. The `payload` overrides are passed via the fourth argument's `payload` key — verify the helper signature before running and adjust if needed. Looking at the existing helper:

```typescript
function makeEvent(
  id: number,
  kind: string,
  runId: string | null,
  overrides: Partial<AgentEventDto> = {},
): AgentEventDto {
  return {
    id,
    projectId: 'proj',
    workItemId: 'item-1',
    kind,
    payload: overrides.payload ?? null,
    runId,
    createdAt: new Date(1000 * id).toISOString(),
    ...overrides,
  };
}
```

The `payload` field comes from `overrides.payload`. Pass `{ payload: { skill: 'write-prd' } }` as the fourth argument.

- [ ] **Step 1.2: Run failing tests**

```bash
pnpm --filter @goose-hub/web test -- --reporter=verbose timeline.test.ts
```

Expected: FAIL — `computeIsLive` and `computeIsWritePrdStuck` not exported from `./timeline`.

- [ ] **Step 1.3: Add the two functions to `timeline.ts`**

At the bottom of `apps/web/src/components/detail/lib/timeline.ts`, append:

```typescript
// ─── run-state detection ─────────────────────────────────────────────────────

const TERMINAL_EVENTS = new Set([
  'agent.run-completed',
  'agent.run-failed',
  'grill.question-posted',
  'grill.completed',
  'decompose.completed',
  'retrospective.completed',
  'prd.drafted',
]);

export function computeIsLive(events: AgentEventDto[]): boolean {
  const sorted = [...events].sort((a, b) => a.id - b.id);
  let lastStartedIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].kind === 'agent.run-started') lastStartedIdx = i;
  }
  if (lastStartedIdx === -1) return false;
  for (let i = lastStartedIdx + 1; i < sorted.length; i++) {
    if (TERMINAL_EVENTS.has(sorted[i].kind)) return false;
  }
  return true;
}

export function computeIsWritePrdStuck(events: AgentEventDto[]): boolean {
  const hasWritePrdCompleted = events.some(
    (e) =>
      e.kind === 'agent.run-completed' &&
      (e.payload as { skill?: string } | null)?.skill === 'write-prd',
  );
  if (!hasWritePrdCompleted) return false;
  const hasPrdDrafted = events.some((e) => e.kind === 'prd.drafted');
  if (hasPrdDrafted) return false;
  return !computeIsLive(events);
}
```

- [ ] **Step 1.4: Run tests — expect pass**

```bash
pnpm --filter @goose-hub/web test -- --reporter=verbose timeline.test.ts
```

Expected: all tests pass.

- [ ] **Step 1.5: Run full typecheck**

```bash
pnpm --filter @goose-hub/web typecheck
```

Expected: no errors.

- [ ] **Step 1.6: Commit**

```bash
git add apps/web/src/components/detail/lib/timeline.ts apps/web/src/components/detail/lib/timeline.test.ts
git commit -m "feat(timeline): add computeIsLive and computeIsWritePrdStuck to detail/lib/timeline"
```

---

## Task 2: Update `PendingNextRunBanner` — import moved util, add stuck alert

**Files:**
- Modify: `apps/web/src/components/detail/components/PendingNextRunBanner.tsx`
- Modify: `apps/web/src/components/detail/components/PendingNextRunBanner.test.tsx`

The banner currently defines `computeIsLive` locally. Task 1 moved it to `timeline.ts`. This task removes the local definition, imports from `timeline.ts`, and adds stuck detection with an amber alert + Retry button.

- [ ] **Step 2.1: Write failing tests for the stuck banner**

In `PendingNextRunBanner.test.tsx`, add after the existing `computeIsLive` tests. The `computeIsLive` import in the test currently points at `'./PendingNextRunBanner'` — update that import and add new component tests.

The new tests require `jsdom` (the existing `computeIsLive` tests don't need it, but component render tests do). Add the jsdom pragma at the top of the file and the necessary imports.

Replace the entire `PendingNextRunBanner.test.tsx` with:

```typescript
/** @vitest-environment jsdom */
import type { AgentEventDto } from '@/lib/types';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeIsLive } from '../lib/timeline';
import { PendingNextRunBanner } from './PendingNextRunBanner';

// ─── mock api ────────────────────────────────────────────────────────────────
vi.mock('@/lib/api', () => ({
  fetchEvents: vi.fn(),
  resumeIssue: vi.fn().mockResolvedValue(undefined),
}));

import { fetchEvents, resumeIssue } from '@/lib/api';

afterEach(cleanup);

function makeEvent(kind: string, id: number, payload: Record<string, unknown> = {}): AgentEventDto {
  return {
    id,
    projectId: 'proj',
    workItemId: 'item',
    kind,
    payload,
    runId: 'run-1',
    personaId: null,
    createdAt: new Date(id * 1000).toISOString(),
  };
}

function wrapper(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// ─── computeIsLive (moved to timeline.ts) ────────────────────────────────────
describe('computeIsLive', () => {
  it('returns false when no events', () => {
    expect(computeIsLive([])).toBe(false);
  });

  it('returns false when no agent.run-started event', () => {
    expect(computeIsLive([makeEvent('state.transitioned', 1)])).toBe(false);
  });

  it('returns true when run-started with no terminal event after', () => {
    const events = [makeEvent('agent.run-started', 1), makeEvent('agent.spawned', 2)];
    expect(computeIsLive(events)).toBe(true);
  });

  it('returns false when run-started followed by agent.run-completed', () => {
    const events = [makeEvent('agent.run-started', 1), makeEvent('agent.run-completed', 2)];
    expect(computeIsLive(events)).toBe(false);
  });

  it('returns false when run-started followed by prd.drafted', () => {
    const events = [makeEvent('agent.run-started', 1), makeEvent('prd.drafted', 2)];
    expect(computeIsLive(events)).toBe(false);
  });

  it('returns true when second run started after first completed', () => {
    const events = [
      makeEvent('agent.run-started', 1),
      makeEvent('agent.run-completed', 2),
      makeEvent('agent.run-started', 3),
    ];
    expect(computeIsLive(events)).toBe(true);
  });

  it('handles descending order (as returned by server API)', () => {
    const events = [
      makeEvent('agent.run-completed', 3),
      makeEvent('agent.run-started', 2),
      makeEvent('state.transitioned', 1),
    ];
    expect(computeIsLive(events)).toBe(false);
  });
});

// ─── PendingNextRunBanner stuck alert ────────────────────────────────────────
describe('PendingNextRunBanner stuck detection', () => {
  beforeEach(() => {
    vi.mocked(fetchEvents).mockReset();
  });

  it('shows amber alert with Retry when write-prd completed but no prd.drafted', async () => {
    vi.mocked(fetchEvents).mockResolvedValue([
      makeEvent('agent.run-started', 1, { skill: 'write-prd' }),
      makeEvent('agent.run-completed', 2, { skill: 'write-prd' }),
    ]);
    render(
      wrapper(
        <PendingNextRunBanner
          state="factory:prd-drafting"
          projectSlug="my-project"
          id="42"
        />,
      ),
    );
    const retryBtn = await screen.findByRole('button', { name: /retry/i });
    expect(retryBtn).toBeTruthy();
  });

  it('shows normal info banner (no button) when prd.drafted is present', async () => {
    vi.mocked(fetchEvents).mockResolvedValue([
      makeEvent('agent.run-started', 1, { skill: 'write-prd' }),
      makeEvent('agent.run-completed', 2, { skill: 'write-prd' }),
      makeEvent('prd.drafted', 3),
    ]);
    render(
      wrapper(
        <PendingNextRunBanner
          state="factory:prd-drafting"
          projectSlug="my-project"
          id="42"
        />,
      ),
    );
    await screen.findByText(/next run pending/i);
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('calls resumeIssue when Retry clicked', async () => {
    vi.mocked(fetchEvents).mockResolvedValue([
      makeEvent('agent.run-started', 1, { skill: 'write-prd' }),
      makeEvent('agent.run-completed', 2, { skill: 'write-prd' }),
    ]);
    render(
      wrapper(
        <PendingNextRunBanner
          state="factory:prd-drafting"
          projectSlug="my-project"
          id="42"
        />,
      ),
    );
    const btn = await screen.findByRole('button', { name: /retry/i });
    await userEvent.click(btn);
    expect(resumeIssue).toHaveBeenCalledWith('my-project', '42');
  });
});
```

- [ ] **Step 2.2: Run failing tests**

```bash
pnpm --filter @goose-hub/web test -- --reporter=verbose PendingNextRunBanner.test.tsx
```

Expected: FAIL — `computeIsLive` not exported from `'./PendingNextRunBanner'`, stuck banner tests fail.

- [ ] **Step 2.3: Rewrite `PendingNextRunBanner.tsx`**

Replace the entire file content:

```typescript
import { resumeIssue } from '@/lib/api';
import { cn } from '@/lib/cn';
import { PENDING_NEXT_RUN_STATES } from '@/lib/constants';
import type { AgentEventDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { computeIsLive, computeIsWritePrdStuck } from '../lib/timeline';
import { fetchEvents } from '@/lib/api';

interface PendingNextRunBannerProps {
  state?: string;
  projectSlug?: string;
  id?: string;
}

export function PendingNextRunBanner({ state, projectSlug, id }: PendingNextRunBannerProps) {
  const skillName = state != null ? PENDING_NEXT_RUN_STATES[state] : undefined;
  const [retrying, setRetrying] = useState(false);

  const { data: events = [] } = useQuery({
    queryKey: ['events', projectSlug, id],
    queryFn: () => fetchEvents(projectSlug ?? '', id ?? ''),
    enabled: skillName != null && !!projectSlug && !!id,
    refetchInterval: 5000,
  });

  if (skillName == null) return null;
  if (computeIsLive(events)) return null;

  const isStuck = computeIsWritePrdStuck(events);

  const handleRetry = async () => {
    if (retrying || !projectSlug || !id) return;
    setRetrying(true);
    try {
      await resumeIssue(projectSlug, id);
    } finally {
      setRetrying(false);
    }
  };

  if (isStuck) {
    return (
      <div
        data-testid="pending-next-run-banner"
        className={cn(
          'flex items-center gap-2.5 px-6 py-2.5 shrink-0',
          'border-b border-amber-500/30 bg-amber-500/10',
          'text-[12.5px] font-medium text-amber-400',
        )}
      >
        <AlertTriangle size={14} className="shrink-0" />
        <span className="flex-1">
          Write PRD stalled — completed without advancing state. Retry to re-run write-prd
          directly (grill context preserved).
        </span>
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={10} className={retrying ? 'animate-spin' : ''} />
          {retrying ? 'Dispatching…' : 'Retry'}
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="pending-next-run-banner"
      className={cn(
        'flex items-center gap-2.5 px-6 py-2.5 shrink-0',
        'border-b border-fg-3/20 bg-fg-3/5',
        'text-[12.5px] font-medium text-info',
      )}
    >
      <Clock size={14} className="shrink-0" />
      <span>Next run pending · {skillName}</span>
    </div>
  );
}
```

Note: `fetchEvents` is imported from `@/lib/api` directly. Remove it from the `useQuery` `queryFn` closure if it was previously used differently — it was previously imported at the top of the file via `import { fetchEvents } from '@/lib/api'`. Check that `fetchEvents` is already exported from `@/lib/api` before this step; if it's not imported there yet, add it.

- [ ] **Step 2.4: Run tests — expect pass**

```bash
pnpm --filter @goose-hub/web test -- --reporter=verbose PendingNextRunBanner.test.tsx
```

Expected: all pass.

- [ ] **Step 2.5: Run full typecheck**

```bash
pnpm --filter @goose-hub/web typecheck
```

Expected: no errors. If `computeIsLive` import error appears elsewhere referencing `PendingNextRunBanner`, fix those imports to point at `../lib/timeline` or `@/lib/timeline` as appropriate.

- [ ] **Step 2.6: Run lint**

```bash
pnpm biome check --diagnostic-level=error apps/web/src/components/detail/components/PendingNextRunBanner.tsx
```

Expected: clean.

- [ ] **Step 2.7: Commit**

```bash
git add apps/web/src/components/detail/components/PendingNextRunBanner.tsx \
        apps/web/src/components/detail/components/PendingNextRunBanner.test.tsx
git commit -m "feat(banner): amber alert + Retry button when write-prd stalls in prd-drafting"
```

---

## Task 3: Extend `RunGroupWrapper` `canResume` with stuck detection

**Files:**
- Modify: `apps/web/src/components/detail/components/timeline/RunGroupWrapper.tsx`

The logic is already tested via `computeIsWritePrdStuck` in `timeline.test.ts`. This task wires it into the component.

- [ ] **Step 3.1: Add import and stuck detection**

In `RunGroupWrapper.tsx`, update the import from `../../lib/timeline`:

```typescript
import {
  type RenderItem,
  type TimelineContext,
  computeIsWritePrdStuck,
  formatDuration,
  formatSkillName,
} from '../../lib/timeline';
```

After the existing `isFailed` and `isOrphaned` computations (around line 101), add:

```typescript
const groupEventList = items
  .filter((item): item is Extract<RenderItem, { kind: 'event' }> => item.kind === 'event')
  .map((item) => item.event);
const isWritePrdStuck = computeIsWritePrdStuck(groupEventList);
```

Update `canResume` (line 102):

```typescript
const canResume = context != null && (isFailed || isStalled || isWritePrdStuck) && isLatestRun && !resumed;
```

- [ ] **Step 3.2: Run typecheck**

```bash
pnpm --filter @goose-hub/web typecheck
```

Expected: no errors.

- [ ] **Step 3.3: Run lint**

```bash
pnpm biome check --diagnostic-level=error apps/web/src/components/detail/components/timeline/RunGroupWrapper.tsx
```

Expected: clean.

- [ ] **Step 3.4: Commit**

```bash
git add apps/web/src/components/detail/components/timeline/RunGroupWrapper.tsx
git commit -m "feat(timeline): show Resume button on write-prd run group when stuck in prd-drafting"
```

---

## Task 4: Backend — `skipGrill` mode + `prd.drafted` sentinel in `grill-and-prd.ts`

**Files:**
- Modify: `core/workflows/grill-and-prd.ts`
- Modify: `slices/grill-and-prd/slice.test.ts`

Two changes: (a) add `skipGrill?: boolean` so dispatch can jump straight to write-prd without re-grilling, and (b) wrap the final `prd.drafted` append in a try-catch sentinel so any unexpected throw guarantees `agent.run-failed` is emitted (preventing the "Complete + stuck" badge situation in future).

- [ ] **Step 4.1: Write failing tests for `skipGrill: true`**

In `slices/grill-and-prd/slice.test.ts`, add a new `describe` block after the existing ones. Seed a `grill.completed` event into the event store before calling the workflow (this is how the workflow recovers `refinedIntent`).

```typescript
describe('skipGrill mode — retry write-prd directly', () => {
  it('calls write-prd without calling grill-me when skipGrill:true', async () => {
    const projectId = uniqueProjectId('skip-grill');
    const source = new InMemoryLabelsSource(REPO_REF, [
      {
        id: `github:${REPO_REF}#77`,
        externalId: '77',
        title: 'Retry PRD',
        body: 'Some feature request.',
        state: 'factory:prd-drafting',
        priority: 'medium' as Priority,
        type: 'feature',
        labels: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    // Pre-seed the grill.completed event so skipGrill can recover refinedIntent.
    const workItemId = `github:${REPO_REF}#77`;
    eventStore.appendEvent({
      projectId,
      workItemId,
      kind: 'grill.completed',
      payload: { refinedIntent: 'Retry PRD with recovered intent', rounds: 2 },
    });

    const prdOutput = validPRD({ title: 'Retry PRD with recovered intent' });
    const runtime = makeQueuedRuntime([prdOutput]);

    const result = await runGrillAndPrdWorkflow({
      workItem: await source.getItem('77'),
      stateSource: source,
      projectId,
      priorReplies: [],
      skipGrill: true,
      deps: {
        runtime,
        projectConfig: null,
        totalSpendForSkill: () => 0,
        buildContext: async () => ({ stackSummary: '', contextMd: '', adrSummaries: [], claudeMd: '' }),
        createWorktreeImpl: () => { throw new Error('should not create worktree in skipGrill mode'); },
        cleanupWorktreeImpl: () => { throw new Error('should not clean worktree in skipGrill mode'); },
      },
    });

    expect(result.phase).toBe('prd-review');
    // runtime.run called exactly once (write-prd only — no grill-me)
    expect(runtime.run).toHaveBeenCalledTimes(1);
    const callArgs = (runtime.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.skill).toBe('write-prd');
  });

  it('uses refinedIntent from grill.completed event when skipGrill:true', async () => {
    const projectId = uniqueProjectId('skip-grill-intent');
    const source = new InMemoryLabelsSource(REPO_REF, [
      {
        id: `github:${REPO_REF}#78`,
        externalId: '78',
        title: 'Fallback title',
        body: 'Body.',
        state: 'factory:prd-drafting',
        priority: 'medium' as Priority,
        type: 'feature',
        labels: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    const workItemId = `github:${REPO_REF}#78`;
    eventStore.appendEvent({
      projectId,
      workItemId,
      kind: 'grill.completed',
      payload: { refinedIntent: 'Recovered: reduce sign-up friction', rounds: 1 },
    });

    const prdOutput = validPRD({ title: 'Recovered: reduce sign-up friction' });
    const runtime = makeQueuedRuntime([prdOutput]);

    await runGrillAndPrdWorkflow({
      workItem: await source.getItem('78'),
      stateSource: source,
      projectId,
      priorReplies: [],
      skipGrill: true,
      deps: {
        runtime,
        projectConfig: null,
        totalSpendForSkill: () => 0,
        buildContext: async () => ({ stackSummary: '', contextMd: '', adrSummaries: [], claudeMd: '' }),
        createWorktreeImpl: () => { throw new Error('no worktree'); },
        cleanupWorktreeImpl: () => { throw new Error('no worktree'); },
      },
    });

    const callArgs = (runtime.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.context.refinedIntent).toBe('Recovered: reduce sign-up friction');
  });

  it('falls back to workItem.title when no grill.completed event found', async () => {
    const projectId = uniqueProjectId('skip-grill-fallback');
    const source = new InMemoryLabelsSource(REPO_REF, [
      {
        id: `github:${REPO_REF}#79`,
        externalId: '79',
        title: 'Fallback title used',
        body: 'Body.',
        state: 'factory:prd-drafting',
        priority: 'medium' as Priority,
        type: 'feature',
        labels: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    // No grill.completed event seeded — workflow should fall back to workItem.title

    const prdOutput = validPRD({ title: 'Fallback title used' });
    const runtime = makeQueuedRuntime([prdOutput]);

    await runGrillAndPrdWorkflow({
      workItem: await source.getItem('79'),
      stateSource: source,
      projectId,
      priorReplies: [],
      skipGrill: true,
      deps: {
        runtime,
        projectConfig: null,
        totalSpendForSkill: () => 0,
        buildContext: async () => ({ stackSummary: '', contextMd: '', adrSummaries: [], claudeMd: '' }),
        createWorktreeImpl: () => { throw new Error('no worktree'); },
        cleanupWorktreeImpl: () => { throw new Error('no worktree'); },
      },
    });

    const callArgs = (runtime.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.context.refinedIntent).toBe('Fallback title used');
  });
});
```

- [ ] **Step 4.2: Run failing tests**

```bash
pnpm test -- --reporter=verbose slices/grill-and-prd/slice.test.ts
```

Expected: FAIL — `skipGrill` not a property of `RunGrillAndPrdInput`.

- [ ] **Step 4.3: Implement `skipGrill` in `grill-and-prd.ts`**

**4.3a — Add `skipGrill` to `RunGrillAndPrdInput`:**

In `RunGrillAndPrdInput` interface (line 153), add:

```typescript
/** When true: skip grill-me entirely and go straight to write-prd.
 * Recovers refinedIntent from the last grill.completed event in the event store. */
skipGrill?: boolean;
```

**4.3b — Update valid-states check and add skipGrill branch in `runGrillAndPrdWorkflow`:**

Replace the block starting at `const validStates` (around line 285):

```typescript
const isReviseMode = priorPrd != null;
const skipGrill = input.skipGrill === true;

const validStates: string[] = isReviseMode
  ? ['factory:grilling', 'factory:gate-pending', 'factory:prd-review']
  : skipGrill
    ? ['factory:prd-drafting']
    : ['factory:grilling', 'factory:gate-pending'];
```

Then, right after the `projectContext` / `fullProjectContext` block (after line 319, before the `if (isReviseMode)` check), add the `skipGrill` branch:

```typescript
// ─── Skip-grill mode: jump directly to write-prd ─────────────────────────
if (skipGrill) {
  const allEvents = eventStore.replay({ projectId, workItemId: workItem.id });
  const grillCompleted = [...allEvents].reverse().find((e) => e.kind === 'grill.completed');
  const refinedIntent =
    (grillCompleted?.payload as { refinedIntent?: string } | null)?.refinedIntent ??
    workItem.title;
  return runWritePrdStep({
    workItem,
    stateSource,
    projectId,
    runId,
    runtime,
    projectConfig,
    totalSpendForSkill,
    fullProjectContext,
    refinedIntent,
    priorReplies: augmentPriorRepliesWithCrystallizations(priorReplies, projectId, workItem.id),
  });
}
```

Place this block BEFORE the `if (isReviseMode)` block and BEFORE the worktree creation block.

**4.3c — Add `prd.drafted` sentinel guard in `runWritePrdStep`:**

At the end of `runWritePrdStep`, the current code is:

```typescript
eventStore.appendEvent({
  kind: 'prd.drafted',
  projectId,
  workItemId: workItem.id,
  runId,
  payload: { prd: prdOutput, advisorConcerns },
});

return { phase: 'prd-review', prdOutput };
```

Replace with:

```typescript
try {
  eventStore.appendEvent({
    kind: 'prd.drafted',
    projectId,
    workItemId: workItem.id,
    runId,
    payload: { prd: prdOutput, advisorConcerns },
  });
} catch (err) {
  // Sentinel: prd.drafted emit failed after successful transition.
  // Emit agent.run-failed so the timeline shows "Failed" (not "Complete") and
  // the Resume button appears naturally via the isFailed canResume path.
  eventStore.appendEvent({
    kind: 'agent.run-failed',
    projectId,
    workItemId: workItem.id,
    runId,
    payload: { skill: 'write-prd', error: `prd.drafted emit failed: ${String(err)}` },
  });
  return { phase: 'needs-human' };
}
return { phase: 'prd-review', prdOutput };
```

- [ ] **Step 4.4: Run tests — expect pass**

```bash
pnpm test -- --reporter=verbose slices/grill-and-prd/slice.test.ts
```

Expected: all pass.

- [ ] **Step 4.5: Run typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4.6: Commit**

```bash
git add core/workflows/grill-and-prd.ts slices/grill-and-prd/slice.test.ts
git commit -m "feat(workflow): skipGrill mode for prd-drafting retry + prd.drafted sentinel guard"
```

---

## Task 5: Backend — `dispatchRetryWritePrd` + update `RESUME_WORKFLOWS`

**Files:**
- Modify: `apps/server/src/shared/dispatch.ts`

- [ ] **Step 5.1: Add `dispatchRetryWritePrd` function**

Find `dispatchGrillAndPrd` (around line 1063). Add the new function immediately after it (before `dispatchRevisePrd`):

```typescript
/**
 * Retry write-prd directly, skipping re-grilling. Used when an issue is stuck
 * in factory:prd-drafting after a failed or incomplete write-prd run. Grill
 * context (refinedIntent) is recovered from the grill.completed event in the
 * event store; priorReplies are rebuilt from issue comments so the PRD writer
 * has the full Q&A history.
 */
export async function dispatchRetryWritePrd(slug: string, issueNumber: number): Promise<void> {
  const maxParallel = await getMaxParallelAgents(slug);
  if (parallelLock.isInFlight(slug, issueNumber)) {
    logger.warn('dispatchRetryWritePrd: duplicate in-flight, dropping', { slug, issueNumber });
    return;
  }
  if (!parallelLock.tryAcquire(slug, issueNumber, maxParallel)) {
    logger.info('dispatchRetryWritePrd: cap full, queuing work item', {
      slug,
      issueNumber,
      inFlight: parallelLock.inFlightCount(slug),
      maxParallel,
    });
    enqueueWorkflow(slug, issueNumber, dispatchRetryWritePrd);
    return;
  }
  try {
    // Case 2: runtime-resolved path — module path depends on per-project config loaded at runtime.
    const { runGrillAndPrdWorkflow } = await import('@goose-hub/core/workflows/grill-and-prd.js');
    const source = await getSourceForSlug(slug);
    if (source == null) {
      logger.error('dispatchRetryWritePrd: no source for slug', { slug });
      return;
    }
    const item = await source.getItem(issueNumber.toString());
    if (item.state !== 'factory:prd-drafting') {
      logger.info('dispatchRetryWritePrd: state already advanced, skipping', {
        slug,
        issueNumber,
        state: item.state,
      });
      return;
    }
    const comments = await source.listComments(issueNumber.toString());
    const priorReplies = buildPriorReplies(comments);
    await runGrillAndPrdWorkflow({
      workItem: item,
      stateSource: source,
      projectId: slug,
      priorReplies,
      skipGrill: true,
      deps: { repoRoot: REPO_ROOT },
    });
  } finally {
    parallelLock.release(slug, issueNumber);
    drainPending(slug);
  }
}
```

Note: the `await import(...)` line must carry a one-line comment per STANDARDS (dynamic import case 2). The comment above uses "Case 2: runtime-resolved path" — match it to the numbering used in other dynamic imports in this file.

- [ ] **Step 5.2: Update `RESUME_WORKFLOWS`**

Find `RESUME_WORKFLOWS` (around line 1242). Change the `factory:prd-drafting` entry from:

```typescript
'factory:prd-drafting': { targetState: 'factory:grilling', dispatch: dispatchGrillAndPrd },
```

To:

```typescript
'factory:prd-drafting': { targetState: 'factory:prd-drafting', dispatch: dispatchRetryWritePrd },
```

`targetState` matches `fromState` so `dispatchResumeIssue` will NOT call `forceState` — the issue stays in `prd-drafting` and `dispatchRetryWritePrd` handles the state progression internally via `runWritePrdStep`.

- [ ] **Step 5.3: Run typecheck**

```bash
pnpm --filter @goose-hub/server typecheck
```

Expected: no errors.

- [ ] **Step 5.4: Run lint**

```bash
pnpm biome check --diagnostic-level=error apps/server/src/shared/dispatch.ts
```

Expected: clean.

- [ ] **Step 5.5: Run full test suite**

```bash
pnpm test
```

Expected: all pass. If any existing test references the old `'factory:prd-drafting'` → `'factory:grilling'` RESUME_WORKFLOWS behavior, update it to reflect `'factory:prd-drafting'` → `'factory:prd-drafting'`.

- [ ] **Step 5.6: Commit**

```bash
git add apps/server/src/shared/dispatch.ts
git commit -m "feat(dispatch): dispatchRetryWritePrd skips re-grilling; wire into RESUME_WORKFLOWS"
```

---

## Self-Review

**Spec coverage:**
- ✅ Resume skips re-grilling → `skipGrill` path in Task 4 + `dispatchRetryWritePrd` in Task 5
- ✅ Resume button on write-prd run group → `isWritePrdStuck` in `canResume`, Task 3
- ✅ Alert banner asking for human → amber stuck alert in `PendingNextRunBanner`, Task 2
- ✅ Shared logic in `detail/lib/` → `computeIsWritePrdStuck` in `timeline.ts`, Task 1
- ✅ `agent.run-failed` emitted on future stuck cases → sentinel guard in Task 4

**Placeholder scan:** No TBDs, no "add appropriate error handling", all code blocks complete.

**Type consistency:**
- `computeIsWritePrdStuck` takes `AgentEventDto[]` in Task 1, called with same type extracted from `RenderItem[]` in Task 3, and from `events` array in Task 2.
- `skipGrill?: boolean` added to `RunGrillAndPrdInput` in Task 4; used in `runGrillAndPrdWorkflow` and passed from `dispatchRetryWritePrd` in Task 5.
- `dispatchRetryWritePrd` signature `(slug: string, issueNumber: number): Promise<void>` matches `ResumeEntry.dispatch` type in `RESUME_WORKFLOWS`.
