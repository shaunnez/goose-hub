# Pending Next Run Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a thin informational banner above the timeline when a work item is in an auto-trigger state but no agent run is currently active.

**Architecture:** Add a `PENDING_NEXT_RUN_STATES` map to constants, extract a pure `computeIsLive(events)` helper, create a self-contained `PendingNextRunBanner` component that fetches events and shows the banner only during the gap between runs. Wire into `DetailPage.tsx` below `GatePendingBanner`.

**Tech Stack:** React, @tanstack/react-query, lucide-react, Tailwind via `cn`

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `apps/web/src/lib/constants.ts` | Add `PENDING_NEXT_RUN_STATES` |
| Create | `apps/web/src/components/detail/components/PendingNextRunBanner.tsx` | Banner component + `computeIsLive` |
| Create | `apps/web/src/components/detail/components/PendingNextRunBanner.test.tsx` | Unit tests for `computeIsLive` and component |
| Modify | `apps/web/src/components/detail/components/DetailPage.tsx` | Import + render banner |

---

### Task 1: Add `PENDING_NEXT_RUN_STATES` constant

**Files:**
- Modify: `apps/web/src/lib/constants.ts`

- [ ] **Step 1: Add the constant after `GATE_STATES`**

In `apps/web/src/lib/constants.ts`, after the `GATE_STATES` block (currently ends around line 98), add:

```ts
export const PENDING_NEXT_RUN_STATES: Record<string, string> = {
  'factory:triaging':      'triage',
  'factory:grilling':      'grill-me',
  'factory:prd-drafting':  'write-prd',
  'factory:decomposing':   'decompose-issues',
  'factory:dev-ready':     'implement',
  'factory:in-progress':   'implement',
  'factory:needs-qa':      'qa',
  'factory:needs-fix':     'fix-issue',
  'factory:retrospecting': 'retrospective',
};
```

- [ ] **Step 2: Verify no overlap with GATE_STATES**

Run:
```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm typecheck 2>&1 | grep constants
```
Expected: no output (no errors).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/constants.ts
git commit -m "feat(web): add PENDING_NEXT_RUN_STATES constant"
```

---

### Task 2: Create `PendingNextRunBanner` with `computeIsLive`

**Files:**
- Create: `apps/web/src/components/detail/components/PendingNextRunBanner.tsx`
- Create: `apps/web/src/components/detail/components/PendingNextRunBanner.test.tsx`

- [ ] **Step 1: Write failing tests for `computeIsLive`**

Create `apps/web/src/components/detail/components/PendingNextRunBanner.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { computeIsLive } from './PendingNextRunBanner';
import type { AgentEventDto } from '@/lib/types';

function makeEvent(kind: string, id: number): AgentEventDto {
  return {
    id,
    projectId: 'proj',
    workItemId: 'item',
    kind,
    payload: {},
    runId: 'run-1',
    personaId: null,
    createdAt: new Date(id * 1000).toISOString(),
  };
}

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

  it('returns false when run-started followed by agent.run-failed', () => {
    const events = [makeEvent('agent.run-started', 1), makeEvent('agent.run-failed', 2)];
    expect(computeIsLive(events)).toBe(false);
  });

  it('returns false when run-started followed by grill.question-posted', () => {
    const events = [makeEvent('agent.run-started', 1), makeEvent('grill.question-posted', 2)];
    expect(computeIsLive(events)).toBe(false);
  });

  it('returns false when run-started followed by grill.completed', () => {
    const events = [makeEvent('agent.run-started', 1), makeEvent('grill.completed', 2)];
    expect(computeIsLive(events)).toBe(false);
  });

  it('returns false when run-started followed by decompose.completed', () => {
    const events = [makeEvent('agent.run-started', 1), makeEvent('decompose.completed', 2)];
    expect(computeIsLive(events)).toBe(false);
  });

  it('returns false when run-started followed by retrospective.completed', () => {
    const events = [makeEvent('agent.run-started', 1), makeEvent('retrospective.completed', 2)];
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm vitest run apps/web/src/components/detail/components/PendingNextRunBanner.test.tsx 2>&1 | tail -10
```
Expected: fail with "Cannot find module './PendingNextRunBanner'"

- [ ] **Step 3: Create the component**

Create `apps/web/src/components/detail/components/PendingNextRunBanner.tsx`:

```tsx
import { fetchEvents } from '@/lib/api';
import { cn } from '@/lib/cn';
import { PENDING_NEXT_RUN_STATES } from '@/lib/constants';
import type { AgentEventDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react';

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
  let lastStartedIdx = -1;
  for (let i = 0; i < events.length; i++) {
    if (events[i].kind === 'agent.run-started') lastStartedIdx = i;
  }
  if (lastStartedIdx === -1) return false;
  for (let i = lastStartedIdx + 1; i < events.length; i++) {
    if (TERMINAL_EVENTS.has(events[i].kind)) return false;
  }
  return true;
}

interface PendingNextRunBannerProps {
  state?: string;
  projectSlug?: string;
  id?: string;
}

export function PendingNextRunBanner({ state, projectSlug, id }: PendingNextRunBannerProps) {
  const skillName = state != null ? PENDING_NEXT_RUN_STATES[state] : undefined;

  const { data: events = [] } = useQuery({
    queryKey: ['events', projectSlug, id],
    queryFn: () => fetchEvents(projectSlug ?? '', id ?? ''),
    enabled: skillName != null && !!projectSlug && !!id,
    refetchInterval: 5000,
  });

  if (skillName == null) return null;
  if (computeIsLive(events)) return null;

  return (
    <div
      data-testid="pending-next-run-banner"
      className={cn(
        'flex items-center gap-2.5 px-6 py-2.5 shrink-0',
        'border-b border-fg-3/20 bg-fg-3/5',
        'text-[12.5px] font-medium text-fg-3',
      )}
    >
      <Clock size={14} className="shrink-0" />
      <span>Next run pending · {skillName}</span>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm vitest run apps/web/src/components/detail/components/PendingNextRunBanner.test.tsx 2>&1 | tail -10
```
Expected: all tests pass.

- [ ] **Step 5: Typecheck**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm typecheck 2>&1 | grep -E "PendingNextRun|constants"
```
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/detail/components/PendingNextRunBanner.tsx \
        apps/web/src/components/detail/components/PendingNextRunBanner.test.tsx
git commit -m "feat(web): add PendingNextRunBanner component"
```

---

### Task 3: Wire into DetailPage

**Files:**
- Modify: `apps/web/src/components/detail/components/DetailPage.tsx`

- [ ] **Step 1: Add import**

In `apps/web/src/components/detail/components/DetailPage.tsx`, add after the `GatePendingBanner` import (line 15):

```ts
import { PendingNextRunBanner } from './PendingNextRunBanner';
```

- [ ] **Step 2: Render banner below GatePendingBanner**

Find the `<GatePendingBanner ... />` block (around line 219) and add `PendingNextRunBanner` immediately after:

```tsx
<GatePendingBanner
  state={item?.state}
  projectSlug={slug}
  id={id}
  onTransitioned={() => {
    void queryClient.invalidateQueries({ queryKey: ['issue', slug, id] });
    void queryClient.invalidateQueries({ queryKey: ['issues', slug] });
  }}
/>
<PendingNextRunBanner state={item?.state} projectSlug={slug} id={id} />
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm typecheck 2>&1 | grep -v "^$"
```
Expected: no errors (or only the pre-existing milestone mock errors).

- [ ] **Step 4: Lint**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm biome check apps/web/src/components/detail/components/DetailPage.tsx apps/web/src/components/detail/components/PendingNextRunBanner.tsx 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/detail/components/DetailPage.tsx
git commit -m "feat(web): wire PendingNextRunBanner into DetailPage"
```

---

## Self-Review

**Spec coverage:**
- ✅ PENDING_NEXT_RUN_STATES constant — Task 1
- ✅ computeIsLive gap detection — Task 2
- ✅ Banner renders for auto-trigger states — Task 2
- ✅ Banner hidden when run is live — Task 2 (computeIsLive)
- ✅ Banner hidden for gate states — Task 2 (skillName == null guard)
- ✅ Wired into DetailPage below GatePendingBanner — Task 3
- ✅ Tests for computeIsLive — Task 2 (all terminal event types covered)

**Placeholder scan:** None found.

**Type consistency:**
- `computeIsLive(events: AgentEventDto[]): boolean` — defined and used consistently
- `PENDING_NEXT_RUN_STATES` — defined in constants, imported in component
- `PendingNextRunBanner` — exported from component, imported in DetailPage
