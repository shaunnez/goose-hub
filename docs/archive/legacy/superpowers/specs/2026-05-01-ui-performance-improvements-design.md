# UI Performance Improvements Design

**Date:** 2026-05-01  
**Status:** Approved

## Overview

Four improvements to Goose Hub's web UI, foundational for a growing number of API surfaces:

1. **Server-side TTL cache** — eliminates repeated GitHub API round-trips
2. **TanStack Query** — client-side data fetching with per-query caching, background refresh, and manual invalidation; replaces ad-hoc `useEffect` fetches across all surfaces
3. **Boneyard skeleton loading** — replaces spinner text with shimmer skeletons on board and detail page
4. **Minimal scrollbar styling** — thin, on-theme scrollbars via CSS

---

## 1. Server-side TTL Cache

### Location
`apps/server/src/cache.ts` — new module.

### Interface
```ts
getCached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T>
```

Backed by a module-level `Map<string, { data: unknown; expiresAt: number }>`. Generic — not tied to any specific API. All future server routes may use this helper.

### Applied to
- `GET /projects/:slug/issues` → cache key `issues:{slug}`, TTL 60s
- `GET /projects/:slug/milestones` → cache key `milestones:{slug}`, TTL 60s

### Cache invalidation
`POST /projects/:slug/issues/:id/transition` deletes the `issues:{slug}` cache entry after a successful transition so the board picks up fresh state on next load.

### Dependencies
None — plain in-memory Map.

---

## 2. TanStack Query

### Rationale
The app will grow to many API surfaces with mixed caching strategies (some need a TTL cache, some need live polling, some need manual refresh buttons). A custom SWR helper would eventually replicate what TanStack Query already provides. Better to adopt it now as the standard data-fetching layer.

### Dependency
`@tanstack/react-query` added to `apps/web/package.json`.  
`@tanstack/react-query-devtools` added as a dev dependency.

### Provider setup
`QueryClientProvider` added at the root in `apps/web/src/App.tsx` with a `QueryClient` configured with sensible defaults:
- `staleTime: 60_000` — global default; cached surfaces need no extra config
- `refetchOnWindowFocus: false` — local-first tool, no surprise refetches

### Per-query configuration
| Surface | `staleTime` | `refetchInterval` | Notes |
|---|---|---|---|
| Board issues | 60s | — | Server cache does the work |
| Milestones | 60s | — | Rarely changes |
| Detail issue | 60s | — | |
| Live surfaces (future) | 0 | configurable | Opt-in per query |

### Migration
- `Board.tsx` `useEffect` fetch replaced with `useQuery({ queryKey: ['issues', projectSlug], queryFn: () => fetchIssues(projectSlug) })`
- `DetailPage.tsx` fetch replaced similarly
- `fetchIssues`, `fetchIssue`, `fetchMilestones` in `api.ts` remain unchanged — they become query functions

### Manual refresh
Refresh buttons call `queryClient.invalidateQueries({ queryKey: ['issues', projectSlug] })`. The board re-fetches immediately and shows fresh data without a full skeleton.

### Transition invalidation
After a successful `POST /transition`, invalidate `['issues', projectSlug]` so the board reflects the new state on next render — replaces the current SSE-only patch approach (SSE still works as a fast path).

---

## 3. Boneyard Skeleton Loading

### Dependency
`boneyard-js` added to `apps/web/package.json` dependencies.  
`boneyard-js/vite` Vite plugin added to `apps/web/vite.config.ts`.

### Surfaces

**Board (`apps/web/src/components/board/Board.tsx`)**  
The existing `loading` boolean drives the skeleton. While `loading === true`, boneyard renders the captured board bone layout instead of the current "Loading issues from GitHub…" text. Wrap the board content in:
```jsx
<Skeleton name="board" loading={loading} animate="shimmer">
  {/* board columns */}
</Skeleton>
```

**Detail page (`apps/web/src/components/detail/DetailPage.tsx`)**  
Same pattern. The detail page fetches a single issue — existing `loading` state is used. Wrap content in:
```jsx
<Skeleton name="detail" loading={loading} animate="shimmer">
  {/* detail content */}
</Skeleton>
```

### Bone capture
Run once after install with the dev server running and real data loaded:
```bash
npx boneyard-js build
```
Commits the generated `.bones.json` files alongside the components.

### Theming
Shimmer colors configured to use `var(--bg-elev)` / `var(--bg-elev-2)` so the animation blends with the dark slate theme.

---

## 4. Scrollbar CSS

### Location
Appended to `apps/web/src/styles/tokens.css`.

### Rules
```css
* {
  scrollbar-width: thin;
  scrollbar-color: var(--line) transparent;
}

::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--line); border-radius: 2px; }
::-webkit-scrollbar-thumb:hover { background: var(--line-2); }
```

4px wide, transparent track, `--line` thumb, `--line-2` on hover. No new tokens.

---

## Out of scope

- Persistent cache (localStorage, SQLite) — in-memory is sufficient for a local-first single-user tool
- Custom SWR helper — superseded by TanStack Query
- Polling for existing surfaces — SSE stream already handles real-time state transitions on the board
