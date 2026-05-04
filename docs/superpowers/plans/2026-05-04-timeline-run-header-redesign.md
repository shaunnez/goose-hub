# Timeline Run Header Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw GUID + ISO timestamp in timeline run headers with a human-readable skill-derived title, live/complete status badge, duration display, GUID tooltip, and an in-progress loading card.

**Architecture:** Extend the `run-group` `RenderItem` variant with computed metadata (`skill`, `startedAt`, `endedAt`) populated in `groupByRunId`. `RunGroupWrapper` reads these fields directly — no prop-drilling, no re-computation at render time. Live timer is a `useState`/`useEffect` interval local to the wrapper.

**Tech Stack:** TypeScript, React, Vitest, Tailwind/CSS vars (existing)

---

## File Map

| File | Change |
|---|---|
| `apps/web/src/components/detail/lib/timeline.ts` | Extend `RenderItem` type; add `extractRunMeta`; populate in `groupByRunId` |
| `apps/web/src/components/detail/components/TimelineSection.tsx` | Add `formatSkillName`, `formatDuration`; rewrite `RunGroupWrapper`; delete `getRunStartedAt` |
| `apps/web/src/components/detail/components/TimelineSection.test.ts` | Add metadata assertions to run-group tests |

---

## Task 1: Extend `RenderItem` type and populate metadata in `groupByRunId`

**Files:**
- Modify: `apps/web/src/components/detail/lib/timeline.ts`

- [ ] **Step 1: Update the `RenderItem` type**

In `timeline.ts`, replace the `run-group` variant:

```ts
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
    };
```

- [ ] **Step 2: Add `extractRunMeta` helper**

Add this function above `groupByRunId` in `timeline.ts`:

```ts
function extractRunMeta(items: RenderItem[]): {
  skill: string | null;
  startedAt: string | null;
  endedAt: string | null;
} {
  let skill: string | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let earliestMs = Number.POSITIVE_INFINITY;
  let earliestIso: string | null = null;

  for (const item of items) {
    if (item.kind !== 'event') continue;
    const ev = item.event;
    const p = ev.payload as { skill?: string } | null;

    const ms = new Date(ev.createdAt).getTime();
    if (ms < earliestMs) {
      earliestMs = ms;
      earliestIso = ev.createdAt;
    }

    if (ev.kind === 'agent.run-started') {
      if (startedAt == null) startedAt = ev.createdAt;
      if (skill == null && p?.skill != null) skill = p.skill;
    } else if (ev.kind === 'agent.spawned') {
      if (skill == null && p?.skill != null) skill = p.skill;
    } else if (ev.kind === 'agent.run-completed') {
      if (skill == null && p?.skill != null) skill = p.skill;
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (ev.kind === 'agent.run-failed') {
      if (endedAt == null) endedAt = ev.createdAt;
    }
  }

  return { skill, startedAt: startedAt ?? earliestIso, endedAt };
}
```

- [ ] **Step 3: Use `extractRunMeta` in `groupByRunId`**

In `groupByRunId`, replace the line that pushes a `run-group`:

```ts
// Before:
result.push({ kind: 'run-group', runId, items: group });

// After:
const meta = extractRunMeta(group);
result.push({ kind: 'run-group', runId, items: group, ...meta });
```

- [ ] **Step 4: Run typecheck**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm --filter @goose-hub/web exec tsc --noEmit 2>&1 | tail -20
```

Expected: no errors. If errors, fix before continuing.

---

## Task 2: Add metadata assertions to run-group tests

**Files:**
- Modify: `apps/web/src/components/detail/components/TimelineSection.test.ts`

- [ ] **Step 1: Update `makeRunEvent` to support skill in payload**

Replace the existing `makeRunEvent` helper:

```ts
function makeRunEvent(
  id: number,
  runId: string,
  kind = 'agent.run-started',
  skill?: string,
): AgentEventDto {
  return {
    id,
    projectId: 'proj',
    workItemId: 'wi-1',
    kind,
    payload: skill != null ? { skill } : {},
    runId,
    createdAt: new Date(Date.now() + id * 1000).toISOString(),
  };
}
```

Note: `Date.now() + id * 1000` ensures unique, ascending timestamps per id.

- [ ] **Step 2: Add metadata tests**

Append a new `describe` block at the end of the test file:

```ts
describe('groupEvents — run-group metadata', () => {
  it('extracts skill from agent.run-started payload', () => {
    const events: AgentEventDto[] = [
      makeRunEvent(1, 'run-abc', 'agent.run-started', 'implement'),
      makeRunEvent(2, 'run-abc', 'agent.tool-call'),
      makeRunEvent(3, 'run-abc', 'agent.run-completed'),
    ];
    const result = groupEvents(events);
    expect(result).toHaveLength(1);
    if (result[0].kind === 'run-group') {
      expect(result[0].skill).toBe('implement');
      expect(result[0].startedAt).toBe(events[0].createdAt);
      expect(result[0].endedAt).toBe(events[2].createdAt);
    }
  });

  it('falls back to agent.spawned skill when run-started has no skill', () => {
    const events: AgentEventDto[] = [
      makeRunEvent(1, 'run-abc', 'agent.run-started'),
      { ...makeRunEvent(2, 'run-abc', 'agent.spawned'), payload: { skill: 'triage' } },
      makeRunEvent(3, 'run-abc', 'agent.run-completed'),
    ];
    const result = groupEvents(events);
    if (result[0].kind === 'run-group') {
      expect(result[0].skill).toBe('triage');
    }
  });

  it('sets skill to null when no skill found in any event', () => {
    const events: AgentEventDto[] = [
      makeRunEvent(1, 'run-abc', 'agent.run-started'),
      makeRunEvent(2, 'run-abc', 'agent.run-completed'),
    ];
    const result = groupEvents(events);
    if (result[0].kind === 'run-group') {
      expect(result[0].skill).toBeNull();
    }
  });

  it('sets endedAt to null when run has no completed/failed event', () => {
    const events: AgentEventDto[] = [
      makeRunEvent(1, 'run-abc', 'agent.run-started', 'implement'),
      makeRunEvent(2, 'run-abc', 'agent.tool-call'),
    ];
    const result = groupEvents(events);
    if (result[0].kind === 'run-group') {
      expect(result[0].endedAt).toBeNull();
    }
  });

  it('uses earliest event timestamp as startedAt fallback when no run-started event', () => {
    const t1 = new Date(Date.now()).toISOString();
    const t2 = new Date(Date.now() + 2000).toISOString();
    const events: AgentEventDto[] = [
      { ...makeRunEvent(1, 'run-abc', 'agent.tool-call'), createdAt: t1 },
      { ...makeRunEvent(2, 'run-abc', 'agent.run-completed'), createdAt: t2 },
    ];
    const result = groupEvents(events);
    if (result[0].kind === 'run-group') {
      expect(result[0].startedAt).toBe(t1);
    }
  });

  it('extracts endedAt from agent.run-failed', () => {
    const events: AgentEventDto[] = [
      makeRunEvent(1, 'run-abc', 'agent.run-started', 'qa'),
      makeRunEvent(2, 'run-abc', 'agent.run-failed'),
    ];
    const result = groupEvents(events);
    if (result[0].kind === 'run-group') {
      expect(result[0].endedAt).toBe(events[1].createdAt);
    }
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm --filter @goose-hub/web exec vitest run src/components/detail/components/TimelineSection.test.ts 2>&1 | tail -30
```

Expected: all tests pass. If the new tests fail, fix `extractRunMeta` in `timeline.ts`.

- [ ] **Step 4: Commit**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && git add apps/web/src/components/detail/lib/timeline.ts apps/web/src/components/detail/components/TimelineSection.test.ts && git commit -m "feat(timeline): extend run-group type with skill/startedAt/endedAt metadata"
```

---

## Task 3: Rewrite `RunGroupWrapper` with new header and loading card

**Files:**
- Modify: `apps/web/src/components/detail/components/TimelineSection.tsx`

- [ ] **Step 1: Add `formatSkillName` and `formatDuration` helpers**

Add these two functions after the `getPayloadStr` function (around line 66), before the individual event renderers:

```ts
function formatSkillName(skill: string | null): string {
  if (skill == null) return '(Unknown)';
  return skill
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
```

- [ ] **Step 2: Add `Loader2` to lucide imports**

At the top of `TimelineSection.tsx`, add `Loader2` to the lucide-react import:

```ts
import {
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Circle,
  ExternalLink,
  FileCode,
  GitPullRequest,
  Info,
  Loader2,
  Sparkles,
  Tag,
  Target,
  Terminal,
  User,
  Wrench,
  XCircle,
} from 'lucide-react';
```

- [ ] **Step 3: Delete `getRunStartedAt`**

Remove the entire `getRunStartedAt` function (lines ~546-564 in the original file). It is replaced by `startedAt` on the `run-group` type.

- [ ] **Step 4: Rewrite `RunGroupWrapper`**

Replace the entire `RunGroupWrapper` function with:

```tsx
function RunGroupWrapper({
  runId,
  items,
  idx,
  skill,
  startedAt,
  endedAt,
}: {
  runId: string;
  items: RenderItem[];
  idx: number;
  skill: string | null;
  startedAt: string | null;
  endedAt: string | null;
}) {
  const [open, setOpen] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const isLive = endedAt == null;

  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  const rank = (item: RenderItem) => {
    if (item.kind !== 'event') return 2;
    if (item.event.kind === 'agent.run-completed') return 0;
    if (item.event.kind === 'agent.run-failed') return 1;
    return 2;
  };
  const sorted = [...items].sort((a, b) => rank(a) - rank(b));

  const startMs = startedAt != null ? new Date(startedAt).getTime() : null;
  const endMs = endedAt != null ? new Date(endedAt).getTime() : null;
  const liveDuration = startMs != null ? formatDuration(now - startMs) : null;
  const completeDuration = startMs != null && endMs != null ? formatDuration(endMs - startMs) : null;
  const isFailed = items.some(
    (item) => item.kind === 'event' && item.event.kind === 'agent.run-failed',
  );

  const statusBadge = isLive ? (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/10 text-green-400 border border-green-500/20">
      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
      Live
    </span>
  ) : isFailed ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-[color:var(--danger)] border border-red-500/20">
      Failed
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-fg-5/10 text-fg-3 border border-line/50">
      Complete
    </span>
  );

  const metaLine = isLive ? (
    liveDuration != null && (
      <span className="text-fg-5 text-[10.5px]">running for {liveDuration}</span>
    )
  ) : (
    <span className="text-fg-5 text-[10.5px]">
      {completeDuration != null && <>Ran for {completeDuration}</>}
      {startedAt != null && (
        <> &middot; Started {new Date(startedAt).toLocaleTimeString()}</>
      )}
      {endedAt != null && (
        <> &middot; Ended {new Date(endedAt).toLocaleTimeString()}</>
      )}
    </span>
  );

  return (
    <li data-run-id={runId} className="rounded-md border border-line/70 bg-bg/30">
      <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="flex flex-wrap items-center gap-2 cursor-pointer list-none px-4 py-2 font-mono text-[11px] select-none">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span title={runId} className="cursor-help border-b border-dashed border-fg-5/40">
            {formatSkillName(skill)} Run
          </span>
          <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
          {statusBadge}
          {metaLine}
          <span className="ml-auto text-fg-5">{items.length} events</span>
        </summary>
        <ol className="flex flex-col gap-2 px-3 pb-3">
          {isLive && (
            <li className="rounded-md border border-dashed border-[color:var(--accent)]/30 bg-[color:var(--accent)]/5 px-3 py-2 flex items-center gap-2 text-[10.5px] text-[color:var(--accent)]">
              <Loader2 size={12} className="shrink-0 animate-spin" />
              <span className="font-mono uppercase tracking-wider">Agent running…</span>
            </li>
          )}
          {sorted.map((item, i) => renderItem(item, idx * 1000 + i))}
        </ol>
      </details>
    </li>
  );
}
```

- [ ] **Step 5: Update `renderItem` to pass new props to `RunGroupWrapper`**

In the `renderItem` function, replace the `run-group` case:

```tsx
// Before:
if (item.kind === 'run-group') {
  return (
    <RunGroupWrapper
      key={`run-group-${item.runId}`}
      runId={item.runId}
      items={item.items}
      idx={idx}
    />
  );
}

// After:
if (item.kind === 'run-group') {
  return (
    <RunGroupWrapper
      key={`run-group-${item.runId}`}
      runId={item.runId}
      items={item.items}
      idx={idx}
      skill={item.skill}
      startedAt={item.startedAt}
      endedAt={item.endedAt}
    />
  );
}
```

- [ ] **Step 6: Run typecheck**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm --filter @goose-hub/web exec tsc --noEmit 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 7: Run all tests**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm --filter @goose-hub/web exec vitest run 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 8: Run lint**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm --filter @goose-hub/web exec biome check --write src/components/detail/ 2>&1 | tail -10
```

- [ ] **Step 9: Commit**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && git add apps/web/src/components/detail/components/TimelineSection.tsx && git commit -m "feat(timeline): run header shows skill name, live/complete badge, duration, GUID tooltip, loading card"
```
