# components/chrome

The persistent shell every other UI surface lives inside. Closes M2.03 (#28).

- `AppShell.tsx` — outermost layout (sidebar + top bar + main).
- `Sidebar.tsx` — fixed-width left rail with project switcher slot, milestone selector slot, kanban link, and "available in M&lt;N&gt;" stubs for Inbox / Roster / Milestones / Settings / Bootstrap.
- `TopBar.tsx` — breadcrumb + disabled placeholders for search and command palette.
- `slots/ProjectSwitcherSlot.tsx`, `slots/MilestoneSelectorSlot.tsx` — replaced by real components in #29 / #30.

Visual contract: ported from Harness 2.1's `chrome.jsx` `BreadcrumbBar`. Tokens come from `src/styles/tokens.css`. Dark theme, balanced density only — see `docs/adr/0005-ui-design-system.md`.
