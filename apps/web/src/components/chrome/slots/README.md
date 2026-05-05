# components/chrome/slots

Slot components mounted in the sidebar:

- `ProjectSwitcherSlot.tsx` — Closes M2.04 (#29), extended in M10.02 (#281). Reads from `GET /projects`, stores the active slug in `ActiveProjectContext`, navigates the URL on change. Supports any number of registered projects; uses collapsed (icon + popover) and expanded (select) modes.
- `MilestoneSelectorSlot.tsx` — Lit by M2.05 (#30).

Color stripe: comes from `ProjectConfig.colorStripe` (set per project in `target-projects/<slug>/project.config.ts`). The server maps it to `ProjectSummary.color` in `apps/server/src/shared/projects.ts`. The switcher renders it as `border-left` on the `<select>` (expanded) and as a coloured span inside the popover (collapsed).
