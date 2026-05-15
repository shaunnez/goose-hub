# apps/web/e2e

Playwright happy-path test for M2. Closes M2.11 (#36).

## Run

```sh
GITHUB_TOKEN=ghp_… pnpm --filter @goose-hub/web test:e2e:legacy-ui-smoke
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

`pnpm --filter @goose-hub/web test:e2e:pipeline` — canonical QA regression suite. `test:e2e` is kept as a compatibility alias for this pipeline suite. It runs against MOCK_AGENTS + MOCK_SOURCE + MOCK_OPEN_PR, no real GitHub token required.

Specs:
- `full-lifecycle.spec.ts` — chore: triaging → done (triage + fix + QA + review + approve)
- `bug-investigation.spec.ts` — bug: high-confidence → dev-ready, low-confidence → gate-pending
- `escalation.spec.ts` — retry escalation path
- `gate-reject-loop.spec.ts` — approved → needs-fix → re-approved → done
- `merge-conflict.spec.ts` — merge conflict resolution path
- `qa-fail-loop.spec.ts` — QA fail → needs-fix → re-QA pass
- `review-sendback-loop.spec.ts` — review sendback → needs-fix → re-review → approved
- `discover-lane.spec.ts` — M13 Discover Lane: type:feature triaging → grilling (Grill tab visible, PRD tab absent), grill chat (agent question + user reply + state transition), PRD tab + content render + Approve PRD flow through to factory:decomposing
- `golden-feature.spec.ts` — golden feature happy path: one issue walked seed → grill → PRD → decompose → child dev cycle → done. Covers Overview / Grill / PRD / Timeline / QA / Review surfaces and the parent → child handoff. Trace + video on every run.
- `golden-feature-prd-revised.spec.ts` — golden feature with PRD revision (ADR 0033 three-path flow, shipped in M13.12 #631): one test for **Request Changes** (PRD v1 → revise → PRD v2 → approve → done, state stays at prd-review throughout) and one for **Decline Feature** (prd-review → done, no decompose).
- `golden-bug.spec.ts` — golden bug happy path: seed → investigate (high-confidence) → dev → QA → review → approve → done. Covers Investigation / QA / Review / Timeline (pr.opened) surfaces. Trace + video on every run.
- `golden-bug-iterations.spec.ts` — golden bug with multi-iteration QA loop: two QA fails then pass, exercising `dispatchQaFailed` (qa-failed → needs-fix → in-progress → needs-qa) twice before review/approve.
- `golden-chore.spec.ts` — golden chore happy path: seed → triage → dev → QA → review → approve → done. Simplest type (no grilling, no investigation); proves the minimal pipeline while still touching every applicable UI surface.
- `golden-needs-human.spec.ts` — golden escalation path: three QA failures exhaust DEFAULT_MAX_RETRIES=2, escalating to factory:needs-human. Asserts gate-pending-banner renders with the QA action button. Human resumes via UI (gate-action-send-to-qa), then a fourth QA pass and full cycle to done. Verifies agent.retry-escalated event on the timeline.
- `golden-gate-denied.spec.ts` — golden human rejection path: chore driven to factory:approved, then rejected via ApprovalGateSection UI (reject-btn → reject-reason-input → reject-submit). Verifies approved → needs-fix transition and gate.rejected event on the timeline. Second cycle drives to done.
- `golden-bug-low-confidence.spec.ts` — golden low-confidence investigation gate: bug with outcomes.investigate='low-confidence' routes to factory:gate-pending. Human fills notes in investigation-proceed-gate and clicks proceed-button → dev-ready. Covers Investigation section testids and the full pipeline to done.
- `golden-review-sendback.spec.ts` — golden review sendback path: bug with outcomes.review=['needs-fix','pass']. First review returns needs-fix → needs-fix state, review-section asserted. Fix-feedback loop re-runs; second review passes → approved → done. Verifies two review.completed events on the timeline.

**`discover-lane.spec.ts` vs. `grill-prd-flow.spec.ts`**: The regular `grill-prd-flow.spec.ts` (in `e2e/`) is a pure UI stub — all API calls are route-intercepted, no real server. `discover-lane.spec.ts` uses the full pipeline harness (real mock server, seed-issue, /tick, /dispatch) so it covers the server→UI round-trip including state-gated tab visibility and the approve-prd state machine path.
