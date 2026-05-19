# M9 Remaining Work Plan

**Active milestone:** M9: Retrospective and Learning Loop  
**Branch convention:** `feat/m9-issue-<N>` from `main`  
**Design reference:** `docs/design/harness-2-1/project/` (Harness 2.1)

## State of play

### Shipped (merged to main)
- ✅ `core/retrospective/schemas.ts` — DecisionRecord, LearningEntry, QualityScore, DecisionPattern, ImprovementCandidateSchema, DecisionSummarySchema, CONVERGENCE_THRESHOLD
- ✅ `skills/retrospective-light/` + `skills/retrospective-deep/` — full skill packages (schema, config, skill.md, README, slice.test.ts)
- ✅ `core/workflows/retrospective.ts` — tier-selection workflow (always-light / always-deep / auto with 4 triggers)
- ✅ `core/persona/accumulate.ts` + `persona_stats` DB table — running-average quality stats per persona
- ✅ `apps/web` — Retrospective tab (RetrospectiveSection.tsx), 11-section LeftRail with icons (Brain, Bug, Eye, RotateCcw, etc.), RightRail widened to 320px

### Still to build (open GitHub issues, all schedule:current)
| Issue | Title | Depends on |
|---|---|---|
| #263 | M9.05: Roster UI — per-role persona list | #262 ✅ |
| #264 | M9.06: Improvement candidates table and surfacing in Roster | #260 ✅, #262 ✅ |
| #265 | M9.07: Improvement-candidate-to-Factory-issue promotion flow | #264 |
| #266 | M9.08: Cost dashboard — per-stage cost breakdown | #259 ✅ |
| #267 | M9.09: Estimated vs exact cost labelling throughout UI | #266 |

---

## Issue-by-issue implementation guide

### #263 — Roster UI (M9.05)

**What it is:** A new page at `/projects/:slug/roster` listing all personas grouped by role, with stats from `persona_stats` and drill-in to run history. Improvement candidates (pending from future #264) surfaced per persona.

**Acceptance criteria (verbatim from issue):**
- Roster page accessible from main nav
- Personas grouped by role (Triage, Investigator, Dev, QA, Reviewer, Retrospector)
- Each persona card: name, role, runs_total, avg_quality_score, last_run_at
- Drill-in panel shows run history for selected persona
- Improvement candidates section visible on persona drill-in (empty list until #264 ships)
- Empty state for personas with no runs yet
- Playwright e2e

**Design reference:** `docs/design/harness-2-1/project/chrome.jsx` → `RightRail` → `PersonaRow` component. Style:
- Avatar chip (24px, tinted by role hue via CSS variable `--p-<name>`)
- Name (13px 500), role (11px fg-3), status dot (6px, colour per state), focus text (11.5px fg-3)
- Match persona colour convention: aster=cyan(200), bram=orange(32), niko=green(142), vega=violet(290), cyra=magenta(340)

**Files to create:**
- `apps/web/src/components/roster/` — feature folder per STANDARDS.md
  - `components/RosterPage.tsx` — main page
  - `components/PersonaCard.tsx` — card for each persona
  - `components/PersonaDrillIn.tsx` — slide-in/panel showing run history
  - `slice.test.ts`
- `apps/server/src/domains/personas/router.ts` — GET `/projects/:slug/personas` returning persona_stats rows
- Update `apps/web/src/lib/api.ts` — add `fetchPersonas(slug)`
- Update `apps/web/src/lib/types.ts` — add `PersonaStatsDto`
- Update `apps/web/src/App.tsx` (or router) — add `/projects/:slug/roster` route
- Update chrome nav — add Roster link (after Board)
- `apps/web/e2e/m9-roster.spec.ts`

**DB query:** `SELECT * FROM persona_stats WHERE projectId = ?` grouped by role. The existing `core/persona/accumulate.ts` writes these rows.

---

### #264 — Improvement candidates table (M9.06)

**What it is:** Drizzle migration + backend for `improvement_candidates` table; surface in Roster persona drill-in with approve/reject buttons.

**Acceptance criteria:**
- `improvement_candidates` DB table: id, persona_name, source_task_id, suggestion_text, suggestion_type (prompt/skill/config), status (pending/approved/rejected), created_at
- Retrospective workflow populates from skill output after each retro run
- Roster persona drill-in lists pending candidates with approve/reject buttons
- Approve/reject status persisted on click
- `slice.test.ts` covers candidate creation + status update

**Schema column → LearningEntry mapping** (from `core/retrospective/schemas.ts`):
```
id                → generated UUID
persona_name      → LearningEntry.personaName
source_task_id    → LearningEntry.sourceRunIds[0]
suggestion_text   → LearningEntry.observation
suggestion_type   → LearningEntry.improvementKind
status            → 'pending' on insert
created_at        → now()
```

**Files to touch:**
- `core/db/schema.ts` — add `improvementCandidates` table
- `core/workflows/retrospective.ts` — after retro skill runs, extract `improvementCandidates` from output and insert rows
- `apps/server/src/domains/improvement-candidates/router.ts` — GET `/projects/:slug/personas/:personaName/candidates`, PATCH `/:id/status`
- `apps/web/src/components/roster/components/PersonaDrillIn.tsx` — add candidates list + approve/reject UI
- `apps/web/src/lib/api.ts` — add `fetchCandidates`, `updateCandidateStatus`

---

### #265 — Candidate-to-Factory-issue promotion flow (M9.07)

**What it is:** Approving a candidate creates a GitHub issue in `shaunnez/goose-hub`. Backend only (UI change is approve button already built in #264).

**Acceptance criteria:**
- Approving triggers issue creation via GitHub API
- Issue title: `[improvement] <suggestion_text>`
- Issue body: source task link, persona name, suggestion type, full candidate text
- Labels: `type:improvement`, `schedule:later`
- `improvement_candidates.github_issue_url` updated on success
- Error state handled (candidate stays approved with error note)
- `slice.test.ts`

**Files to touch:**
- `core/connectors/github/create-improvement-issue.ts` — new function wrapping the GitHub Issues API
- Update approval handler in server to call this after status update
- Update `improvement_candidates` schema: add `github_issue_url` + `error_note` columns

---

### #266 — Cost dashboard (M9.08)

**What it is:** A new `/projects/:slug/costs` page showing total/weekly/monthly costs and per-stage breakdown. Replaces the `DeferredSurface` on the Costs tab.

**Design reference:** `docs/design/harness-2-1/project/sections-d.jsx` → `Costs` function. Key elements:
- **Stat grid** (4 cells): Spent, Tokens (in/out), Projected, Cost/loc
- **Per-persona breakdown table**: avatar, model, tokens (k), cost ($), mini bar chart, operations description
- **Per-stage view**: total by stage (Triage, Investigate, Dev, QA, Review, Retrospective)

**DB:** Uses `agent_run_costs` table (add to schema): run_id, stage, model_id, input_tokens, output_tokens, cost_usd, cost_label ('estimated'|'exact').

**Acceptance criteria:**
- `agent_run_costs` table added
- Agent run completion populates cost row from output metadata
- Cost dashboard page accessible from main nav
- Dashboard shows: total this week/month + per-stage breakdown
- Costs tab in task detail shows per-task cost (already has `DeferredSurface` slot)
- `slice.test.ts`

**Files to touch:**
- `core/db/schema.ts` — add `agentRunCosts` table
- `apps/server` — GET `/projects/:slug/costs` endpoint
- `apps/web/src/components/costs/` — new feature folder
  - `CostsDashboardPage.tsx`
  - `slice.test.ts`
- Update Costs tab in `DetailPage.tsx` — replace `DeferredSurface` with `CostsDashboardSection`

---

### #267 — Estimated vs exact cost labelling (M9.09)

**What it is:** Cost values sourced from Claude CLI = estimated (`~$0.04`); from API metadata = exact (`$0.04`). The distinction is shown throughout the UI.

**Acceptance criteria:**
- CLI-sourced costs stored with `cost_label = 'estimated'`
- API-sourced with `cost_label = 'exact'`
- Cost dashboard: estimated renders with `~` prefix or "est." badge
- Costs tab in detail: same convention
- Tooltip/legend on first encounter
- `slice.test.ts`

**Files:** Builds on #266. Only UI/label changes + `cost_label` propagation in the cost persistence layer.

---

## Process for each issue

1. Label `factory:in-progress` on GitHub
2. `git checkout main && git checkout -b feat/m9-issue-<N>`
3. Follow TDD: write failing tests first, then implement
4. `pnpm typecheck && pnpm biome check --fix && pnpm vitest run <test-file>`
5. Commit only the relevant files
6. Push, open PR with `Closes #N`
7. Check off ACs on issue, transition to `factory:needs-qa`

---

## Design conventions to follow

All section pages use the Shell/Card pattern from the design:

```tsx
// Shell wraps a page section
<div className="px-7 py-6 flex flex-col gap-5 max-w-[1100px] mx-auto section-anim">
  <div className="flex items-end gap-3">
    <div className="flex-1">
      <div className="eyebrow mb-1.5">05 · Roster</div>
      <div className="text-[18px] font-semibold tracking-tight">Persona roster</div>
    </div>
  </div>
  {/* Card blocks below */}
</div>

// Card wraps a data block
<div className="card">
  <div className="row gap-3 px-4 py-3 border-b border-line">
    <div className="text-[13.5px] font-semibold">{title}</div>
  </div>
  <div className="p-4">{children}</div>
</div>
```

Persona avatars: `<span className="avatar sm {personaClass}">{initials}</span>` where class is `aster`, `bram`, `niko`, `vega`, `cyra` — defined in `src/index.css` via `--p-*` tokens.

Stat grids: `display: grid; grid-template-columns: repeat(N, 1fr)`. Each cell is a `card` with `eyebrow` label, large mono number, sub-label.

---

## Key files to read before touching anything

- `CLAUDE.md` — factory rules, PR conventions
- `CONTEXT.md` — canonical domain vocabulary, improvement candidate spec, persona routing
- `FACTORY_RULES.md` — vertical slices, no cross-slice imports
- `apps/web/STANDARDS.md` — feature folder structure, shared lib rules
- `apps/server/README.md` — before touching server
- `apps/web/README.md` — before touching web
- `docs/design/harness-2-1/project/sections-d.jsx` — Costs page reference
- `docs/design/harness-2-1/project/chrome.jsx` — PersonaRow/RightRail reference
