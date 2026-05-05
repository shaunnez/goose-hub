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
- `DeferredSurface.tsx` — small "Available in M&lt;N&gt;" empty-state for the inert sections.
- `DependenciesSection.tsx` — renders the "Dependencies" block inside `OverviewSection`. Parses dependency declarations from the issue body using `lib/dependency-parser`, fetches each dep's title and state via React Query, resolves cross-repo deps to registered project slugs. Hidden when the issue has no dep declarations. Calls `onHasOpenDep(bool)` so `DetailPage` can set the "Blocked" badge on `TaskHeader`. Added in M11.04 (#288).
- `sections.ts` — single source of truth for the 10-section list, milestone tags, descriptions.
- `InvestigationSection.tsx` — renders structured investigation findings from `agent.investigation-complete` events: confidence badge (low/medium/high), markdown findings, key files list, and open questions. Shows empty state if no investigation has run. Added in M6.06 (#190).
- `GatePendingBanner.tsx` — amber callout rendered between `TaskHeader` and the main content rails when the issue is in a gate state (a state requiring human action). Renders null for non-gate states.
- `gate-states.ts` — pure-logic map of gate state keys to human-readable banner messages. Kept separate from the component so the vitest suite (no `@/` alias resolution) can import it directly.
- `PlaywrightCaptureSection.tsx` — Code tab content for `type:bug` issues. Fetches `agent.investigation-complete` events, extracts the `playwrightRepro` payload, and renders screenshots (preferring SHA-pinned `githubUrl` over the workspace-relative path), an inline walkthrough GIF, console errors (with type badges), and repro steps. When the BEFORE-state comment URL is present, shows a "View on GitHub" link out to that comment. Shows empty state for non-bug issues or when no capture has run. Logic helper in `lib/playwright-capture.ts`.
