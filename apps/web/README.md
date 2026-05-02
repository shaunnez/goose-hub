# @goose-hub/web

Vite + React 19 + Tailwind 4 + React Router v6. Closes M2.02 (#27).

## Run

```sh
pnpm --filter @goose-hub/web dev          # http://localhost:5173
pnpm --filter @goose-hub/server dev       # http://localhost:3001 (proxied behind /api and /events)
```

`/api` proxies to `apps/server` and `/events` proxies the SSE stream — see `vite.config.ts`.

## Conventions

See [`STANDARDS.md`](./STANDARDS.md) for the feature folder structure, shared lib rules, component naming, and import rules. Read it before touching any file in `src/`.

- Dark mode default; `data-theme="dark"` and `data-density="balanced"` are set on `<html>` (M2 ships only this combination).
- Design tokens come from `src/styles/tokens.css`, ported from the Harness 2.1 design (oklch palette, Inter + JetBrains Mono).
- Tailwind 4's `@theme` block in `src/index.css` exposes tokens as utility classes (e.g. `bg-bg-elev`, `text-fg-3`, `border-line`).
- Path alias: `@/*` → `src/*`.
- shadcn/ui-style components are added inline under `src/components/ui/` (e.g. `button.tsx`, `dialog.tsx`) rather than via CLI; this keeps the scaffold deterministic across machines.
