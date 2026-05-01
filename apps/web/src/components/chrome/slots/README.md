# components/chrome/slots

Slot components mounted in the sidebar:

- `ProjectSwitcherSlot.tsx` — Closes M2.04 (#29). Reads from `GET /projects`, stores the active slug in `ActiveProjectContext`, navigates the URL on change. Goose-hub-self only for now; component is forwards-compatible with multiple projects (M10).
- `MilestoneSelectorSlot.tsx` — Lit by M2.05 (#30).

Color stripe: comes from `apps/server/src/projects.ts` `COLOR_BY_SLUG` (defaults `#7c3aed` for goose-hub-self per #29's acceptance criteria; `ProjectConfig` does not carry a colour field today, so the server provides one).
