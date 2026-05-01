# components/detail

Full-takeover detail page for a single work item. Closes M2.08 (#33) and M2.09 (#34).

Routes (mounted in `App.tsx`):

- `/projects/:slug/items/:id` — Overview (default).
- `/projects/:slug/items/:id/:section` — section-specific view (`timeline`, `repo`, `prd`, etc.).

Components:

- `DetailPage.tsx` — orchestrates header + rails + main; loads the work item; loads sibling order for J/K nav; wires keyboard shortcuts (J / K next/prev, Esc / ⌘[ back to Board).
- `LeftRail.tsx` — 10-section nav. Overview + Timeline functional; the other 8 are stubs that render `DeferredSurface`.
- `TaskHeader.tsx` — issue meta + state pill + priority + type pill + transition button.
- `TransitionButton.tsx` — popover of legal next states from `lib/transitions.ts`; calls `POST /api/projects/:slug/issues/:id/transition`. M2.10 (#35) ships the optimistic Board move.
- `RightRail.tsx` — empty-state for live activity; lights up in M3+.
- `OverviewSection.tsx` — renders the issue body via the lightweight Markdown helper.
- `TimelineSection.tsx` — fetches `events` for the work item; subscribes to `/events?workItemId=…` SSE so new transitions appear without a refresh.
- `DeferredSurface.tsx` — small "Available in M&lt;N&gt;" empty-state for the 8 inert sections.
- `sections.ts` — single source of truth for the 10-section list, milestone tags, descriptions.
- `GatePendingBanner.tsx` — amber callout rendered between `TaskHeader` and the main content rails when the issue is in a gate state (a state requiring human action). Renders null for non-gate states.
- `gate-states.ts` — pure-logic map of gate state keys to human-readable banner messages. Kept separate from the component so the vitest suite (no `@/` alias resolution) can import it directly.
