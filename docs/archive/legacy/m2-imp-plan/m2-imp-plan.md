# Plan — Adopt Harness 2.1 design as the M2 UI foundation

## Context

The design at `https://api.anthropic.com/v1/design/h/IZr5PSAkNOIEmVHInHZP1A` (bundle **Harness 2.1**, project ID `019dd736-729a-7894-94e2-b1c75a3bfc4b`) is a hi-fi HTML/CSS/JSX prototype that maps almost 1:1 to Goose Hub's UI surface set in `docs/PLAN.md` §21 + §31. Per the bundle README we treat it as a visual/IA contract and re-implement it in our real stack (React + Vite + shadcn/ui + Tailwind), not as code to drop in.

The bundle ships:
- A **Board** kanban view (illustrative 5 columns — overridden by Goose Hub's 11-lane / 9-default-visible config from PLAN §10)
- A **Task Detail** surface with a left rail of 10 sections (Overview · Repo Selection · Investigation · PRD · Code · QA · Review · Timeline · Chat · Costs), top breadcrumb, task header, right rail (live agent ticker + persona roster)
- `tokens.css` design system (oklch palette, dark-first, Inter + JetBrains Mono, motion timings, persona hues)
- A Tweaks panel for theme/accent/density/surface — **not adopted** (per direction below)
- A slide-in sidebar variant of Task Detail — **not adopted** (per direction below)

M2 (`docs/PLAN.md` §28) is the **First Operable UI** milestone: scaffold `apps/server` + `apps/web`, ship the app shell, kanban with the 9 default-visible lanes, an issue card, a read-only detail surface with timeline, one write action (state transition), and a Playwright happy-path. No agents, no costs, no fake runs. The design covers M2 plus a lot of M3–M9 territory; this plan adopts the design's chrome and IA in M2 and stubs the rest so the surface stops getting re-litigated each milestone.

The 11 M2 issues already exist in `shaunnez/goose-hub` (#26–#36). This plan is the umbrella architectural plan; per `CLAUDE.md` we still execute one issue at a time and each issue gets its own PR.

User-confirmed direction (from this session):
- **No tweaks panel** — drop entirely.
- **Full-takeover detail surface**, not a slide-in drawer. The detail surface is a routed page (e.g. `/projects/:slug/items/:id`) with a "Board" back button, J/K prev/next, and `⌘[` close-to-board. Issues **#33 and #34 will be amended** to reflect this when we pick them up (per `CLAUDE.md` "How to approach a task" — the issue is the build spec; we update it before implementation rather than silently deviating).
- **Balanced density only** — port the `[data-density="balanced"]` token set from the design as the single density. No toggle.
- **Stub all 10 left-rail sections in nav**; only Overview + Timeline functional in M2; others render a small "Available in M&lt;N&gt;" empty-state.
- **Right rail + agent chrome render with empty-state copy** ("No agent runs yet — agents arrive in M4"). No fake/hardcoded persona data, per FACTORY_RULES rule 6.
- **Add navigation pointers to deferred surfaces** at both levels (global sidebar and detail-page rail). Do not build the components themselves.
- If GitHub access fails for any sub-task, drop a per-issue note in `docs/cloud-work/m2/<issue-number>.md` so it's reviewable later. (GitHub access works in this session, so no notes needed yet.)

## Resolution: design ↔ governance vocabulary

Where the design and our governance disagree, governance wins; the design is illustrative.

| Design says | Goose Hub uses | Source |
|---|---|---|
| "Harness", "Tasks", `TAS-1662` | "Goose Hub", "Work Items", repo-qualified ref `github:owner/repo#N` | `CONTEXT.md` |
| 5 board columns | 11 lanes / 9 default-visible (Triage, Discover, Research, Investigation, Dev, QA, Review, Retrospective, Blocked, Done; Archive + Rejected hidden) | PLAN §10, issue #31 |
| Mock task `TAS-1662` | Real GitHub issues from `goose-hub-self` via `StateSource` | PLAN M2 |
| Personas Aster/Bram/Niko/Vega/Cyra | M3+ concept; M2 surfaces have no persona data | PLAN §23 |
| Cost / elapsed / progress chips | M9 concept; render empty-state copy in M2 | PLAN §28 |
| Slide-in sidebar variant | Not adopted; full-takeover only | this session |
| Tweaks panel | Not adopted | this session |

## Deferred-surface navigation (built in M2, components not built)

Per direction, M2 ships the nav pointers and a shared `<DeferredSurface milestone="M5" surface="Repo Selection" />` empty-state component. Each pointer renders the same stub with milestone-aware copy.

**Global sidebar (`apps/web/src/components/chrome/Sidebar.tsx`)** — slots in PLAN §31 priority order:
- Project switcher (M2.04 — built)
- Milestone selector (M2.05 — built)
- Kanban (M2.06 — built, default route)
- Inbox → stub, "Available in M3"
- Roster → stub, "Available in M5"
- Milestones → stub, "Available later (use the milestone selector for now)"
- Settings → stub, "Available later"
- Bootstrap → stub, "Available in M12"

**Detail-page left rail (`apps/web/src/components/detail/LeftRail.tsx`)** — all 10 keys from the design:
- Overview (M2.08 — built)
- Repo Selection → stub, "Available in M5"
- Investigation → stub, "Available in M6"
- PRD → stub, "Available in M5 / M7"
- Code → stub, "Available in M7"
- QA → stub, "Available in M8"
- Review → stub, "Available in M8"
- Timeline (M2.09 — built)
- Chat → stub, "Coming later"
- Costs → stub, "Available in M9"

The stub is deliberately small and dignified — a section header with the milestone tag and a one-line sentence — not a full empty-state hero. This satisfies "appropriate UI for links/navigation … just don't build the actual components."

## Task header / right rail in M2

The design's task header carries: state pill, priority pill, cost pill, persona-on-deck chip, progress strip. M2 renders only the **state pill** (from the GitHub label) and **priority pill** (from `priority:*` label); the other three render as empty-state placeholders ("No agent runs yet — agents arrive in M4") or are hidden when their data is structurally absent.

Right rail: rendered with its frame, header, and a single empty-state body block. The live ticker and persona roster components are not implemented.

## Per-issue design adoption

Each filed M2 issue picks up a specific slice of the design contract. No new issues are created.

| Issue | Title | Design surface adopted | Adoption notes |
|---|---|---|---|
| **#26** | M2.01 — apps/server API skeleton + SSE | none (no UI) | SSE feeds the right-rail empty-state on M2 and the live ticker post-M3. Implement `core/event-stream/store.ts` `appendEvent()` chokepoint per CONTEXT.md (single writer, durability before emit). |
| **#27** | M2.02 — apps/web Vite + React + shadcn/ui scaffold | `tokens.css` ported here | Port `tokens.css` to `apps/web/src/styles/tokens.css`; load Inter + JetBrains Mono via `@fontsource`. Set `data-theme="dark"` and `data-density="balanced"` on `<html>` as defaults. Dark-only in M2. |
| **#28** | M2.03 — App chrome: sidebar + top bar | `chrome.jsx` `BreadcrumbBar` (top bar) + global sidebar from PLAN §31 | Top bar carries breadcrumb + a small "Goose Hub" wordmark; sidebar carries the deferred-surface stubs listed above. **No** tweaks panel. **No** theme toggle for M2. |
| **#29** | M2.04 — Project switcher | sidebar item, design tokens | Goose-hub-self only; color stripe from `project.config.ts` (`#7c3aed`). |
| **#30** | M2.05 — Milestone selector | sidebar item below project switcher | Active milestone defaults to lowest-numbered open per PLAN §12.1. |
| **#31** | M2.06 — Kanban board layout | `board.jsx` `BoardView` + `BoardColumn` | **9 default-visible lanes** from PLAN §10, sourced via `ui/kanban/lanes.config.ts`. Strip the design's column header sparkline; keep label + count + "+" stub. Lane visibility toggle persists to `project_state` (per acceptance criteria's "your call; document the decision" — choose `project_state` for cross-session persistence; document in slice README). |
| **#32** | M2.07 — Issue card | `BoardCard` | Strip persona dot, cost pill, sparkline. Show: priority dot, issue number, title, type pill, age, state pill. Order in lane: priority desc, issue number asc (matches scheduler eligibility sort). |
| **#33** | M2.08 — Issue detail surface | Full Task Detail surface (full-takeover), `LeftRail`, `TaskHeader`, `RightRail` (empty-state) | **Issue body must be amended before implementation** to: (a) re-title to "M2.08 — Issue detail page", (b) drop slide-over wording, (c) replace with full-takeover routed page (`/projects/:slug/items/:id`), back-to-Board button, `⌘[` close, J/K prev/next within current milestone+lane filter. Acceptance criteria gain: 10-section left rail with Overview functional and 8 stubs. |
| **#34** | M2.09 — Timeline panel | Section 8 of the design (Timeline) | **Issue body must be amended** to drop "below the body in the drawer" wording — Timeline is now its own routed sub-section reached via `/projects/:slug/items/:id/timeline`. Reads `events` table; SSE-refreshes on `state.transitioned` (and any future event kind for the open item). |
| **#35** | M2.10 — Manual state transition | Action button in `TaskHeader` (Overview section) | `legalTargets(from)` from `core/state-machine/transitions.ts`; popover shows only legal next states. POST emits `state.transitioned` event via `appendEvent()`; optimistic card move on Board with rollback on 422. |
| **#36** | M2.11 — Playwright happy-path | none (test harness) | Test runs against the real `shaunnez/goose-hub` repo using `GITHUB_TOKEN`. Skips gracefully when token absent. Steps: open app → goose-hub-self auto-selected → kanban visible → click card → routed full-takeover page renders → Overview shows body+labels → Timeline section renders → transition state → card moves lane → GitHub label changes within 5s. |

The two issue-text amendments (**#33**, **#34**) are best done as part of the PR that picks each issue up, with the amended body landing in the same PR description and a leading comment on the issue noting the change and citing this plan + Harness 2.1.

## Critical files

**Design source (read-only reference, do not import):**
- `/tmp/design-fetch/harness-2-1/README.md`
- `/tmp/design-fetch/harness-2-1/chats/chat1.md`
- `/tmp/design-fetch/harness-2-1/project/tokens.css` — port to `apps/web/src/styles/tokens.css`
- `/tmp/design-fetch/harness-2-1/project/chrome.jsx` — visual contract for `BreadcrumbBar`, `TaskHeader`, `LeftRail`, `RightRail`
- `/tmp/design-fetch/harness-2-1/project/board.jsx` — visual contract for `BoardView`, `BoardColumn`, `BoardCard`
- `/tmp/design-fetch/harness-2-1/project/sections.jsx` (Overview reference), `sections-d.jsx` (Timeline reference)
- `/tmp/design-fetch/harness-2-1/project/icons.jsx` — map onto `lucide-react` where shapes match; custom SVG only when no equivalent

**To create in this repo (each as a vertical slice per FACTORY_RULES rule 24, with `slice.test.ts` + `README.md`):**
- `apps/server/src/index.ts` + routes from #26
- `core/event-stream/store.ts` (`appendEvent()` chokepoint per CONTEXT.md)
- `core/event-stream/sse.ts`
- `apps/web/src/styles/tokens.css` — ported, balanced-density values inlined
- `apps/web/src/components/chrome/{AppShell,Sidebar,TopBar,BreadcrumbBar}.tsx`
- `apps/web/src/components/detail/{DetailPage,LeftRail,TaskHeader,RightRail,DeferredSurface,OverviewSection,TimelineSection}.tsx`
- `apps/web/src/components/board/{Board,BoardColumn,IssueCard}.tsx`
- `apps/web/src/lib/lanes.config.ts` — 11 lanes from PLAN §10

**To reuse (do not rebuild):**
- `core/state-source/` (GitHubLabelsSource) — kanban + transitions read/write through it
- `core/state-machine/transitions.ts` (`legalTargets`, `isLegalTransition`) — issue #35 calls these
- `core/db/` (Drizzle schema, ADR 0004) — `events`, `project_state`, `milestone_meta`
- `target-projects/goose-hub-self/project.config.ts`

**ADR to add as part of #28 (M2.03):**
- `docs/adr/0005-ui-design-system.md` — record the decision to adopt Harness 2.1 tokens + 10-section IA, the Goose Hub vocabulary mapping, the full-takeover-only surface choice, balanced-density-only choice, and the deferred-surface stubbing strategy. Required by `CLAUDE.md` step 3a since #28 is the first PR that introduces UI conventions consumed by every subsequent slice.

## Out-of-scope for M2 (deferred surfaces with their owning milestone)

- Repo Selection → M5 · Investigation → M6 · PRD → M5 (decompose) + M7 (full) · Code/diff → M7 · QA → M8 · Review → M8 · Costs → M9 · Chat → unscoped
- Right rail live ticker + persona roster → M3 (placeholders) → M4 (real)
- Task header cost / persona-on-deck / progress strip → M3+/M9
- Tweaks panel, accent picker, reduce-motion, density toggle → not on the roadmap; revisit at M17 if at all
- Slide-in sidebar variant → dropped
- All Projects board, Inbox, Roster, Settings, Bootstrap wizard → M10 / M3 / M5 / M9 / M12

## Verification

End-to-end (Playwright covers steps 4–7 per #36):
1. `pnpm install` succeeds with the new `apps/web` and `apps/server` workspaces.
2. `pnpm --filter @goose/web dev` boots Vite; the app shell renders with Harness tokens applied at `data-theme="dark"` `data-density="balanced"`.
3. `pnpm --filter @goose/server dev` boots; `curl -N http://localhost:<port>/events` keeps the SSE connection open and replays from `Last-Event-ID`.
4. With `target-projects/goose-hub-self` configured and `GITHUB_TOKEN` set, opening the app shows real GitHub issues from `shaunnez/goose-hub` grouped into the 9 default-visible lanes; the 2 hidden lanes are togglable.
5. Open the milestone selector → pick "M2: First Operable UI" → only that milestone's issues render.
6. Click an issue → routed full-takeover page (`/projects/goose-hub-self/items/<n>`) opens. Overview shows body + labels. Timeline renders (empty-state on first run; populates after a state transition). The other 8 left-rail sections render the `DeferredSurface` stub.
7. From Overview, transition `factory:triaging` → `factory:accepted`. The Board card moves lane optimistically; within 5s `gh issue view <n>` shows the new label; a `state.transitioned` event arrives via SSE and appears in Timeline.
8. Try an illegal transition (e.g. `factory:done` → `factory:triaging`); server returns 422, UI surfaces the message, GitHub label is unchanged, optimistic move rolls back.
9. Sidebar nav: clicking Inbox / Roster / Milestones / Settings / Bootstrap renders the `DeferredSurface` stub with the right milestone tag.
10. `pnpm test:e2e` runs the Playwright happy-path; `pnpm lint && pnpm typecheck && pnpm test` all clean. CI green.

## Locked-in tech picks (confirmed this session)

- **Routing**: React Router v6 (`react-router-dom`) — for #27, #33.
- **Server framework**: Hono — for #26. ADR `docs/adr/0006-server-framework-hono.md` lands alongside #26.
- **Lane visibility persistence**: `project_state` SQLite table (cross-session) — documented in #31's slice README.

## Execution order — sync vs. parallel waves

GitHub already labels each issue with `exec:serial` or `exec:parallel`. Combining those labels with the `Depends on …` chains in each issue body produces seven dependency waves. Inside a wave, all issues can run in parallel. Across waves, run sequentially.

| Wave | Issues (run in parallel) | Gates / dependencies |
|---|---|---|
| **1** | **#26** (M2.01 server+SSE), **#27** (M2.02 web scaffold) | No prereqs. |
| **2** | **#28** (M2.03 chrome) | After #27. Lands ADR 0005 (UI design system) and ports `tokens.css`. |
| **3** | **#29** (M2.04 project switcher), **#31** (M2.06 kanban + lane config) | After #26 + #28. |
| **4** | **#30** (M2.05 milestone selector), **#32** (M2.07 issue card) | #30 after #26 + #29; #32 after #31. |
| **5** | **#33** (M2.08 detail surface — full-takeover) | After #32. PR also amends #33 body to drop "drawer" wording. |
| **6** | **#34** (M2.09 timeline), **#35** (M2.10 state transition) | Both after #26 + #33. PR for #34 amends issue body to drop "below the body in the drawer" wording. |
| **7** | **#36** (M2.11 Playwright happy-path) | `exec:serial` — runs alone. After every other M2 issue is merged. |

This produces 5 parallel pairs and 2 solo waves, so a determined run can land M2 in 7 sequential merge windows instead of 11.

## Per-issue model recommendation

Default model per issue, picked from the available roster (Opus 4.7 for architectural / cross-cutting work, Sonnet 4.6 for component-and-wiring work, Haiku 4.5 for narrow mechanical work). Override at execution time if you disagree.

| Issue | Recommended model | Why |
|---|---|---|
| **#26 M2.01** server + SSE + `appendEvent()` chokepoint | **Opus 4.7** | Single-writer durability rule, Last-Event-ID replay, ADR 0006. Highest architectural risk in M2 — a wrong cut here echoes through every later milestone. |
| **#27 M2.02** Vite + React + shadcn scaffold | **Haiku 4.5** | Mechanical CLI bootstrap, well-trodden recipe, no design judgement required. |
| **#28 M2.03** App chrome + ADR 0005 + tokens port | **Opus 4.7** | Sets the visual contract everything else inherits. Owns the design-system ADR. Wrong here = expensive to roll back. |
| **#29 M2.04** Project switcher | **Sonnet 4.6** | Component + sidebar slot. |
| **#30 M2.05** Milestone selector | **Sonnet 4.6** | Read+write API wiring, milestone-default heuristic from PLAN §12.1. |
| **#31 M2.06** Kanban + lane config + visibility persistence | **Sonnet 4.6** | Moderate; touches `project_state` and lane config; but pattern is well-defined by design + PLAN §10. |
| **#32 M2.07** Issue card | **Haiku 4.5** | Pure presentational component with one click handler; ordering rule trivial. |
| **#33 M2.08** Detail surface (full-takeover, 10-section rail) | **Opus 4.7** | Largest UI piece, routing scheme, J/K nav, deferred-surface stub component, issue-body amendment. Cross-cutting design impact. |
| **#34 M2.09** Timeline panel + SSE refresh | **Sonnet 4.6** | Component + SSE subscription + issue-body amendment. Pattern from #26 already established. |
| **#35 M2.10** State transition write path | **Opus 4.7** | Touches `core/state-machine` legal-transition table + GitHub write + optimistic UI rollback + event emission. State integrity is the core M2 outcome — keep this on the strongest model. |
| **#36 M2.11** Playwright happy-path | **Sonnet 4.6** | Test orchestration; mechanical but needs care around `GITHUB_TOKEN` skip path, optimistic rollback assertion, and 5s SLA. |

Tally: **3 issues on Opus 4.7** (#26, #28, #33, #35 — actually 4), **5 on Sonnet 4.6**, **2 on Haiku 4.5**. Adjust live if budgets / availability change; the per-issue PR is the only thing that has to commit.

## Post-approval actions (cannot run in plan mode)

1. Copy this plan from `/root/.claude/plans/fetch-this-design-file-sharded-pizza.md` to `docs/m2-imp-plan/m2-imp-plan.md` so it survives a session crash and is reviewable on GitHub. Create the directory if it doesn't exist.
2. No other writes happen until you say "go" on a specific issue.
