# Mobile Responsiveness Design

**Date:** 2026-05-08  
**Status:** Approved  
**Approach:** Breakpoints + extracted mobile variants (Approach B)

## Target Devices

| Breakpoint | Range | Behaviour |
|---|---|---|
| Phone portrait | ≤ 639px | Mobile layout — bottom nav, stacked views |
| Tablet | 640–1023px | Sidebar collapsed (48px), horizontal board |
| Desktop | ≥ 1024px | No change from current |

Playwright verification viewports: `375×812` (iPhone 14) and `768×1024` (iPad).

---

## Shared Infrastructure

### `useMediaQuery` hook

New file: `apps/web/src/hooks/useMediaQuery.ts`

```ts
// Returns true while the media query matches, reactive on resize.
export function useMediaQuery(query: string): boolean
```

Uses `window.matchMedia(query)` + `addEventListener('change')`. No external dependency.  
Consumed by: `AppShell`, `Board`, `DetailPage`, `InboxList`.

Mobile sentinel: `useMediaQuery('(max-width: 639px)')`.

---

## Screen-by-screen Design

### 1. AppShell + Navigation

**Phone:**
- `Sidebar` hidden entirely (`hidden` class when `isMobile`).
- New component `BottomNav` (`apps/web/src/components/chrome/BottomNav.tsx`):
  - Fixed, full-width bar at bottom.
  - 5 icon buttons: Kanban, Inbox, Roster, Costs, Settings.
  - Accepts `activeSlug` prop (from `AppShell`'s existing `useParams`) to build nav links matching `Sidebar`.
  - Uses `NavLink` with same active highlight as Sidebar (`bg-accent-soft text-fg`).
  - Icons only, `title` attribute for a11y.
- `main` content in `AppShell` gets `pb-14 sm:pb-0` to clear the nav bar.

**Tablet:**
- Sidebar stays, defaults to collapsed (48px). No change.

---

### 2. Kanban Board

**Phone:**
- New component `BoardMobileList` (`apps/web/src/components/board/components/BoardMobileList.tsx`, ~60 lines).
- Layout: vertical `flex-col` list.
- Each lane renders as a collapsible group: lane header (label + count + chevron) + stacked `IssueCard` items below.
- Lane visibility toggle (`useLaneVisibility`) still applies.
- All lanes expanded by default.
- Milestone selector row unchanged.
- `Board.tsx` switches between `<BoardMobileList>` and the existing column layout based on `isMobile`.

**Tablet:**
- Keep horizontal scroll columns.
- Add `min-w-[180px]` to each `BoardColumn` so cards don't compress at 640px.

---

### 3. Detail Page

**Phone:**
- `LeftRail` hidden.
- New component `DetailTabStrip` (`apps/web/src/components/detail/components/DetailTabStrip.tsx`, ~40 lines):
  - `flex overflow-x-auto gap-1 px-3 py-2 border-b border-line shrink-0`
  - One pill per section. Active: `bg-accent-soft text-fg`. Inactive: `text-fg-2`.
  - Deferred sections render dimmed (same as `LeftRail` today).
  - No text wrapping — horizontal scroll only.
- Stack order (top → bottom): control bar → `TaskHeader` → banners → `DetailTabStrip` → `main`.
- "Start fake triage" button hidden on phone (`hidden sm:inline-flex`) — dev tool only.

**Tablet:**
- `LeftRail` stays. No change.

---

### 4. Inbox

**Phone:**
- Full-screen list view when no item selected.
- Full-screen detail view when item selected, with a "Back" injected at top of `InboxDetail`.
- Implementation: conditional branch in `InboxList.tsx` on `isMobile && selectedId != null`.
- `InboxDetail` accepts optional `onBack?: () => void` prop; renders back button when provided.
- No new components.

**Tablet:**
- Keep 35/65 split. List panel bumps to `w-[40%] sm:w-[40%]` (currently `w-[35%]`).

---

### 5. TopBar

**Phone:**
- Search + Command buttons: `hidden sm:flex` (already disabled, no functional loss).
- Capture button stays.
- Height unchanged.

---

### 6. Simple Screens

Verified via Playwright and fixed inline during the loop. Expected changes:

| Screen | Expected fix |
|---|---|
| Roster / PersonaDrillIn | `max-w-full` on any fixed-width inner container |
| Costs | `overflow-x-auto` wrapper on chart if it overflows |
| Settings panels | Stack any side-by-side form rows: `flex-col sm:flex-row` |
| BootstrapWizard | `mx-4` on phone to prevent edge bleed |

---

## Implementation Loop Order

Each iteration: implement → start dev server → Playwright check at `375×812` and `768×1024` → fix regressions.

1. `useMediaQuery` hook + `AppShell` + `BottomNav`
2. Kanban Board (`BoardMobileList`)
3. Detail Page (`DetailTabStrip`)
4. Inbox (push navigation)
5. TopBar + simple screens (Roster, Costs, Settings, Bootstrap)

---

## Files Created / Modified

| File | Action |
|---|---|
| `apps/web/src/hooks/useMediaQuery.ts` | Create |
| `apps/web/src/components/chrome/AppShell.tsx` | Modify |
| `apps/web/src/components/chrome/BottomNav.tsx` | Create |
| `apps/web/src/components/board/components/Board.tsx` | Modify |
| `apps/web/src/components/board/components/BoardMobileList.tsx` | Create |
| `apps/web/src/components/board/components/BoardColumn.tsx` | Modify (min-width) |
| `apps/web/src/components/detail/components/DetailPage.tsx` | Modify |
| `apps/web/src/components/detail/components/DetailTabStrip.tsx` | Create |
| `apps/web/src/components/inbox/components/InboxList.tsx` | Modify |
| `apps/web/src/components/inbox/components/InboxDetail.tsx` | Modify (onBack prop) |
| `apps/web/src/components/chrome/TopBar.tsx` | Modify |
| `apps/web/src/components/roster/`, `costs/`, `settings/`, `bootstrap/` | Modify as needed |

---

## Playwright Test Strategy

New tests: `apps/web/e2e/mobile/` subfolder (or `*.mobile.spec.ts` alongside existing).

Per-screen pattern:
1. Set viewport `375×812`
2. Assert mobile elements visible (BottomNav, tab strip, back button)
3. Assert desktop elements hidden (Sidebar, LeftRail)
4. Exercise key interaction
5. Screenshot
6. Repeat at `768×1024` — assert sidebar visible + collapsed

Existing tests: untouched.
