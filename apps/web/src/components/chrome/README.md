# components/chrome

The persistent shell every other UI surface lives inside. Closes M2.03 (#28).

- `AppShell.tsx` — outermost layout (sidebar + top bar + main).
- `Sidebar.tsx` — fixed-width left rail with project switcher slot, primary navigation, runtime theme switcher, and collapse control.
- `TopBar.tsx` — breadcrumb + disabled placeholders for search and command palette.
- `slots/ProjectSwitcherSlot.tsx`, `slots/MilestoneSelectorSlot.tsx` — replaced by real components in #29 / #30.
- `lib/theme.ts` — chrome-scoped helpers for reading, persisting, and applying the active light/dark theme.

Visual contract: ported from Harness 2.1's `chrome.jsx` `BreadcrumbBar`. Tokens come from `src/styles/tokens.css`. Balanced density only; theme selection now switches between dark and light token sets at runtime. See `docs/adr/0005-ui-design-system.md`.
