# M11 Exit Audit — Dependency-aware Scheduling

**Date:** 2026-05-07
**Active milestone (per `target-projects/goose-hub-self/project.config.ts`):** `M11: Dependency-aware Scheduling`
**Auditor:** Claude (`claude/exit-audit-milestone-11-maIoC`)
**Audit framework:** `docs/exit-audit.md` + `docs/PLAN.md` section 28 (M11)

The human reviews this report and decides whether to close M11. This agent does not close the milestone, advance the active milestone, or file follow-up issues.

> **Update — same-PR follow-ups landed.** The three soft-check follow-ups (checks 7, 10, 11) were
> addressed in this PR after audit submission, on user request:
> - Check 7 (ADRs): added ADRs 0024 (cross-run learning loop), 0025 (skill-coach feedback loop),
>   0026 (predictive model router), 0027 (workflow init smoke gate), 0028 (playbook portability +
>   description-loop eval).
> - Check 10 (layout): top-level `plans/` moved to `docs/plans/`; PLAN section 6 amended to
>   acknowledge top-level `hooks/` (kept where it is — `.claude/hooks/` is governance-protected
>   from agent writes, so SDLC-hook source files for `writeWorkspaceSandbox()` must live outside)
>   and the new `docs/plans/`, `docs/audits/`, `docs/standards/` subdirs. Section 6 also now
>   reflects the M11 core/* additions (state-source dep parser/resolver, projects dep-scheduler
>   /parallel-lock/move-with-deps, learning/*, workflows cross-run-retro/skill-coaching,
>   orchestrator/smoke, agent-runtime budgets/model-router).
> - Check 11 (README): added a "Dependency-aware Scheduling & Learning Loop (M11)" section,
>   refreshed the CLI command list (`task move`, `playbook export/import`), updated the skills
>   roster, and rolled the new ADRs into the ADR summary.
>
> The body of this report below captures the audit's original findings; consider checks 7, 10,
> and 11 as PASS once this PR merges.

---

## Generic checks

### Check 1 — All milestone issues closed
Status: **PASS**
Notes: 27 issues in `M11: Dependency-aware Scheduling`, all closed. No `factory:in-progress` orphans. 19 task issues (M11.01–M11.19) plus M11.20 (#567 PR) shipped; six off-roadmap items (#509, #511, #513, #516, #518, #522, #568, #569 etc.) closed/archived.

### Check 2 — Headline exit criterion met
Status: **PASS**
Notes: Headline ("create A `Depends on #B`; scheduler refuses; close B; scheduler dispatches; cross-repo, move-with-deps, multi-parallel cases tested") is verifiably covered by `slices/dep-scheduling-integration/slice.test.ts` (12 tests across 6 describes: same-repo two-tick unblock, cross-repo registered, unregistered escalation + idempotence, move-with-deps `--with`/`--ignore`, parallel dispatch with `maxParallelAgents=2` cap and project isolation, plus a live-GitHub-API smoke gated by `GITHUB_TOKEN`). All pass under `pnpm test`.

### Check 3 — Abstractions used, not bypassed
Status: **PASS**
Notes: `apps/cli/src/index.ts` calls `moveIssueToCurrent` and `DepMoveMode` from `@goose-hub/core/projects/move-with-deps.js`. `apps/web/src/lib/dependency-parser.ts` is an explicit client-side mirror of `core/state-source/dependency-parser.ts` with a header comment naming core as the source of truth (acceptable mirror, not a bypass — the regexes match). Scheduler dep filter and parallel lock are consumed via `core/projects/dependency-scheduler.ts` and `core/projects/parallel-lock.ts`. No native `fetch()` reimplementing GitHub adapters in surface code.

### Check 4 — Slices import only via core interfaces
Status: **PASS**
Notes: All M11 slices (`dependency-scheduler/`, `dep-scheduling-integration/`, `move-with-deps/`, `parallel-lock/`, `sdlc-hooks/`, `smoke-gate/`, `playbook-portability/`, `description-loop/`) ship `slice.test.ts` + `README.md` only and import from `@goose-hub/core/...` (no slice-to-slice imports detected via `grep`). No empty `ui.tsx` placeholders.

### Check 5 — Tests, lint, typecheck
Status: **PASS**
Notes: `pnpm install --frozen-lockfile` clean. `pnpm typecheck` passes. `pnpm lint` (biome): "Checked 464 files in 484ms. No fixes applied." `pnpm test`: 149 test files, 2167 passed / 2 skipped / 0 failed in 42.4s.

### Check 6 — CI passes on a fresh PR
Status: **PASS**
Notes: PR #578 (M11.10 dep-scheduling integration tests, the most recent merge) shows three green checks — `Lint, typecheck, test` (1m27s), `Pipeline E2E (mock)` (1m19s), `close-issues` (5s). Total wall time ≈1m30s — well under the 3-minute target.

### Check 7 — ADRs exist for core changes
Status: **FOLLOW-UP-NEEDED**
Notes: M11 added two ADRs — `0022-skill-file-convention-consolidation.md` and `0023-relax-per-project-workflow-lock.md`. Several large `core/` additions ship without dedicated ADRs and arguably warrant them: `core/learning/{archive,mine,convergence,description-loop,playbook-export,playbook-import,playbook-stats}.ts` (M11.11/.18/.19), `core/workflows/{cross-run-retro,skill-coaching}.ts` (M11.12/.13/.14), `core/orchestrator/smoke.ts` (M11.17), and the predictive model router (M11.15). These are non-trivial cross-skill mechanisms; recommend filing follow-up ADRs (or one consolidated "M11 learning loop" ADR) before M12 lands.

### Check 8 — No scope creep from later milestones
Status: **PASS**
Notes: No M12 project-bootstrap workflow scaffolding; no graphical dep-tree UI; no critical-path code (`grep` for `criticalPath`, `auto.promot`, `TreeView` returned nothing relevant). New core directories (`core/learning/`, `core/projects/{dependency-scheduler,parallel-lock,move-with-deps}.ts`, `core/orchestrator/smoke.ts`) all map to M11 included scope or M11.16-19 patches.

### Check 9 — Governance files unchanged by Factory PRs
Status: **PASS** (with note)
Notes: Per FACTORY_RULES rule 12 the system-owner-amendment exception applies. Direct human pushes touched governance (`511b9de`, `fbd154e`, `eb4fdb7` — human-author edits to FACTORY_RULES.md / PLAN.md) — these are out-of-scope of rule 12. PR #537 (`docs: M11 mid-milestone governance refresh`) is explicitly human-driven (commit body: "Filed by direct repo access per FACTORY_RULES rule 12; not a Factory PR"). One borderline case: PR #547 (M11.14, Claude co-authored) added a `coachPolicy` block to both `target-projects/goose-hub-self/project.config.ts` and `target-projects/nannymudnz/project.config.ts`. The committer-of-record is the human system owner, and rule 12 carves out human amendments — so it does not fail the strict rule wording — but the work itself was Factory-driven. Recommend tightening the convention: in future, Factory work that requires a project-config field should land the field via a separate human-authored PR (or a `factory:bootstrap-pr`-tagged PR) rather than rolling it into the feature PR.

### Check 10 — Repo structure matches PLAN section 6
Status: **FOLLOW-UP-NEEDED**
Notes: Two new top-level directories not present in PLAN section 6:
- `hooks/` (`require-spec.sh`, `stop-verify-ac.sh`) — added by PR #570 (M11.16 SDLC enforcement hooks). PLAN section 6 only lists `core/agent-runtime/hooks/` ("future"). These shell hooks are wired into the Claude CLI runtime, not the agent runtime, so a top-level location is defensible — but PLAN section 6 should be amended to acknowledge the directory.
- `plans/` (`retro-schema-drift-fix.md`, `skill-convention-consolidation.md`) — design scratch-pads landed alongside human-driven cleanup work. Not code; arguably belong in `docs/` or removed. Recommend either moving these under `docs/plans/` or deleting them and folding the durable parts into ADRs.

Otherwise structure matches: `apps/{cli,server,web}`, `core/{state-machine,state-source,event-stream,db,projects,agent-runtime,tool-layer,workspaces,persona,retrospective,cost,workflows,connectors,orchestrator,learning,...}`, `skills/`, `slices/`, `target-projects/{goose-hub-self,nannymudnz}/`.

### Check 11 — README is current
Status: **FOLLOW-UP-NEEDED**
Notes: `README.md` "What's built" sections cover M5–M10 explicitly but have no M11 section. Missing user-visible additions: dependency parser + `schedule:blocked-by` blocked status on Kanban cards, `DependenciesSection` on issue detail, `goose task move <slug> <id> --to=current --with-dependencies|--ignore-dependencies` CLI, `MoveToCurrentDialog` UI confirmation, `core/projects/parallel-lock.ts` (multi-parallel relaxation per ADR 0023), `core/learning/playbook-{export,import}.ts` (M11.18), SDLC hooks under `hooks/` (M11.16), smoke-gate workflow init (M11.17), description-loop / skill-coach skill (M11.13–14, .19), predictive model router (M11.15). README does mention ADR 0022 (M11) but should call out the dependency-aware-scheduling user surfaces. Easy follow-up chore.

### Check 12 — Milestone-specific exit criteria from PLAN
Status: **PASS**
Notes:
- **Outcome.** Scheduler respects `Depends on` / `Blocks` body-level dependencies (same-repo and cross-repo, with unregistered → `factory:needs-human` escalation). Issues with unmet deps are filtered from dispatch and labelled `schedule:blocked-by`. UI surfaces blocked status (`useHasOpenDep` + `IssueCard` indicator + `DependenciesSection` on detail). Move-with-deps shipped as CLI + UI dialog. — delivered.
- **Included scope (10 items).** All ten included-scope bullets are shipped: parser (M11.01), cross-repo resolver (M11.02), scheduler filter (M11.03), `schedule:blocked-by` label (M11.03), UI dependency visibility on detail (M11.04), blocked status on card (M11.05), CLI move flags (M11.06), UI confirmation dialog (M11.06 — `MoveToCurrentDialog.tsx`), unregistered cross-repo escalation (M11.07), multi-parallel relaxation (M11.08 + ADR 0023). The M11.16–19 gap-analysis patches all shipped under PR #570.
- **Explicit exclusions (4 items).** Verified absent: no graphical dep-tree component (no `TreeView` matches); no critical-path code; no auto-creation of cross-project deps; no auto-promotion of `schedule:next` items.
- **Exit criteria.** Same-repo, cross-repo, unregistered, move-with-deps, and parallel-non-conflicting cases all asserted by `slices/dep-scheduling-integration/slice.test.ts`.

---

## Verdict

```
VERDICT: READY-TO-CLOSE

Reason: All six hard exit-criteria checks (1, 2, 5, 6, 9, 12) PASS. Three soft
checks (7, 10, 11) are FOLLOW-UP-NEEDED — within the audit's at-most-three
threshold for READY-TO-CLOSE. The milestone's headline behaviour ships and is
covered by integration tests; lint/typecheck/test are green; CI is fast.
The remaining gaps are documentation drift (README + PLAN section 6 + a few
missing ADRs for the M11 learning-loop modules), not implementation gaps.
```

### Recommended follow-up issues to file before closing

1. **chore(docs): add M11 sections to README.md** — document dependency-aware scheduling user surfaces (CLI flags, blocked-on-card, DependenciesSection, MoveToCurrentDialog), playbook export/import, SDLC hooks, smoke gate, model router, skill-coach.
2. **docs(adr): file ADRs for the M11 learning-loop core modules** — one consolidated or per-module ADR for `core/learning/{archive,mine,convergence,description-loop,playbook-{export,import,stats}}.ts`, `core/workflows/{cross-run-retro,skill-coaching}.ts`, `core/orchestrator/smoke.ts`, and the predictive model router. These represent the largest non-ADR'd `core/` change in the milestone.
3. **chore(repo): align top-level layout with PLAN section 6** — either amend section 6 to acknowledge `hooks/` (shell hooks for Claude CLI runtime) and decide on `plans/` (move under `docs/plans/` or delete, folding durable design notes into ADRs), or move/remove the directories. Pick one.

### Recommended retrospective notes (for the human's `docs/retros/m11.md`)

- **What worked.** The dependency parser → resolver → scheduler-filter → parallel-lock pipeline composed cleanly with no slice-to-slice coupling; the integration slice (`dep-scheduling-integration`) shows the M11 abstractions plug together end-to-end. ADR 0023 (per-project lock relaxation) was the right amount of justification for a rule-14 amendment. The mid-milestone governance refresh PR (#537) was an effective way to absorb concurrent human edits without polluting feature PRs.
- **What didn't.** Three documentation surfaces drifted while feature work landed at pace: ADRs lagged for the M11.11–15 learning-loop additions, README never grew an M11 section, and `hooks/` + `plans/` appeared without a matching update to PLAN section 6. The one borderline governance moment (PR #547 adding `coachPolicy` to `project.config.ts`) is a soft-rule violation that the system-owner exception bailed out — but the convention should be tightened.
- **What to change for M12.** (a) Require an ADR (or an explicit "no-ADR-needed, here's why" note in the PR body) for any PR that adds a new file under `core/`. (b) Add a README-update checkbox to the PR template for milestones that introduce user-visible CLI/UI/skills. (c) When a Factory feature PR needs a project-config field, split the config bump into a separate human-authored PR rather than rolling it into the feature PR.

---

_Per `docs/exit-audit.md`: the human reviews this report, decides whether to close the milestone, files any follow-up issues, writes `docs/retros/m11.md`, and updates `CLAUDE.md` (or the project's `activeMilestone`) to point at M12. The agent does none of this._
