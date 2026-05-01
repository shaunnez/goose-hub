# UI Performance Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-side TTL cache, TanStack Query as the client data-fetching layer, boneyard skeleton loading on the board and detail page, and minimal on-theme scrollbar styling.

**Architecture:** Server-side `getCached<T>` helper (in-memory Map, 60s TTL) wraps GitHub API calls in Hono routes and is busted on transitions. TanStack Query replaces all `useEffect`-based fetches in the React app with a shared query cache; the SSE stream continues to patch board state in-place via `setQueryData`. Boneyard wraps the board columns area and detail page content with shimmer skeletons driven by TanStack Query's `isLoading`.

**Tech Stack:** Hono (server), TanStack Query v5 (`@tanstack/react-query`), boneyard-js, Vitest (unit tests), Playwright (e2e).

---

## File Map

### Created
- `apps/server/src/cache.ts` — generic TTL cache helper (`getCached`, `bustCache`)
- `apps/server/src/cache.test.ts` — unit tests for the cache helper

### Modified
- `apps/server/src/index.ts` — apply cache to issues/milestones routes; bust on transition
- `apps/web/package.json` — add `@tanstack/react-query`, `boneyard-js`; add `@tanstack/react-query-devtools` as devDep
- `apps/web/vite.config.ts` — add boneyard Vite plugin
- `apps/web/src/App.tsx` — add `QueryClientProvider` wrapper
- `apps/web/src/components/board/Board.tsx` — replace `useEffect` fetch with `useQuery`; SSE patches via `queryClient.setQueryData`
- `apps/web/src/components/detail/DetailPage.tsx` — replace both `useEffect` fetches with `useQuery`; derive siblings from cached issues query
- `apps/web/src/components/detail/TaskHeader.tsx` — remove `onStateChanged` prop
- `apps/web/src/components/detail/TransitionButton.tsx` — remove `onStateChanged` prop; use `useQueryClient` for optimistic update and invalidation
- `apps/web/src/styles/tokens.css` — append scrollbar CSS

---

## Task 1: Server-side cache module

**Files:**
- Create: `apps/server/src/cache.ts`
- Create: `apps/server/src/cache.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `apps/server/src/cache.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { bustCache, getCached } from './cache.js';

describe('getCached', () => {
  it('calls fetcher on first call and returns its value', async () => {
    const fetcher = vi.fn().mockResolvedValue('hello');
    const result = await getCached('t1', 60_000, fetcher);
    expect(result).toBe('hello');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('returns cached value without calling fetcher again within TTL', async () => {
    const fetcher = vi.fn().mockResolvedValue('data');
    await getCached('t2', 60_000, fetcher);
    const second = await getCached('t2', 60_000, fetcher);
    expect(second).toBe('data');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('refetches after bustCache', async () => {
    const fetcher = vi.fn().mockResolvedValue('value');
    await getCached('t3', 60_000, fetcher);
    bustCache('t3');
    await getCached('t3', 60_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('refetches after TTL expires', async () => {
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now);
    const fetcher = vi.fn().mockResolvedValue('fresh');
    await getCached('t4', 1_000, fetcher);
    spy.mockReturnValue(now + 1_001);
    await getCached('t4', 1_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 1.2: Run tests to confirm they fail**

```bash
pnpm test --reporter=verbose 2>&1 | grep -A5 'cache'
```

Expected: `Cannot find module './cache.js'`

- [ ] **Step 1.3: Implement the cache module**

Create `apps/server/src/cache.ts`:

```ts
const store = new Map<string, { data: unknown; expiresAt: number }>();

export async function getCached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const entry = store.get(key);
  if (entry != null && Date.now() < entry.expiresAt) {
    return entry.data as T;
  }
  const data = await fetcher();
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

export function bustCache(key: string): void {
  store.delete(key);
}
```

- [ ] **Step 1.4: Run tests to confirm they pass**

```bash
pnpm test --reporter=verbose 2>&1 | grep -A10 'getCached'
```

Expected: 4 tests pass.

- [ ] **Step 1.5: Commit**

```bash
git add apps/server/src/cache.ts apps/server/src/cache.test.ts
git commit -m "feat(server): add generic TTL cache helper"
```

---

## Task 2: Apply server cache to routes

**Files:**
- Modify: `apps/server/src/index.ts`

- [ ] **Step 2.1: Add imports at the top of `apps/server/src/index.ts`**

Add after the existing imports:

```ts
import { bustCache, getCached } from './cache.js';
```

- [ ] **Step 2.2: Wrap the issues route with getCached**

Find the issues route handler (line ~26-32) and replace the `source.listOpenWork()` call:

```ts
app.get('/projects/:slug/issues', async (c) => {
  const slug = c.req.param('slug');
  const source = await getSourceForSlug(slug);
  if (source == null) return c.json({ error: 'project not found' }, 404);
  const items = await getCached(`issues:${slug}`, 60_000, () => source.listOpenWork());
  return c.json({ items });
});
```

- [ ] **Step 2.3: Wrap the milestones route with getCached**

Find the milestones route handler (line ~43-48) and replace:

```ts
app.get('/projects/:slug/milestones', async (c) => {
  const slug = c.req.param('slug');
  const source = await getSourceForSlug(slug);
  if (source == null) return c.json({ error: 'project not found' }, 404);
  const milestones = await getCached(`milestones:${slug}`, 60_000, () => source.listMilestones());
  return c.json({ milestones });
});
```

- [ ] **Step 2.4: Bust issues cache after a successful transition**

Find the transition route handler (line ~88-117). After `return c.json({ ok: true, from, to });` succeeds (just before that line), add:

```ts
  bustCache(`issues:${slug}`);

  return c.json({ ok: true, from, to });
```

- [ ] **Step 2.5: Run tests to confirm nothing broken**

```bash
pnpm test
```

Expected: all existing tests pass.

- [ ] **Step 2.6: Commit**

```bash
git add apps/server/src/index.ts
git commit -m "feat(server): apply 60s TTL cache to issues and milestones routes"
```

---

## Task 3: Install TanStack Query and add provider

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 3.1: Install dependencies**

```bash
pnpm --filter @goose-hub/web add @tanstack/react-query
pnpm --filter @goose-hub/web add -D @tanstack/react-query-devtools
```

- [ ] **Step 3.2: Verify install**

```bash
grep '@tanstack/react-query' apps/web/package.json
```

Expected: both packages appear.

- [ ] **Step 3.3: Add QueryClientProvider to App.tsx**

Replace the contents of `apps/web/src/App.tsx` with:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Board } from './components/board/Board';
import { AppShell } from './components/chrome/AppShell';
import { DetailPage } from './components/detail/DetailPage';
import { ActiveMilestoneProvider } from './state/active-milestone';
import { ActiveProjectProvider } from './state/active-project';
import { LaneVisibilityProvider } from './state/lane-visibility';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

function KanbanPage() {
  const { slug = 'goose-hub-self' } = useParams<{ slug: string }>();
  return (
    <AppShell
      breadcrumb={
        <>
          <span className="font-mono text-fg-3">{slug}</span>
          <span className="mx-2 text-fg-4">/</span>
          <span>Kanban</span>
        </>
      }
    >
      <Board projectSlug={slug} />
    </AppShell>
  );
}

function DetailPageRoute({ section }: { section?: string }) {
  return (
    <AppShell breadcrumb={<span className="text-fg-3">Detail</span>}>
      <DetailPage section={section} />
    </AppShell>
  );
}

function ProjectShell({ children }: { children: React.ReactNode }) {
  const params = useParams<{ slug?: string }>();
  const slug = params.slug ?? 'goose-hub-self';
  return (
    <ActiveProjectProvider initialSlug={slug}>
      <ActiveMilestoneProvider projectSlug={slug}>
        <LaneVisibilityProvider>{children}</LaneVisibilityProvider>
      </ActiveMilestoneProvider>
    </ActiveProjectProvider>
  );
}

function DetailPageRouteWithSection() {
  const { section } = useParams<{ section: string }>();
  return <DetailPageRoute section={section} />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/projects/goose-hub-self" replace />} />
          <Route
            path="/projects/:slug"
            element={
              <ProjectShell>
                <KanbanPage />
              </ProjectShell>
            }
          />
          <Route
            path="/projects/:slug/items/:id"
            element={
              <ProjectShell>
                <DetailPageRoute section="overview" />
              </ProjectShell>
            }
          />
          <Route
            path="/projects/:slug/items/:id/:section"
            element={
              <ProjectShell>
                <DetailPageRouteWithSection />
              </ProjectShell>
            }
          />
        </Routes>
      </BrowserRouter>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
```

- [ ] **Step 3.4: Typecheck**

```bash
pnpm --filter @goose-hub/web exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3.5: Commit**

```bash
git add apps/web/package.json apps/web/src/App.tsx
git commit -m "feat(web): install TanStack Query and add QueryClientProvider"
```

---

## Task 4: Migrate Board to TanStack Query

**Files:**
- Modify: `apps/web/src/components/board/Board.tsx`

- [ ] **Step 4.1: Replace Board.tsx contents**

```tsx
import { type WorkItemDto, fetchIssues } from '@/lib/api';
import { LANES, laneForState, sortLaneItems } from '@/lib/lanes.config';
import { useActiveMilestone } from '@/state/active-milestone';
import { useLaneVisibility } from '@/state/lane-visibility';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, RefreshCw } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { BoardColumn } from './BoardColumn';

interface BoardProps {
  projectSlug: string;
}

export function Board({ projectSlug }: BoardProps) {
  const queryClient = useQueryClient();
  const { hidden, toggle, reset } = useLaneVisibility();
  const { activeNumber: resolvedMilestone } = useActiveMilestone();

  const {
    data: items = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['issues', projectSlug],
    queryFn: () => fetchIssues(projectSlug),
  });

  // SSE: patch board state in-place on transition events.
  useEffect(() => {
    const url = `/events?projectId=${encodeURIComponent(projectSlug)}`;
    const es = new EventSource(url);
    const onTransition = (msg: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(msg.data) as {
          workItemId: string | null;
          payload: { from?: string; to?: string };
        };
        if (payload.workItemId == null || payload.payload?.to == null) return;
        const externalId = payload.workItemId.split('#').pop();
        if (externalId == null) return;
        queryClient.setQueryData<WorkItemDto[]>(['issues', projectSlug], (prev) =>
          prev?.map((it) =>
            it.externalId === externalId
              ? { ...it, state: payload.payload.to as string }
              : it,
          ) ?? prev,
        );
      } catch {
        // ignore malformed events
      }
    };
    es.addEventListener('state.transitioned', onTransition as EventListener);
    return () => {
      es.removeEventListener('state.transitioned', onTransition as EventListener);
      es.close();
    };
  }, [projectSlug, queryClient]);

  const filtered = useMemo(() => {
    if (resolvedMilestone == null) return items;
    return items.filter((item) => item.milestoneId === String(resolvedMilestone));
  }, [items, resolvedMilestone]);

  const itemsByLane = useMemo(() => {
    const out = new Map<string, WorkItemDto[]>();
    for (const lane of LANES) out.set(lane.key, []);
    for (const item of filtered) {
      const laneKey = laneForState(item.state);
      if (laneKey == null) continue;
      out.get(laneKey)?.push(item);
    }
    for (const key of out.keys()) {
      const arr = out.get(key);
      if (arr != null) out.set(key, sortLaneItems(arr));
    }
    return out;
  }, [filtered]);

  const visibleLanes = useMemo(() => LANES.filter((l) => !hidden.has(l.key)), [hidden]);
  const hiddenLanes = useMemo(() => LANES.filter((l) => hidden.has(l.key)), [hidden]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-fg-3 text-sm">
        Loading issues from GitHub…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
        <div className="text-[color:var(--danger)] text-sm">Couldn't load issues.</div>
        <pre className="font-mono text-[11.5px] text-fg-3 max-w-2xl whitespace-pre-wrap">
          {error instanceof Error ? error.message : String(error)}
        </pre>
        <button
          type="button"
          onClick={() => void refetch()}
          className="h-7 px-3 rounded-md border border-line text-[12px] hover:bg-bg-hover"
        >
          <RefreshCw size={12} className="inline mr-1" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-testid="board">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-line shrink-0 text-[12px] text-fg-3">
        <span data-testid="board-issue-count">
          {filtered.length} issue{filtered.length === 1 ? '' : 's'}
        </span>
        {resolvedMilestone != null && (
          <span>
            · milestone <span className="font-mono tnum">#{resolvedMilestone}</span>
          </span>
        )}
        <span className="grow" />
        {hiddenLanes.length > 0 && (
          <details className="relative">
            <summary className="cursor-pointer list-none flex items-center gap-1.5 hover:text-fg">
              <Eye size={12} /> Hidden lanes ({hiddenLanes.length})
            </summary>
            <div className="absolute right-0 mt-1 z-10 min-w-[180px] rounded-md border border-line bg-bg-elev shadow-md p-1.5 flex flex-col gap-0.5">
              {hiddenLanes.map((lane) => (
                <button
                  key={lane.key}
                  type="button"
                  onClick={() => toggle(lane.key)}
                  className="text-left px-2 py-1 text-[12px] text-fg-2 hover:text-fg hover:bg-bg-hover rounded"
                >
                  Show {lane.label}
                </button>
              ))}
              <button
                type="button"
                onClick={reset}
                className="text-left px-2 py-1 text-[11px] text-fg-3 hover:text-fg hover:bg-bg-hover rounded mt-1 border-t border-line"
              >
                Reset to defaults
              </button>
            </div>
          </details>
        )}
      </div>
      <div className="flex-1 min-h-0 px-3 py-3 flex gap-3 overflow-x-auto">
        {visibleLanes.map((lane) => (
          <BoardColumn
            key={lane.key}
            lane={lane}
            items={itemsByLane.get(lane.key) ?? []}
            projectSlug={projectSlug}
            onHide={toggle}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4.2: Typecheck**

```bash
pnpm --filter @goose-hub/web exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4.3: Run unit tests**

```bash
pnpm test
```

Expected: all pass.

- [ ] **Step 4.4: Commit**

```bash
git add apps/web/src/components/board/Board.tsx
git commit -m "feat(web): migrate Board to TanStack Query, SSE patches via setQueryData"
```

---

## Task 5: Migrate DetailPage, TaskHeader, and TransitionButton

**Files:**
- Modify: `apps/web/src/components/detail/TransitionButton.tsx`
- Modify: `apps/web/src/components/detail/TaskHeader.tsx`
- Modify: `apps/web/src/components/detail/DetailPage.tsx`

- [ ] **Step 5.1: Update TransitionButton.tsx**

Replace the file contents:

```tsx
import { type WorkItemDto, transitionState } from '@/lib/api';
import { LEGAL_TARGETS } from '@/lib/transitions';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';

interface TransitionButtonProps {
  projectSlug: string;
  id: string;
  currentState: string;
}

export function TransitionButton({ projectSlug, id, currentState }: TransitionButtonProps) {
  const queryClient = useQueryClient();
  const targets = LEGAL_TARGETS[currentState] ?? [];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  if (targets.length === 0) {
    return (
      <button
        type="button"
        disabled
        title={`Terminal state: ${currentState} has no legal next states`}
        data-testid="transition-button-disabled"
        className="h-7 px-2.5 rounded-md text-[12px] border border-line text-fg-4 cursor-not-allowed"
      >
        No transitions
      </button>
    );
  }

  const onPick = async (to: string) => {
    setBusy(true);
    setError(null);
    const original = currentState;

    // Optimistic: update the cached item immediately.
    queryClient.setQueryData<WorkItemDto>(['issue', projectSlug, id], (prev) =>
      prev != null ? { ...prev, state: to } : prev,
    );
    setOpen(false);

    const { status, data } = await transitionState(projectSlug, id, original, to);
    setBusy(false);

    if (status >= 200 && status < 300) {
      // Bust the board cache so it reflects the new state on next visit.
      void queryClient.invalidateQueries({ queryKey: ['issues', projectSlug] });
      return;
    }

    // Revert: refetch the true state from the server.
    void queryClient.invalidateQueries({ queryKey: ['issue', projectSlug, id] });
    setOpen(true);
    setError(data.error ?? `Transition failed (${status})`);
  };

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="transition-button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="h-7 px-2.5 rounded-md text-[12px] bg-accent text-[color:var(--accent-fg)] hover:brightness-110 disabled:opacity-60 inline-flex items-center gap-1.5 font-medium"
      >
        Transition
        <ArrowRight size={12} />
      </button>
      {open && (
        <div
          data-testid="transition-popover"
          className="absolute right-0 mt-1 z-20 min-w-[220px] rounded-md border border-line bg-bg-elev shadow-md py-1"
        >
          <div className="px-3 py-1 text-[10.5px] uppercase tracking-wider text-fg-4">
            Legal next states
          </div>
          {targets.map((t) => (
            <button
              key={t}
              type="button"
              data-testid={`transition-target-${t}`}
              onClick={() => void onPick(t)}
              className="w-full text-left px-3 py-1.5 text-[12.5px] text-fg-2 hover:text-fg hover:bg-bg-hover font-mono"
            >
              {t}
            </button>
          ))}
          {error != null && (
            <div className="px-3 py-2 text-[11.5px] text-[color:var(--danger)] border-t border-line mt-1">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5.2: Update TaskHeader.tsx — remove onStateChanged prop**

In `apps/web/src/components/detail/TaskHeader.tsx`, find the `TaskHeaderProps` interface and the `TransitionButton` usage. Remove `onStateChanged` from both.

The updated interface and component signature:

```tsx
interface TaskHeaderProps {
  item: WorkItemDto;
  projectSlug: string;
}

export function TaskHeader({ item, projectSlug }: TaskHeaderProps) {
```

And in the JSX where `TransitionButton` is rendered, remove the `onStateChanged` prop:

```tsx
<TransitionButton
  projectSlug={projectSlug}
  id={item.externalId}
  currentState={item.state}
/>
```

- [ ] **Step 5.3: Replace DetailPage.tsx contents**

```tsx
import { type WorkItemDto, fetchIssue, fetchIssues } from '@/lib/api';
import { LANES, laneForState, sortLaneItems } from '@/lib/lanes.config';
import { useActiveMilestone } from '@/state/active-milestone';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DeferredSurface } from './DeferredSurface';
import { LeftRail } from './LeftRail';
import { OverviewSection } from './OverviewSection';
import { RightRail } from './RightRail';
import { TaskHeader } from './TaskHeader';
import { TimelineSection } from './TimelineSection';
import { SECTIONS } from './sections';

interface DetailPageProps {
  section?: string;
}

export function DetailPage({ section = 'overview' }: DetailPageProps) {
  const { slug = 'goose-hub-self', id = '' } = useParams<{ slug: string; id: string }>();
  const navigate = useNavigate();
  const { activeNumber } = useActiveMilestone();

  const { data: item, isLoading, isError, error } = useQuery({
    queryKey: ['issue', slug, id],
    queryFn: () => fetchIssue(slug, id),
    enabled: id.length > 0,
  });

  // Reuse the board's cached issues list for sibling navigation — no extra fetch.
  const { data: allIssues = [] } = useQuery({
    queryKey: ['issues', slug],
    queryFn: () => fetchIssues(slug),
  });

  const siblings = useMemo(() => {
    const filtered =
      activeNumber != null
        ? allIssues.filter((it) => it.milestoneId === String(activeNumber))
        : allIssues;
    const ordered: string[] = [];
    for (const lane of LANES) {
      const inLane = filtered.filter((it) => laneForState(it.state) === lane.key);
      for (const it of sortLaneItems(inLane)) ordered.push(it.externalId);
    }
    return ordered;
  }, [allIssues, activeNumber]);

  const onBack = useCallback(() => {
    navigate(`/projects/${slug}`);
  }, [navigate, slug]);

  const onPrev = useCallback(() => {
    if (siblings.length === 0) return;
    const idx = siblings.indexOf(id);
    if (idx <= 0) return;
    navigate(`/projects/${slug}/items/${siblings[idx - 1]}`);
  }, [navigate, siblings, id, slug]);

  const onNext = useCallback(() => {
    if (siblings.length === 0) return;
    const idx = siblings.indexOf(id);
    if (idx === -1 || idx >= siblings.length - 1) return;
    navigate(`/projects/${slug}/items/${siblings[idx + 1]}`);
  }, [navigate, siblings, id, slug]);

  // Keyboard: J / K / ⌘[ / Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if ((e.target as HTMLElement | null)?.tagName === 'TEXTAREA') return;
      if (e.key === 'j') {
        e.preventDefault();
        onNext();
      } else if (e.key === 'k') {
        e.preventDefault();
        onPrev();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onBack();
      } else if (e.key === '[' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack, onNext, onPrev]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-fg-3 text-sm">
        Loading issue…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
        <div className="text-[color:var(--danger)] text-sm">Couldn't load this issue.</div>
        <pre className="font-mono text-[11.5px] text-fg-3 max-w-2xl whitespace-pre-wrap">
          {error instanceof Error ? error.message : String(error)}
        </pre>
        <button
          type="button"
          onClick={onBack}
          className="h-7 px-3 rounded-md border border-line text-[12px] hover:bg-bg-hover"
        >
          Back to Board
        </button>
      </div>
    );
  }

  if (item == null) return null;

  const currentSection = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0];
  const workItemId = `github:${item.repoRef}#${item.externalId}`;

  return (
    <div className="h-full flex flex-col" data-testid="detail-page">
      {/* breadcrumb */}
      <div className="h-[40px] flex items-center gap-3 px-3 border-b border-line bg-bg-glass shrink-0">
        <button
          type="button"
          onClick={onBack}
          data-testid="back-to-board"
          className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[12px] text-fg-2 hover:text-fg hover:bg-bg-hover"
        >
          <ArrowLeft size={13} />
          Board
        </button>
        <span aria-hidden className="w-[1px] h-4 bg-line" />
        <span className="font-mono text-[12px] text-fg-3 truncate">
          <span className="text-fg-3">{slug}</span>
          <span className="mx-1.5 text-fg-4">/</span>
          <span className="text-fg-3">{item.repoRef}</span>
          <span className="mx-1.5 text-fg-4">/</span>
          <span className="text-fg font-semibold">#{item.externalId}</span>
        </span>
        <span className="grow" />
        <button
          type="button"
          onClick={onPrev}
          aria-label="Previous issue (K)"
          title="Previous issue (K)"
          className="h-7 w-7 inline-flex items-center justify-center rounded-md text-fg-3 hover:text-fg hover:bg-bg-hover"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          onClick={onNext}
          aria-label="Next issue (J)"
          title="Next issue (J)"
          className="h-7 w-7 inline-flex items-center justify-center rounded-md text-fg-3 hover:text-fg hover:bg-bg-hover"
        >
          <ChevronRight size={14} />
        </button>
        <button
          type="button"
          onClick={onBack}
          aria-label="Close (⌘[ )"
          title="Close (⌘[)"
          className="h-7 w-7 inline-flex items-center justify-center rounded-md text-fg-3 hover:text-fg hover:bg-bg-hover"
        >
          <X size={13} />
        </button>
      </div>

      <TaskHeader item={item} projectSlug={slug} />

      <div className="flex-1 min-h-0 flex">
        <LeftRail />
        <main className="flex-1 min-w-0 overflow-y-auto">
          {currentSection.key === 'overview' ? (
            <OverviewSection item={item} />
          ) : currentSection.key === 'timeline' ? (
            <TimelineSection projectSlug={slug} id={id} workItemId={workItemId} />
          ) : (
            <DeferredSurface
              surface={currentSection.label}
              milestone={currentSection.milestone ?? 'later'}
              description={currentSection.description}
            />
          )}
        </main>
        <RightRail />
      </div>
    </div>
  );
}
```

- [ ] **Step 5.4: Typecheck**

```bash
pnpm --filter @goose-hub/web exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5.5: Run all tests**

```bash
pnpm test
```

Expected: all pass.

- [ ] **Step 5.6: Commit**

```bash
git add apps/web/src/components/detail/TransitionButton.tsx \
        apps/web/src/components/detail/TaskHeader.tsx \
        apps/web/src/components/detail/DetailPage.tsx
git commit -m "feat(web): migrate DetailPage and TransitionButton to TanStack Query"
```

---

## Task 6: Install boneyard and wrap Board

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/src/components/board/Board.tsx`

- [ ] **Step 6.1: Install boneyard**

```bash
pnpm --filter @goose-hub/web add boneyard-js
```

- [ ] **Step 6.2: Add Vite plugin to vite.config.ts**

```ts
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import boneyard from 'boneyard-js/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  envDir: path.resolve(__dirname, '../..'),
  plugins: [react(), tailwindcss(), boneyard()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
      '/events': { target: 'http://localhost:3001', changeOrigin: true, ws: true },
    },
  },
});
```

- [ ] **Step 6.3: Wrap Board loading state with Skeleton**

In `apps/web/src/components/board/Board.tsx`, add the import:

```tsx
import { Skeleton } from 'boneyard-js/react';
```

Replace the `if (isLoading)` early return with a `Skeleton` wrapper around the full board render. Change the component return to:

```tsx
  return (
    <Skeleton name="board" loading={isLoading} animate="shimmer" color="var(--bg-elev)">
      <div className="h-full flex flex-col" data-testid="board">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-line shrink-0 text-[12px] text-fg-3">
          <span data-testid="board-issue-count">
            {filtered.length} issue{filtered.length === 1 ? '' : 's'}
          </span>
          {resolvedMilestone != null && (
            <span>
              · milestone <span className="font-mono tnum">#{resolvedMilestone}</span>
            </span>
          )}
          <span className="grow" />
          {hiddenLanes.length > 0 && (
            <details className="relative">
              <summary className="cursor-pointer list-none flex items-center gap-1.5 hover:text-fg">
                <Eye size={12} /> Hidden lanes ({hiddenLanes.length})
              </summary>
              <div className="absolute right-0 mt-1 z-10 min-w-[180px] rounded-md border border-line bg-bg-elev shadow-md p-1.5 flex flex-col gap-0.5">
                {hiddenLanes.map((lane) => (
                  <button
                    key={lane.key}
                    type="button"
                    onClick={() => toggle(lane.key)}
                    className="text-left px-2 py-1 text-[12px] text-fg-2 hover:text-fg hover:bg-bg-hover rounded"
                  >
                    Show {lane.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={reset}
                  className="text-left px-2 py-1 text-[11px] text-fg-3 hover:text-fg hover:bg-bg-hover rounded mt-1 border-t border-line"
                >
                  Reset to defaults
                </button>
              </div>
            </details>
          )}
        </div>
        <div className="flex-1 min-h-0 px-3 py-3 flex gap-3 overflow-x-auto">
          {visibleLanes.map((lane) => (
            <BoardColumn
              key={lane.key}
              lane={lane}
              items={itemsByLane.get(lane.key) ?? []}
              projectSlug={projectSlug}
              onHide={toggle}
            />
          ))}
        </div>
      </div>
    </Skeleton>
  );
```

Also remove the deleted `if (isLoading)` early return block. Keep the `if (isError)` block — it remains as an early return before the Skeleton.

- [ ] **Step 6.4: Typecheck**

```bash
pnpm --filter @goose-hub/web exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6.5: Capture board skeleton**

Start the dev server and the API server (in separate terminals), navigate to the board with real data loaded, then run:

```bash
npx boneyard-js build
```

This generates a `.bones.json` file (boneyard places it alongside the component or in a `boneyard/` directory — check the output for the exact path). Commit it.

- [ ] **Step 6.6: Commit**

```bash
git add apps/web/package.json apps/web/vite.config.ts \
        apps/web/src/components/board/Board.tsx
# Also add any .bones.json files generated by boneyard
git add -A
git commit -m "feat(web): add boneyard skeleton loading on board"
```

---

## Task 7: Wrap DetailPage with boneyard skeleton

**Files:**
- Modify: `apps/web/src/components/detail/DetailPage.tsx`

- [ ] **Step 7.1: Add Skeleton import to DetailPage.tsx**

At the top of the file, add:

```tsx
import { Skeleton } from 'boneyard-js/react';
```

- [ ] **Step 7.2: Replace loading early return with Skeleton wrapper**

Remove:

```tsx
  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-fg-3 text-sm">
        Loading issue…
      </div>
    );
  }
```

Wrap the final return (the `data-testid="detail-page"` div) in a `Skeleton`, and move the `if (item == null) return null` guard inside:

```tsx
  if (isError) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
        <div className="text-[color:var(--danger)] text-sm">Couldn't load this issue.</div>
        <pre className="font-mono text-[11.5px] text-fg-3 max-w-2xl whitespace-pre-wrap">
          {error instanceof Error ? error.message : String(error)}
        </pre>
        <button
          type="button"
          onClick={onBack}
          className="h-7 px-3 rounded-md border border-line text-[12px] hover:bg-bg-hover"
        >
          Back to Board
        </button>
      </div>
    );
  }

  return (
    <Skeleton name="detail" loading={isLoading} animate="shimmer" color="var(--bg-elev)">
      {item != null && (
        <div className="h-full flex flex-col" data-testid="detail-page">
          <div className="h-[40px] flex items-center gap-3 px-3 border-b border-line bg-bg-glass shrink-0">
            <button
              type="button"
              onClick={onBack}
              data-testid="back-to-board"
              className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[12px] text-fg-2 hover:text-fg hover:bg-bg-hover"
            >
              <ArrowLeft size={13} />
              Board
            </button>
            <span aria-hidden className="w-[1px] h-4 bg-line" />
            <span className="font-mono text-[12px] text-fg-3 truncate">
              <span className="text-fg-3">{slug}</span>
              <span className="mx-1.5 text-fg-4">/</span>
              <span className="text-fg-3">{item.repoRef}</span>
              <span className="mx-1.5 text-fg-4">/</span>
              <span className="text-fg font-semibold">#{item.externalId}</span>
            </span>
            <span className="grow" />
            <button
              type="button"
              onClick={onPrev}
              aria-label="Previous issue (K)"
              title="Previous issue (K)"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-fg-3 hover:text-fg hover:bg-bg-hover"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              onClick={onNext}
              aria-label="Next issue (J)"
              title="Next issue (J)"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-fg-3 hover:text-fg hover:bg-bg-hover"
            >
              <ChevronRight size={14} />
            </button>
            <button
              type="button"
              onClick={onBack}
              aria-label="Close (⌘[ )"
              title="Close (⌘[)"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-fg-3 hover:text-fg hover:bg-bg-hover"
            >
              <X size={13} />
            </button>
          </div>

          <TaskHeader item={item} projectSlug={slug} />

          <div className="flex-1 min-h-0 flex">
            <LeftRail />
            <main className="flex-1 min-w-0 overflow-y-auto">
              {currentSection.key === 'overview' ? (
                <OverviewSection item={item} />
              ) : currentSection.key === 'timeline' ? (
                <TimelineSection projectSlug={slug} id={id} workItemId={workItemId} />
              ) : (
                <DeferredSurface
                  surface={currentSection.label}
                  milestone={currentSection.milestone ?? 'later'}
                  description={currentSection.description}
                />
              )}
            </main>
            <RightRail />
          </div>
        </div>
      )}
    </Skeleton>
  );
```

Note: the lines that compute `currentSection` and `workItemId` must stay above the return — move them before the `if (isError)` block since they no longer depend on `item` being non-null at compile time (they use `item` conditionally inside the JSX):

```tsx
  const currentSection = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0];
  const workItemId = item != null ? `github:${item.repoRef}#${item.externalId}` : '';
```

- [ ] **Step 7.3: Typecheck**

```bash
pnpm --filter @goose-hub/web exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7.4: Capture detail skeleton**

With dev and API servers running, navigate to any issue detail page with real data loaded, then:

```bash
npx boneyard-js build
```

- [ ] **Step 7.5: Commit**

```bash
git add apps/web/src/components/detail/DetailPage.tsx
git add -A  # picks up any new .bones.json
git commit -m "feat(web): add boneyard skeleton loading on detail page"
```

---

## Task 8: Scrollbar CSS

**Files:**
- Modify: `apps/web/src/styles/tokens.css`

- [ ] **Step 8.1: Append scrollbar rules to tokens.css**

Add at the end of `apps/web/src/styles/tokens.css`:

```css
/* Minimal on-theme scrollbars */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--line) transparent;
}

::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--line);
  border-radius: 2px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--line-2);
}
```

- [ ] **Step 8.2: Typecheck and test**

```bash
pnpm --filter @goose-hub/web exec tsc --noEmit && pnpm test
```

Expected: all pass.

- [ ] **Step 8.3: Commit**

```bash
git add apps/web/src/styles/tokens.css
git commit -m "feat(web): minimal on-theme scrollbar styling"
```

---

## Final verification

- [ ] Run full test suite: `pnpm test`
- [ ] Run e2e tests: `pnpm test:e2e`
- [ ] Manually verify in browser: board loads with shimmer skeleton, navigating to a detail page shows skeleton, scrollbars are thin and slate-toned, TanStack Query devtools are accessible in dev mode
