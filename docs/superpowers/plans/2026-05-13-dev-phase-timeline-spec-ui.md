# Dev Phase Timeline + Spec UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the engineering spec in the Investigation tab and render dev-phase events (dev-review.*, parallel-implement grouping) correctly in the timeline.

**Architecture:** Three independent work streams — (1) server route + web SpecDetails widget for Issue 1, (2) eight label additions for Issue 2, (3) DevReviewEvents component + phase-group grouping + PhaseGroupWrapper for Issue 3. Issue 2 is a prerequisite for Issue 3 (labels must exist before components reference them in tests). Issue 1 is independent of both.

**Tech Stack:** TypeScript, React, Vite, shadcn/ui, Hono, Drizzle/SQLite, Vitest, @testing-library/react

---

## File Map

**Modified:**
- `apps/web/src/components/detail/lib/timeline.ts` — add 8 dev-review labels; add `phase-group` RenderItem variant; add `groupByDevPhase()`; call it from `groupEvents()`
- `apps/web/src/components/detail/lib/timeline.test.ts` — tests for `groupByDevPhase()`
- `apps/web/src/components/detail/components/TimelineEvents.tsx` — import + switch cases for dev-review.* and phase-group
- `apps/web/src/lib/types.ts` — add `WorkPackageDto`, `EngineeringSpecDto`
- `apps/web/src/lib/api.ts` — add `fetchEngineeringSpec()`
- `apps/web/src/components/detail/components/InvestigationSection.tsx` — query spec + render SpecDetails
- `apps/server/src/domains/issues/service.ts` — add `getIssueSpec()`; add import for `getEngineeringSpec`
- `apps/server/src/domains/issues/router.ts` — add `GET /:slug/issues/:id/spec` route
- `apps/server/src/domains/issues/router.test.ts` — add spec route test

**Created:**
- `apps/web/src/components/detail/components/timeline/DevReviewEvents.tsx`
- `apps/web/src/components/detail/components/timeline/DevReviewEvents.test.tsx`
- `apps/web/src/components/detail/components/timeline/PhaseGroupWrapper.tsx`
- `apps/web/src/components/detail/components/SpecDetails.tsx`
- `apps/web/src/components/detail/components/SpecDetails.test.tsx`

---

## Task 1: Issue 2 — Add dev-review.* event labels to EVENT_KIND_LABEL

**Files:**
- Modify: `apps/web/src/components/detail/lib/timeline.ts:83`

- [ ] **Step 1: Write a failing test that checks all 8 labels exist**

In `apps/web/src/components/detail/lib/timeline.test.ts`, add a new `describe` block after the existing ones:

```typescript
describe('EVENT_KIND_LABEL — dev-review kinds', () => {
  const DEV_REVIEW_KINDS = [
    'dev-review.started',
    'dev-review.completed',
    'dev-review.failed',
    'dev-review.error',
    'dev-review.budget-skipped',
    'dev-review.response-started',
    'dev-review.response-completed',
    'dev-review.response-failed',
  ] as const;

  it.each(DEV_REVIEW_KINDS)('has a label for %s', (kind) => {
    expect(EVENT_KIND_LABEL[kind]).toBeDefined();
    expect(typeof EVENT_KIND_LABEL[kind]).toBe('string');
    expect(EVENT_KIND_LABEL[kind].length).toBeGreaterThan(0);
  });
});
```

Also add `EVENT_KIND_LABEL` to the import at the top of the test file:
```typescript
import { EVENT_KIND_LABEL, computeIsLive, computeIsWritePrdStuck, groupEvents } from './timeline';
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web && pnpm vitest run src/components/detail/lib/timeline.test.ts
```

Expected: 8 failures, each reporting `undefined` is not defined / has length 0.

- [ ] **Step 3: Add the 8 labels**

In `apps/web/src/components/detail/lib/timeline.ts`, after line 83 (`'parallel-implement.exhausted': 'Parallel implement exhausted',`), add:

```typescript
  'dev-review.started': 'Dev review started',
  'dev-review.completed': 'Dev review completed',
  'dev-review.failed': 'Dev review failed',
  'dev-review.error': 'Dev review error',
  'dev-review.budget-skipped': 'Dev review budget skipped',
  'dev-review.response-started': 'Dev review response started',
  'dev-review.response-completed': 'Dev review response completed',
  'dev-review.response-failed': 'Dev review response failed',
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && pnpm vitest run src/components/detail/lib/timeline.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/detail/lib/timeline.ts apps/web/src/components/detail/lib/timeline.test.ts
git commit -m "feat(timeline): add dev-review event kind labels"
```

---

## Task 2: Issue 3a — DevReviewEvents.tsx component

**Files:**
- Create: `apps/web/src/components/detail/components/timeline/DevReviewEvents.tsx`
- Create: `apps/web/src/components/detail/components/timeline/DevReviewEvents.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `apps/web/src/components/detail/components/timeline/DevReviewEvents.test.tsx`:

```typescript
import type { AgentEventDto } from '@/lib/types';
/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DevReviewBudgetSkippedEvent,
  DevReviewCompletedEvent,
  DevReviewErrorEvent,
  DevReviewFailedEvent,
  DevReviewResponseCompletedEvent,
  DevReviewResponseFailedEvent,
  DevReviewResponseStartedEvent,
  DevReviewStartedEvent,
} from './DevReviewEvents';

afterEach(cleanup);

function makeEvent(kind: string, payload: unknown = {}): AgentEventDto {
  return {
    id: 1,
    kind,
    payload,
    createdAt: '2026-05-13T10:00:00Z',
    workItemId: 'github:shaunnez/goose-hub#800',
    projectId: 'goose-hub-self',
  } as AgentEventDto;
}

describe('DevReviewEvents', () => {
  it('renders dev-review.started with title', () => {
    render(
      <ul>
        <DevReviewStartedEvent event={makeEvent('dev-review.started', { pipelineRunId: 'abc123' })} />
      </ul>,
    );
    expect(screen.getByText('Dev review started')).toBeTruthy();
  });

  it('renders dev-review.completed with verdict', () => {
    render(
      <ul>
        <DevReviewCompletedEvent
          event={makeEvent('dev-review.completed', { verdict: 'proceed', pipelineRunId: 'abc123' })}
        />
      </ul>,
    );
    expect(screen.getByText('Dev review completed')).toBeTruthy();
    expect(screen.getByText('proceed')).toBeTruthy();
  });

  it('renders dev-review.failed with error reason', () => {
    render(
      <ul>
        <DevReviewFailedEvent
          event={makeEvent('dev-review.failed', { errorReason: 'agent timed out', pipelineRunId: 'abc123' })}
        />
      </ul>,
    );
    expect(screen.getByText('Dev review failed')).toBeTruthy();
    expect(screen.getByText('agent timed out')).toBeTruthy();
  });

  it('renders dev-review.budget-skipped', () => {
    render(
      <ul>
        <DevReviewBudgetSkippedEvent event={makeEvent('dev-review.budget-skipped', { pipelineRunId: 'abc123' })} />
      </ul>,
    );
    expect(screen.getByText('Dev review budget skipped')).toBeTruthy();
  });

  it('renders dev-review.response-started', () => {
    render(
      <ul>
        <DevReviewResponseStartedEvent
          event={makeEvent('dev-review.response-started', { pipelineRunId: 'abc123' })}
        />
      </ul>,
    );
    expect(screen.getByText('Response started')).toBeTruthy();
  });

  it('renders dev-review.response-completed', () => {
    render(
      <ul>
        <DevReviewResponseCompletedEvent
          event={makeEvent('dev-review.response-completed', { pipelineRunId: 'abc123' })}
        />
      </ul>,
    );
    expect(screen.getByText('Response completed')).toBeTruthy();
  });

  it('renders dev-review.response-failed', () => {
    render(
      <ul>
        <DevReviewResponseFailedEvent
          event={makeEvent('dev-review.response-failed', { errorReason: 'network error', pipelineRunId: 'abc123' })}
        />
      </ul>,
    );
    expect(screen.getByText('Response failed')).toBeTruthy();
    expect(screen.getByText('network error')).toBeTruthy();
  });

  it('renders dev-review.error', () => {
    render(
      <ul>
        <DevReviewErrorEvent
          event={makeEvent('dev-review.error', { errorReason: 'internal error', pipelineRunId: 'abc123' })}
        />
      </ul>,
    );
    expect(screen.getByText('Dev review error')).toBeTruthy();
    expect(screen.getByText('internal error')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web && pnpm vitest run src/components/detail/components/timeline/DevReviewEvents.test.tsx
```

Expected: fails — module not found.

- [ ] **Step 3: Create DevReviewEvents.tsx**

Create `apps/web/src/components/detail/components/timeline/DevReviewEvents.tsx`:

```tsx
import type { AgentEventDto } from '@/lib/types';
import { AlertTriangle, CheckCircle, Clock, GitBranch, SkipForward, XCircle } from 'lucide-react';

type DevReviewPayload = {
  pipelineRunId?: string;
  verdict?: string;
  errorReason?: string;
  iteration?: number;
};

function formatShortId(value: string | undefined): string | null {
  if (value == null || value.length === 0) return null;
  return value.length <= 12 ? value : value.slice(0, 8);
}

function PipelineChip({ pipelineRunId }: { pipelineRunId?: string }) {
  const shortId = formatShortId(pipelineRunId);
  if (shortId == null) return null;
  return <span className="font-mono text-fg-4">pipeline {shortId}</span>;
}

function TimelineDot() {
  return <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />;
}

function DevReviewShell({
  event,
  icon,
  title,
  tone = 'line',
  children,
}: {
  event: AgentEventDto;
  icon: React.ReactNode;
  title: string;
  tone?: 'line' | 'success' | 'warning' | 'danger' | 'info';
  children?: React.ReactNode;
}) {
  const borderClass =
    tone === 'success'
      ? 'border-success'
      : tone === 'warning'
        ? 'border-warning'
        : tone === 'danger'
          ? 'border-red-400'
          : tone === 'info'
            ? 'border-info'
            : 'border-line';

  return (
    <li
      data-event-kind={event.kind}
      className={`rounded-md border ${borderClass} bg-bg-elev/60 px-4 py-3`}
    >
      <div className="flex flex-wrap items-center gap-2 mb-1 text-[11px] text-fg-3">
        {icon}
        <span className="font-mono uppercase tracking-wider">{title}</span>
        <TimelineDot />
        <span className="font-mono tnum">{new Date(event.createdAt).toLocaleString()}</span>
      </div>
      {children}
    </li>
  );
}

function DetailRow({ children }: { children: React.ReactNode }) {
  return <div className="text-[11.5px] text-fg-3 break-words">{children}</div>;
}

export function DevReviewStartedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as DevReviewPayload | null;
  return (
    <DevReviewShell
      event={event}
      icon={<GitBranch size={13} className="shrink-0 text-[color:var(--accent)]" />}
      title="Dev review started"
      tone="info"
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
        {p?.iteration != null && <span>Iteration {p.iteration}</span>}
        <PipelineChip pipelineRunId={p?.pipelineRunId} />
      </div>
    </DevReviewShell>
  );
}

export function DevReviewCompletedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as DevReviewPayload | null;
  return (
    <DevReviewShell
      event={event}
      icon={<CheckCircle size={13} className="shrink-0 text-green-400" />}
      title="Dev review completed"
      tone="success"
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
        {p?.verdict != null && (
          <span className="font-mono text-fg-2">{p.verdict}</span>
        )}
        <PipelineChip pipelineRunId={p?.pipelineRunId} />
      </div>
    </DevReviewShell>
  );
}

export function DevReviewFailedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as DevReviewPayload | null;
  return (
    <DevReviewShell
      event={event}
      icon={<XCircle size={13} className="shrink-0 text-[color:var(--danger)]" />}
      title="Dev review failed"
      tone="danger"
    >
      <div className="space-y-1">
        {p?.errorReason != null && <DetailRow>{p.errorReason}</DetailRow>}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
          <PipelineChip pipelineRunId={p?.pipelineRunId} />
        </div>
      </div>
    </DevReviewShell>
  );
}

export function DevReviewErrorEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as DevReviewPayload | null;
  return (
    <DevReviewShell
      event={event}
      icon={<AlertTriangle size={13} className="shrink-0 text-amber-400" />}
      title="Dev review error"
      tone="warning"
    >
      <div className="space-y-1">
        {p?.errorReason != null && <DetailRow>{p.errorReason}</DetailRow>}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
          <PipelineChip pipelineRunId={p?.pipelineRunId} />
        </div>
      </div>
    </DevReviewShell>
  );
}

export function DevReviewBudgetSkippedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as DevReviewPayload | null;
  return (
    <DevReviewShell
      event={event}
      icon={<SkipForward size={13} className="shrink-0 text-fg-4" />}
      title="Dev review budget skipped"
      tone="line"
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
        <PipelineChip pipelineRunId={p?.pipelineRunId} />
      </div>
    </DevReviewShell>
  );
}

export function DevReviewResponseStartedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as DevReviewPayload | null;
  return (
    <DevReviewShell
      event={event}
      icon={<Clock size={13} className="shrink-0 text-[color:var(--accent)]" />}
      title="Response started"
      tone="info"
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
        <PipelineChip pipelineRunId={p?.pipelineRunId} />
      </div>
    </DevReviewShell>
  );
}

export function DevReviewResponseCompletedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as DevReviewPayload | null;
  return (
    <DevReviewShell
      event={event}
      icon={<CheckCircle size={13} className="shrink-0 text-green-400" />}
      title="Response completed"
      tone="success"
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
        <PipelineChip pipelineRunId={p?.pipelineRunId} />
      </div>
    </DevReviewShell>
  );
}

export function DevReviewResponseFailedEvent({ event }: { event: AgentEventDto }) {
  const p = event.payload as DevReviewPayload | null;
  return (
    <DevReviewShell
      event={event}
      icon={<XCircle size={13} className="shrink-0 text-[color:var(--danger)]" />}
      title="Response failed"
      tone="danger"
    >
      <div className="space-y-1">
        {p?.errorReason != null && <DetailRow>{p.errorReason}</DetailRow>}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
          <PipelineChip pipelineRunId={p?.pipelineRunId} />
        </div>
      </div>
    </DevReviewShell>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd apps/web && pnpm vitest run src/components/detail/components/timeline/DevReviewEvents.test.tsx
```

Expected: all 8 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/detail/components/timeline/DevReviewEvents.tsx apps/web/src/components/detail/components/timeline/DevReviewEvents.test.tsx
git commit -m "feat(timeline): add DevReviewEvents components"
```

---

## Task 3: Issue 3b — Wire dev-review.* into TimelineEvents.tsx

**Files:**
- Modify: `apps/web/src/components/detail/components/TimelineEvents.tsx`

- [ ] **Step 1: Add the import**

In `apps/web/src/components/detail/components/TimelineEvents.tsx`, add after the `ParallelImplementEvents` import block (after line 49):

```tsx
import {
  DevReviewBudgetSkippedEvent,
  DevReviewCompletedEvent,
  DevReviewErrorEvent,
  DevReviewFailedEvent,
  DevReviewResponseCompletedEvent,
  DevReviewResponseFailedEvent,
  DevReviewResponseStartedEvent,
  DevReviewStartedEvent,
} from './timeline/DevReviewEvents';
```

- [ ] **Step 2: Add switch cases**

In the `switch (event.kind)` block in `TimelineEvents.tsx`, add before the `default:` case (before line 208):

```tsx
    case 'dev-review.started':
      return <DevReviewStartedEvent key={event.id} event={event} />;
    case 'dev-review.completed':
      return <DevReviewCompletedEvent key={event.id} event={event} />;
    case 'dev-review.failed':
      return <DevReviewFailedEvent key={event.id} event={event} />;
    case 'dev-review.error':
      return <DevReviewErrorEvent key={event.id} event={event} />;
    case 'dev-review.budget-skipped':
      return <DevReviewBudgetSkippedEvent key={event.id} event={event} />;
    case 'dev-review.response-started':
      return <DevReviewResponseStartedEvent key={event.id} event={event} />;
    case 'dev-review.response-completed':
      return <DevReviewResponseCompletedEvent key={event.id} event={event} />;
    case 'dev-review.response-failed':
      return <DevReviewResponseFailedEvent key={event.id} event={event} />;
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/web && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/detail/components/TimelineEvents.tsx
git commit -m "feat(timeline): wire dev-review.* events into TimelineEvents"
```

---

## Task 4: Issue 3c — Phase-group RenderItem + groupByDevPhase() + PhaseGroupWrapper

**Files:**
- Modify: `apps/web/src/components/detail/lib/timeline.ts`
- Modify: `apps/web/src/components/detail/lib/timeline.test.ts`
- Create: `apps/web/src/components/detail/components/timeline/PhaseGroupWrapper.tsx`
- Modify: `apps/web/src/components/detail/components/TimelineEvents.tsx`

### Step 1: Write failing tests for groupByDevPhase

- [ ] **Step 1a: Add groupByDevPhase tests**

In `apps/web/src/components/detail/lib/timeline.test.ts`, add a new import `groupByDevPhase` and a new describe block. First update the import line to:

```typescript
import { EVENT_KIND_LABEL, computeIsLive, computeIsWritePrdStuck, groupByDevPhase, groupEvents } from './timeline';
```

Then add this describe block at the end of the file:

```typescript
describe('groupByDevPhase', () => {
  it('returns items unchanged when no spec.completed event exists', () => {
    const events: AgentEventDto[] = [
      makeEvent(1, 'state.transitioned', null),
      makeEvent(2, 'agent.run-started', 'run-abc', { payload: { skill: 'investigate' } }),
      makeEvent(3, 'agent.run-completed', 'run-abc'),
    ];
    const grouped = groupEvents(events);
    const result = groupByDevPhase(grouped);
    expect(result).toHaveLength(grouped.length);
    expect(result.some((item) => item.kind === 'phase-group')).toBe(false);
  });

  it('wraps spec.completed + WP runs + pipeline events into a phase-group', () => {
    const PID = 'pipe-xyz-123';
    const events: AgentEventDto[] = [
      // spec-author run (runId === pipelineRunId)
      makeEvent(1, 'agent.run-started', PID, { payload: { skill: 'spec-author' } }),
      makeEvent(2, 'spec.completed', PID, { payload: { pipelineRunId: PID, workItemId: 'github:org/repo#1' } }),
      makeEvent(3, 'agent.run-completed', PID),
      // iteration event (payload.pipelineRunId = PID)
      makeEvent(4, 'parallel-implement.iteration-started', null, {
        payload: { pipelineRunId: PID, iteration: 1, wpCount: 1, wpIds: ['WP1'] },
      }),
      // WP run (runId starts with PID + ':wp:')
      makeEvent(5, 'agent.run-started', `${PID}:wp:WP1:iter:1`, { payload: { skill: 'developer' } }),
      makeEvent(6, 'parallel-implement.wp-started', `${PID}:wp:WP1:iter:1`, {
        payload: { pipelineRunId: PID, wpId: 'WP1' },
      }),
      makeEvent(7, 'agent.run-completed', `${PID}:wp:WP1:iter:1`),
      // unrelated event
      makeEvent(8, 'state.transitioned', null),
    ];

    const grouped = groupEvents(events);
    const result = groupByDevPhase(grouped);

    const phaseGroups = result.filter((item) => item.kind === 'phase-group');
    expect(phaseGroups).toHaveLength(1);

    const pg = phaseGroups[0] as Extract<typeof phaseGroups[0], { kind: 'phase-group' }>;
    expect(pg.phase).toBe('dev');
    expect(pg.pipelineRunId).toBe(PID);

    // unrelated state.transitioned is not inside the group
    const ungrouped = result.filter((item) => item.kind !== 'phase-group');
    expect(ungrouped.some((item) => item.kind === 'event' && item.event.kind === 'state.transitioned')).toBe(true);
  });

  it('groups dev-review.* events with matching pipelineRunId into the phase-group', () => {
    const PID = 'pipe-review-456';
    const events: AgentEventDto[] = [
      makeEvent(1, 'agent.run-started', PID, { payload: { skill: 'spec-author' } }),
      makeEvent(2, 'spec.completed', PID, { payload: { pipelineRunId: PID } }),
      makeEvent(3, 'agent.run-completed', PID),
      makeEvent(4, 'dev-review.started', null, { payload: { pipelineRunId: PID } }),
      makeEvent(5, 'dev-review.completed', null, { payload: { pipelineRunId: PID, verdict: 'proceed' } }),
      makeEvent(6, 'state.transitioned', null),
    ];

    const grouped = groupEvents(events);
    const result = groupByDevPhase(grouped);

    const pg = result.find((item) => item.kind === 'phase-group') as Extract<
      (typeof result)[0],
      { kind: 'phase-group' }
    >;
    expect(pg).toBeDefined();

    const phaseEventKinds = pg.items
      .filter((item) => item.kind === 'event')
      .map((item) => (item as Extract<typeof item, { kind: 'event' }>).event.kind);

    expect(phaseEventKinds).toContain('dev-review.started');
    expect(phaseEventKinds).toContain('dev-review.completed');
  });
});
```

- [ ] **Step 1b: Run test to verify it fails**

```bash
cd apps/web && pnpm vitest run src/components/detail/lib/timeline.test.ts 2>&1 | tail -20
```

Expected: import error — `groupByDevPhase` not exported.

### Step 2: Add phase-group to RenderItem and implement groupByDevPhase

- [ ] **Step 2a: Extend RenderItem in timeline.ts**

In `apps/web/src/components/detail/lib/timeline.ts`, extend the `RenderItem` type at line 107. The current union ends at line 119. Add the new variant:

```typescript
export type RenderItem =
  | { kind: 'event'; event: AgentEventDto }
  | { kind: 'log-group'; events: AgentEventDto[] }
  | {
      kind: 'run-group';
      runId: string;
      items: RenderItem[];
      skill: string | null;
      startedAt: string | null;
      endedAt: string | null;
      lastEventAt: string | null;
      personaId: string | null;
    }
  | {
      kind: 'phase-group';
      phase: 'dev';
      pipelineRunId: string;
      items: RenderItem[];
      startedAt: string | null;
      endedAt: string | null;
    };
```

- [ ] **Step 2b: Add groupByDevPhase function**

In `apps/web/src/components/detail/lib/timeline.ts`, add the following before `groupEvents()` (before line 151):

```typescript
export function groupByDevPhase(items: RenderItem[]): RenderItem[] {
  // Find all pipelineRunIds anchored by spec.completed events.
  const pipelines = new Set<string>();
  for (const item of items) {
    if (item.kind !== 'event') continue;
    if (item.event.kind !== 'spec.completed') continue;
    const p = item.event.payload as { pipelineRunId?: string } | null;
    if (p?.pipelineRunId != null) pipelines.add(p.pipelineRunId);
  }

  if (pipelines.size === 0) return items;

  function resolvedPipelineId(item: RenderItem): string | null {
    if (item.kind === 'run-group') {
      if (pipelines.has(item.runId)) return item.runId;
      for (const pid of pipelines) {
        if (item.runId.startsWith(`${pid}:wp:`)) return pid;
      }
      return null;
    }
    if (item.kind === 'event') {
      const p = item.event.payload as { pipelineRunId?: string } | null;
      if (p?.pipelineRunId != null && pipelines.has(p.pipelineRunId)) return p.pipelineRunId;
      return null;
    }
    return null;
  }

  const pipelineItems = new Map<string, RenderItem[]>();
  for (const pid of pipelines) pipelineItems.set(pid, []);

  const ungrouped: RenderItem[] = [];
  for (const item of items) {
    const pid = resolvedPipelineId(item);
    if (pid != null) {
      pipelineItems.get(pid)!.push(item);
    } else {
      ungrouped.push(item);
    }
  }

  const phaseGroups: RenderItem[] = [];
  for (const [pid, phaseItemList] of pipelineItems) {
    if (phaseItemList.length === 0) continue;
    const timestamps: number[] = [];
    for (const item of phaseItemList) {
      if (item.kind === 'event') timestamps.push(new Date(item.event.createdAt).getTime());
      else if (item.kind === 'run-group') {
        if (item.startedAt) timestamps.push(new Date(item.startedAt).getTime());
        if (item.endedAt) timestamps.push(new Date(item.endedAt).getTime());
      }
    }
    const startedAt = timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : null;
    const endedAt = timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null;
    phaseGroups.push({
      kind: 'phase-group',
      phase: 'dev',
      pipelineRunId: pid,
      items: phaseItemList,
      startedAt,
      endedAt,
    });
  }

  return [...ungrouped, ...phaseGroups];
}
```

- [ ] **Step 2c: Call groupByDevPhase from groupEvents**

In `apps/web/src/components/detail/lib/timeline.ts`, update `groupEvents()` (currently around line 151) to call `groupByDevPhase` as a final step:

```typescript
export function groupEvents(events: AgentEventDto[]): RenderItem[] {
  const collapsed = collapseLogRuns(events);
  const grouped = groupByRunId(collapsed);
  const withDevPhases = groupByDevPhase([...grouped].sort(compareRenderItems));
  return withDevPhases;
}
```

- [ ] **Step 2d: Run timeline tests**

```bash
cd apps/web && pnpm vitest run src/components/detail/lib/timeline.test.ts
```

Expected: all pass, including the 3 new groupByDevPhase tests.

### Step 3: Create PhaseGroupWrapper.tsx

- [ ] **Step 3a: Create the file**

Create `apps/web/src/components/detail/components/timeline/PhaseGroupWrapper.tsx`:

```tsx
import type { RenderItem, TimelineContext } from '../../lib/timeline';
import { formatDuration } from '../../lib/timeline';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';

export function PhaseGroupWrapper({
  pipelineRunId,
  items,
  startedAt,
  endedAt,
  context,
  renderItem,
}: {
  pipelineRunId: string;
  items: RenderItem[];
  startedAt: string | null;
  endedAt: string | null;
  context?: TimelineContext;
  renderItem: (item: RenderItem, idx: number, context?: TimelineContext) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const expandTick = context?.expandSignal?.tick ?? 0;
  const expandOpen = context?.expandSignal?.open ?? true;
  useEffect(() => {
    if (expandTick === 0) return;
    setOpen(expandOpen);
  }, [expandTick, expandOpen]);

  const startMs = startedAt != null ? new Date(startedAt).getTime() : null;
  const endMs = endedAt != null ? new Date(endedAt).getTime() : null;
  const duration = startMs != null && endMs != null ? formatDuration(endMs - startMs) : null;
  const shortId = pipelineRunId.length > 8 ? pipelineRunId.slice(0, 8) : pipelineRunId;

  return (
    <li data-pipeline-run-id={pipelineRunId} className="rounded-md border border-[color:var(--accent)]/20 bg-bg/30">
      <details
        open={open}
        onToggle={(e) => {
          e.stopPropagation();
          setOpen((e.target as HTMLDetailsElement).open);
        }}
      >
        <summary className="flex items-center gap-2 cursor-pointer list-none px-4 py-2 font-mono text-[11px] select-none">
          <span className="shrink-0">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <span className="font-mono uppercase tracking-wider text-[color:var(--accent)] text-[10.5px]">
            Dev Phase
          </span>
          <span aria-hidden className="w-[3px] h-[3px] shrink-0 rounded-full bg-fg-4" />
          <span className="font-mono text-fg-5 text-[10.5px]">pipeline {shortId}</span>
          {duration != null && (
            <>
              <span aria-hidden className="w-[3px] h-[3px] shrink-0 rounded-full bg-fg-4" />
              <span className="text-fg-5 text-[10.5px]">{duration}</span>
            </>
          )}
          {startedAt != null && (
            <>
              <span aria-hidden className="w-[3px] h-[3px] shrink-0 rounded-full bg-fg-4" />
              <span className="text-fg-5 text-[10.5px]">
                Started {new Date(startedAt).toLocaleTimeString()}
              </span>
            </>
          )}
          <span className="ml-auto shrink-0 text-fg-5">{items.length} events</span>
        </summary>
        <ol className="flex flex-col gap-2 px-3 pb-3">
          {items.map((item, i) => renderItem(item, i, context))}
        </ol>
      </details>
    </li>
  );
}
```

### Step 4: Handle phase-group in TimelineEvents.tsx

- [ ] **Step 4a: Add PhaseGroupWrapper import and phase-group case**

In `apps/web/src/components/detail/components/TimelineEvents.tsx`, add import after `RunGroupWrapper`:

```tsx
import { PhaseGroupWrapper } from './timeline/PhaseGroupWrapper';
```

In `renderTimelineItem`, add a handler for `phase-group` immediately after the `run-group` handler (after the closing `}` of the `run-group` block, before `const { event } = item;`):

```tsx
  if (item.kind === 'phase-group') {
    return (
      <PhaseGroupWrapper
        key={`phase-group-${item.pipelineRunId}`}
        pipelineRunId={item.pipelineRunId}
        items={item.items}
        startedAt={item.startedAt}
        endedAt={item.endedAt}
        context={context}
        renderItem={renderTimelineItem}
      />
    );
  }
```

- [ ] **Step 4b: Typecheck**

```bash
cd apps/web && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4c: Run all timeline tests**

```bash
cd apps/web && pnpm vitest run src/components/detail/
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/detail/lib/timeline.ts apps/web/src/components/detail/lib/timeline.test.ts apps/web/src/components/detail/components/timeline/PhaseGroupWrapper.tsx apps/web/src/components/detail/components/TimelineEvents.tsx
git commit -m "feat(timeline): add phase-group RenderItem, groupByDevPhase, PhaseGroupWrapper"
```

---

## Task 5: Issue 1a — Server spec route

**Files:**
- Modify: `apps/server/src/domains/issues/service.ts`
- Modify: `apps/server/src/domains/issues/router.ts`
- Modify: `apps/server/src/domains/issues/router.test.ts`

- [ ] **Step 1: Write failing route test**

In `apps/server/src/domains/issues/router.test.ts`, add `mockGetIssueSpec` to the `vi.hoisted` block:

In the `vi.hoisted(() => ({` destructure, add:
```typescript
  mockGetIssueSpec: vi.fn(),
```

In the `vi.mock('./service.js', ...)` factory, add:
```typescript
  getIssueSpec: mockGetIssueSpec,
```

Then add this describe block before the final closing of the file:

```typescript
describe('GET /:slug/issues/:id/spec', () => {
  it('returns spec when found', async () => {
    mockGetIssueSpec.mockResolvedValue({
      ok: true,
      data: {
        spec: {
          pipelineRunId: 'pipe-abc',
          objective: 'Add feature X',
          workPackages: [{ id: 'WP1', filesOwned: ['src/foo.ts'], builderTier: 'sonnet' }],
          acceptanceCriteriaCount: 3,
        },
      },
    });

    const res = await app.request('/test-slug/issues/42/spec');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.spec.objective).toBe('Add feature X');
    expect(body.spec.workPackages).toHaveLength(1);
    expect(body.spec.acceptanceCriteriaCount).toBe(3);
  });

  it('returns spec: null when not found', async () => {
    mockGetIssueSpec.mockResolvedValue({ ok: true, data: { spec: null } });

    const res = await app.request('/test-slug/issues/42/spec');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.spec).toBeNull();
  });

  it('returns 404 when project not found', async () => {
    mockGetIssueSpec.mockResolvedValue({ ok: false, error: 'project not found', status: 404 });

    const res = await app.request('/test-slug/issues/42/spec');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/server && pnpm vitest run src/domains/issues/router.test.ts 2>&1 | tail -20
```

Expected: fails — `mockGetIssueSpec` is not called since route doesn't exist yet.

- [ ] **Step 3: Add getIssueSpec to service.ts**

In `apps/server/src/domains/issues/service.ts`, add this import at the top alongside existing imports:

```typescript
import { getEngineeringSpec } from '@goose-hub/core/engineering-specs/repository.js';
```

Then add the function after `getIssue()` (around line 83):

```typescript
export async function getIssueSpec(
  slug: string,
  id: string,
): Promise<Result<{ spec: {
  pipelineRunId: string;
  objective: string;
  workPackages: Array<{ id: string; filesOwned: string[]; builderTier: string }>;
  acceptanceCriteriaCount: number;
} | null }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const repoRef = await getRepoRef(slug);
  const workItemId = `github:${repoRef}#${id}`;
  const record = getEngineeringSpec(slug, workItemId);
  if (record == null) return { ok: true, data: { spec: null } };
  const spec = record.spec as {
    objective: string;
    workPackages: Array<{ id: string; filesOwned: string[]; builderTier: string }>;
    acceptanceCriteria: unknown[];
  };
  return {
    ok: true,
    data: {
      spec: {
        pipelineRunId: record.pipelineRunId,
        objective: spec.objective,
        workPackages: spec.workPackages.map((wp) => ({
          id: wp.id,
          filesOwned: wp.filesOwned,
          builderTier: wp.builderTier,
        })),
        acceptanceCriteriaCount: spec.acceptanceCriteria.length,
      },
    },
  };
}
```

- [ ] **Step 4: Add route to router.ts**

In `apps/server/src/domains/issues/router.ts`, add `getIssueSpec` to the import from `'./service.js'`:

```typescript
import {
  approveIssue,
  approvePRD,
  commentOnIssue,
  declinePRD,
  fakeRun,
  getIssue,
  getIssueComments,
  getIssueEvents,
  getIssueSpec,
  getIssueTriage,
  getIssueWorktreeDiff,
  listIssues,
  overrideIssueRepo,
  proceedToPrd,
  rejectIssue,
  rejectPRD,
  revisePRD,
  setIssueLabel,
  setIssueMilestone,
  transitionIssue,
} from './service.js';
```

Then add the route after the existing `/diff` route (after line 69):

```typescript
router.get('/:slug/issues/:id/spec', async (c) => {
  const result = await getIssueSpec(c.req.param('slug'), c.req.param('id'));
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});
```

- [ ] **Step 5: Run router tests**

```bash
cd apps/server && pnpm vitest run src/domains/issues/router.test.ts
```

Expected: all pass including the 3 new spec tests.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/domains/issues/service.ts apps/server/src/domains/issues/router.ts apps/server/src/domains/issues/router.test.ts
git commit -m "feat(server): add GET /projects/:slug/issues/:id/spec route"
```

---

## Task 6: Issue 1b — Web spec fetch, SpecDetails component, InvestigationSection wiring

**Files:**
- Modify: `apps/web/src/lib/types.ts`
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/components/detail/components/SpecDetails.tsx`
- Create: `apps/web/src/components/detail/components/SpecDetails.test.tsx`
- Modify: `apps/web/src/components/detail/components/InvestigationSection.tsx`

- [ ] **Step 1: Write failing SpecDetails test**

Create `apps/web/src/components/detail/components/SpecDetails.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { EngineeringSpecDto } from '@/lib/types';
import { SpecDetails } from './SpecDetails';

afterEach(cleanup);

const SPEC: EngineeringSpecDto = {
  pipelineRunId: 'pipe-test-123',
  objective: 'Build the authentication flow with token refresh.',
  workPackages: [
    { id: 'WP1', filesOwned: ['src/auth/login.ts', 'src/auth/token.ts'], builderTier: 'sonnet' },
    { id: 'WP2', filesOwned: ['src/auth/middleware.ts'], builderTier: 'haiku' },
  ],
  acceptanceCriteriaCount: 5,
};

describe('SpecDetails', () => {
  it('renders nothing when itemState is before dev-ready', () => {
    const { container } = render(
      <SpecDetails spec={SPEC} itemState="factory:investigation-complete" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders collapsed header when state is factory:dev-ready', () => {
    render(<SpecDetails spec={SPEC} itemState="factory:dev-ready" />);
    expect(screen.getByText('Engineering Spec')).toBeTruthy();
    expect(screen.getByText('2 work packages · 5 AC')).toBeTruthy();
    // body content hidden until expanded
    expect(screen.queryByText('Build the authentication flow with token refresh.')).toBeNull();
  });

  it('expands to show objective, work packages table, and AC count on click', async () => {
    render(<SpecDetails spec={SPEC} itemState="factory:dev-ready" />);
    await userEvent.click(screen.getByText('Engineering Spec'));
    expect(screen.getByText('Build the authentication flow with token refresh.')).toBeTruthy();
    expect(screen.getByText('WP1')).toBeTruthy();
    expect(screen.getByText('WP2')).toBeTruthy();
    expect(screen.getByText('sonnet')).toBeTruthy();
    expect(screen.getByText('haiku')).toBeTruthy();
    expect(screen.getByText('5 acceptance criteria')).toBeTruthy();
  });

  it('renders when state is factory:in-progress', () => {
    render(<SpecDetails spec={SPEC} itemState="factory:in-progress" />);
    expect(screen.getByText('Engineering Spec')).toBeTruthy();
  });

  it('renders when state is factory:spec-ready', () => {
    render(<SpecDetails spec={SPEC} itemState="factory:spec-ready" />);
    expect(screen.getByText('Engineering Spec')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web && pnpm vitest run src/components/detail/components/SpecDetails.test.tsx
```

Expected: fails — module not found.

- [ ] **Step 3: Add types to types.ts**

In `apps/web/src/lib/types.ts`, add these interfaces after `WorkItemDto`:

```typescript
export interface WorkPackageDto {
  id: string;
  filesOwned: string[];
  builderTier: string;
}

export interface EngineeringSpecDto {
  pipelineRunId: string;
  objective: string;
  workPackages: WorkPackageDto[];
  acceptanceCriteriaCount: number;
}
```

- [ ] **Step 4: Add fetchEngineeringSpec to api.ts**

In `apps/web/src/lib/api.ts`, add this import to the types import at the top:

```typescript
import type {
  // ... existing imports ...
  EngineeringSpecDto,
  // ... etc
} from './types.js';
```

Then add the function anywhere after the helper functions:

```typescript
export async function fetchEngineeringSpec(
  slug: string,
  id: string,
): Promise<EngineeringSpecDto | null> {
  const { spec } = await getJson<{ spec: EngineeringSpecDto | null }>(
    `/projects/${slug}/issues/${id}/spec`,
  );
  return spec;
}
```

- [ ] **Step 5: Create SpecDetails.tsx**

Create `apps/web/src/components/detail/components/SpecDetails.tsx`:

```tsx
import type { EngineeringSpecDto } from '@/lib/types';
import { ChevronDown, ChevronRight, ClipboardCheck, Package } from 'lucide-react';
import { useState } from 'react';

const DEV_OR_LATER_STATES = new Set([
  'factory:dev-ready',
  'factory:spec-ready',
  'factory:in-progress',
  'factory:needs-qa',
  'factory:needs-review',
  'factory:review-approved',
  'factory:merged',
  'factory:retrospecting',
  'factory:done',
]);

export function SpecDetails({
  spec,
  itemState,
}: {
  spec: EngineeringSpecDto;
  itemState?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!DEV_OR_LATER_STATES.has(itemState ?? '')) return null;

  const wpCount = spec.workPackages.length;

  return (
    <div className="rounded-lg border border-[color:var(--accent)]/20 bg-bg-elev overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-bg-elev-2 text-left cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <Package size={12} className="shrink-0 text-[color:var(--accent)]" />
          <span className="text-[10.5px] uppercase tracking-wider text-fg-2">Engineering Spec</span>
          <span className="text-[11px] text-fg-4">
            {wpCount} work package{wpCount !== 1 ? 's' : ''} · {spec.acceptanceCriteriaCount} AC
          </span>
        </div>
        <span className="shrink-0 text-fg-4">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>

      {open && (
        <div className="px-4 py-4 flex flex-col gap-4 border-t border-line">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-fg-3 mb-1">Objective</div>
            <p className="text-[12.5px] text-fg-2 leading-relaxed">{spec.objective}</p>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-fg-3 mb-2">Work packages</div>
            <div className="rounded border border-line overflow-hidden">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="border-b border-line bg-bg-elev-2">
                    <th className="px-3 py-2 text-left text-fg-3 font-medium w-20">ID</th>
                    <th className="px-3 py-2 text-left text-fg-3 font-medium">Files owned</th>
                    <th className="px-3 py-2 text-left text-fg-3 font-medium w-20">Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {spec.workPackages.map((wp) => (
                    <tr key={wp.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 font-mono text-fg-2 whitespace-nowrap">{wp.id}</td>
                      <td className="px-3 py-2">
                        {wp.filesOwned.map((f) => (
                          <div key={f} className="font-mono text-[10.5px] text-fg-4 truncate">
                            {f}
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-2 font-mono text-fg-4 whitespace-nowrap">
                        {wp.builderTier}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11.5px] text-fg-3">
            <ClipboardCheck size={12} className="text-fg-4 shrink-0" />
            <span>{spec.acceptanceCriteriaCount} acceptance criteria</span>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run SpecDetails tests**

```bash
cd apps/web && pnpm vitest run src/components/detail/components/SpecDetails.test.tsx
```

Expected: all 5 pass.

- [ ] **Step 7: Wire SpecDetails into InvestigationSection.tsx**

In `apps/web/src/components/detail/components/InvestigationSection.tsx`, add these imports at the top alongside existing ones:

```typescript
import { fetchEngineeringSpec } from '@/lib/api';
import type { EngineeringSpecDto } from '@/lib/types';
import { SpecDetails } from './SpecDetails';
```

Add the spec query inside `InvestigationSection()`, after the `{ byStage }` line (around line 62):

```typescript
  const { data: spec } = useQuery<EngineeringSpecDto | null>({
    queryKey: ['spec', projectSlug, id],
    queryFn: () => fetchEngineeringSpec(projectSlug, id),
  });
```

Then in the JSX, add `<SpecDetails>` after the key files block and before the open questions block (after the `</div>` that closes the key files section, around line 256). Wrap it in a conditional:

```tsx
      {spec != null && (
        <SpecDetails spec={spec} itemState={itemState} />
      )}
```

- [ ] **Step 8: Run typecheck**

```bash
cd apps/web && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9: Run all server and web tests**

```bash
cd apps/server && pnpm vitest run && cd ../apps/web && pnpm vitest run
```

Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/types.ts apps/web/src/lib/api.ts apps/web/src/components/detail/components/SpecDetails.tsx apps/web/src/components/detail/components/SpecDetails.test.tsx apps/web/src/components/detail/components/InvestigationSection.tsx
git commit -m "feat(web): add SpecDetails component and wire into InvestigationSection"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|---|---|
| GET /projects/:slug/issues/:number/spec | Task 5 |
| fetchEngineeringSpec in lib/api.ts | Task 6 |
| SpecDetails collapsible block (objective, WP table, AC count) | Task 6 |
| Only visible at factory:dev-ready or later | Task 6 |
| 8 missing dev-review.* labels in EVENT_KIND_LABEL | Task 1 |
| DevReviewEvents.tsx component | Task 2 |
| Switch cases in TimelineEvents.tsx | Task 3 |
| phase-group RenderItem variant | Task 4 |
| groupByDevPhase() in timeline.ts | Task 4 |
| PhaseGroupWrapper.tsx with 'dev' phase | Task 4 |
| pipelineRunId-based grouping (WP runs, spec-author run) | Task 4 |

All requirements covered.

### Placeholder Scan

No TBDs, TODOs, or "similar to Task N" shortcuts found. All code blocks are complete.

### Type Consistency

- `EngineeringSpecDto` defined in Task 6 Step 3 and used in Steps 4, 5, 7 — consistent.
- `WorkPackageDto` defined in Step 3 and used in Step 5 — consistent.
- `phase-group` RenderItem defined in Task 4 Step 2a; consumed in PhaseGroupWrapper (Step 3a) and TimelineEvents (Step 4a) — consistent.
- `groupByDevPhase` exported from timeline.ts (Step 2b), imported in test (Step 1a) — consistent.
- Server `getIssueSpec` defined in Task 5 Step 3, imported in router Task 5 Step 4, mocked in router.test Task 5 Step 1 — consistent.
