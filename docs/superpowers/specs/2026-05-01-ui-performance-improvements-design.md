# UI Performance Improvements Design

**Date:** 2026-05-01  
**Status:** Approved

## Overview

Three independent improvements to Goose Hub's web UI:

1. **Server-side TTL cache** — eliminates repeated GitHub API round-trips
2. **Client-side stale-while-revalidate** — board appears instantly on repeat visits
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

## 2. Client-side Stale-While-Revalidate

### Location
`apps/web/src/lib/cache.ts` — new module.

### Interface
```ts
staleWhileRevalidate<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  onUpdate: (data: T) => void,
): void
```

Behaviour:
- If an entry exists in the module-level cache (even stale), call `onUpdate` synchronously with the cached data.
- If the entry is missing or older than `ttlMs`, kick off a background fetch and call `onUpdate` again when it resolves, updating the cache entry.
- First visit: no cache entry → shows skeleton, fetches, populates.
- Repeat visit (< 60s): returns instantly, no background fetch.
- Repeat visit (> 60s): returns stale data instantly (no skeleton), silently refetches in background.

### Applied to
`Board.tsx` `useEffect` — replaces the current `fetchIssues(projectSlug).then(...)` call.

### `fetchIssues` in `api.ts`
Unchanged. The SWR wrapper lives entirely in the component.

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
- Cache for `getItem` (detail fetch) — low priority, can be added later using the same helpers
- React Query / SWR library — unnecessary overhead given the simple custom solution
