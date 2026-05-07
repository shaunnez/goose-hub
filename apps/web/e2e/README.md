# apps/web/e2e

Playwright happy-path test for M2. Closes M2.11 (#36).

## Run

```sh
GITHUB_TOKEN=ghp_… pnpm --filter @goose-hub/web test:e2e
```

The test skips gracefully when `GITHUB_TOKEN` is empty, per #36's acceptance criterion.

`exec:serial` — must not run in parallel with other Playwright tests.

## What's covered

- Open Goose Hub at `/` → redirects to `/projects/goose-hub-self`.
- Project switcher reflects the active slug.
- Kanban renders ≥ 1 real issue from `shaunnez/goose-hub`.
- Click a card → routed full-takeover detail page with the 10-section left rail.
- Overview body renders.
- Right rail shows the "No agent runs" empty state.
- Timeline section navigable.
- Transition popover lists legal next states for issues with non-terminal state.
- Direct URL roundtrip (`/projects/:slug/items/:id`) works.
- Back-to-board button returns to the kanban.

The full state-transition round-trip (POST → GitHub label updated → SSE event arrives → Board card moves lane) is covered manually because the GitHub label flip side-effects a real issue. CI runs the popover-only path for safety.

## Pipeline E2E (`e2e/pipeline/`)

`pnpm --filter @goose-hub/web test:e2e:pipeline` — runs against MOCK_AGENTS + MOCK_SOURCE + MOCK_OPEN_PR, no real GitHub token required.

Specs:
- `full-lifecycle.spec.ts` — chore: triaging → done (triage + fix + QA + review + approve)
- `bug-investigation.spec.ts` — bug: high-confidence → dev-ready, low-confidence → gate-pending
- `escalation.spec.ts` — retry escalation path
- `gate-reject-loop.spec.ts` — approved → needs-fix → re-approved → done
- `merge-conflict.spec.ts` — merge conflict resolution path
- `qa-fail-loop.spec.ts` — QA fail → needs-fix → re-QA pass
- `review-sendback-loop.spec.ts` — review sendback → needs-fix → re-review → approved
- `discover-lane.spec.ts` — M13 Discover Lane: type:feature triaging → grilling (Grill tab visible, PRD tab absent), grill chat (agent question + user reply + state transition), PRD tab + content render + Approve PRD flow through to factory:decomposing

**`discover-lane.spec.ts` vs. `grill-prd-flow.spec.ts`**: The regular `grill-prd-flow.spec.ts` (in `e2e/`) is a pure UI stub — all API calls are route-intercepted, no real server. `discover-lane.spec.ts` uses the full pipeline harness (real mock server, seed-issue, /tick, /dispatch) so it covers the server→UI round-trip including state-gated tab visibility and the approve-prd state machine path.
