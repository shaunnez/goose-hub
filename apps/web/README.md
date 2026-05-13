# @goose-hub/web

Vite + React 19 + Tailwind 4 + React Router v6. Closes M2.02 (#27).

## Run

```sh
pnpm --filter @goose-hub/web dev          # http://localhost:5173
pnpm --filter @goose-hub/server dev       # http://localhost:3001 (proxied behind /api and /events)
```

`/api` proxies to `apps/server` and `/events` proxies the SSE stream — see `vite.config.ts`.

## Office tab (M17 — Goose Mode skin)

The Office tab (`/projects/:slug/office`) renders a pixel-art top-down view of every project. The Phaser scene generates all textures procedurally on boot, so it works in a fresh checkout with no asset build step.

To upgrade visuals with PixelLab-generated art:

```sh
# .env at the repo root (gitignored)
PIXELLAB_API_KEY=<your key from https://api.pixellab.ai/mcp>

pnpm gen:office-assets   # writes PNGs to apps/web/public/office/
```

See `src/components/office/README.md` for the full design.

## Conventions

See [`STANDARDS.md`](./STANDARDS.md) for the feature folder structure, shared lib rules, component naming, and import rules. Read it before touching any file in `src/`.

## Playwright Test Agents (dev-time)

`.claude/agents/playwright-test-{planner,generator,healer}.md` are Microsoft's
test-authoring subagents (Playwright 1.56+, installed via `npx playwright init-agents
--loop=claude`). They are invoked by a human Claude Code session — not by Factory.
See [`.claude/agents/README.md`](./.claude/agents/README.md) for usage and
[`docs/adr/0011-playwright-test-agents-and-evidence-pipeline.md`](../../docs/adr/0011-playwright-test-agents-and-evidence-pipeline.md)
for why they live outside `skills/`.

- Dark mode default; `data-theme="dark"` and `data-density="balanced"` are set on `<html>` (M2 ships only this combination).
- Design tokens come from `src/styles/tokens.css`, ported from the Harness 2.1 design (oklch palette, Inter + JetBrains Mono).
- Tailwind 4's `@theme` block in `src/index.css` exposes tokens as utility classes (e.g. `bg-bg-elev`, `text-fg-3`, `border-line`).
- Path alias: `@/*` → `src/*`.
- shadcn/ui-style components are added inline under `src/components/ui/` (e.g. `button.tsx`, `dialog.tsx`) rather than via CLI; this keeps the scaffold deterministic across machines.
