# Goose Hub

Personal command centre for AI-assisted software delivery.

See `MISSION.md` for what this is.  
See `FACTORY_RULES.md` for non-negotiables.  
See `CLAUDE.md` for AI agent orientation.  
See `CONTEXT.md` for resolved implementation decisions.  
See `docs/inventory.md` for an auto-generated, always-current map of every package, slice, skill, app, and target-project (regenerate with `pnpm manifest`).  
See `docs/archive/PLAN.md` for the archived full plan and milestone ladder.

Drift-check: `pnpm audit-docs` reports drift between governance docs and code (role lists, file references, milestone span, skill structure). Run it before merging changes that touch `core/types.ts` or the skill catalogue.

## What's built

### Web UI

A Kanban-style board at `/projects/<slug>` shows all open issues grouped by factory state (backlog → in-progress → needs-qa → needs-review → done). Click any card to open the detail page, which shows the issue description, a state-transition panel (to manually advance or force-state an issue), and a timeline of events. Run the dev server with `pnpm --filter web dev`.

The detail page also exposes:

- **Investigation tab** (M6) — root-cause findings + key files + before-state Playwright captures for `type:bug` issues
- **Code tab** (M7) — live worktree diff polled every 5 s while the dev workflow is running, plus per-step Playwright captures
- **QA tab** (M8) — holdout QA report: overall verdict (`pass` / `fail` / `partial`), score, and per-tier (Structural / Functional / Regression) findings; populated after the QA holdout agent runs.
- **Review tab** (M8) — holdout review verdict (`approved` / `needs-fix` / `needs-human`) and per-criterion checks; populated after the Review holdout agent runs.
- **Retrospective tab** (M9) — light or deep retro report, populated automatically after every merge. Light tier: 3-bullet summary + obvious improvement candidates. Deep tier: full persona analysis, quality scores, decision patterns.
- **Costs tab** (M9) — per-stage token and dollar breakdown for the issue, with `~$` prefix on estimated figures and no qualifier on exact figures.
- **Approval gate** (M7) — when an issue reaches `factory:approved`, the gate banner shows Approve / Reject buttons (Approve merges the linked PR via the GitHub connector; Reject takes a required note and routes to `factory:needs-fix`)
- **Markdown image rendering** in overview comments — screenshots posted by `evidence-post` from `raw.githubusercontent.com` / `github.com` / `user-images.githubusercontent.com` render inline

### CLI

The `goose` CLI (built with `pnpm --filter cli build`, then `node apps/cli/dist/index.js`) has these commands:

- `goose status <project-slug>` — prints open issues grouped by factory state for the given project, with the active milestone shown at the top.
- `goose sweep <project-slug> <milestone-number>` — lists all non-terminal issues in the given milestone, prompts for confirmation, then bulk-archives them by forcing the `factory:archived` label.
- `goose run-agent --skill=<name> --input='<json>' [--dry-run]` — runs a skill agent against the Claude CLI. `--dry-run` prints the assembled AgentSpec without spawning. Requires `ANTHROPIC_API_KEY`.
- `goose task move <project-slug> <issue-id> --to=current [--with-dependencies | --ignore-dependencies]` (M11) — moves an issue between schedule lanes; on `--to=current`, requires one of the two dep flags when the issue has open `Depends on #N` references.
- `goose playbook export <project-slug> [--json]` / `goose playbook import <project-slug> [--json]` (M11) — exports or imports a portable `PlaybookManifest` (mined decision patterns, gate thresholds, cost baselines) for cross-project reuse. See ADR 0028.

Both `status` and `sweep` require `GITHUB_TOKEN` set in the environment or a `.env` file.

### Workflows (orchestrator)

End-to-end workflows live in `slices/<name>/workflow.ts` and are dispatched by webhook label flips via `apps/server/src/shared/dispatch.ts`:

- **`triage-batch`** (M5) — picks up `factory:triaging` issues, runs the triage + repo-match skills, applies type/priority labels, transitions to `factory:accepted`.
- **`investigate`** (M6) — picks up `factory:investigating` issues, runs the investigate skill (with playwright-repro for `type:bug`), records findings, transitions to `factory:investigation-complete`.
- **`fix-issue`** (M7) — picks up `factory:dev-ready` issues, creates a worktree, runs the advisor for `priority:high|critical`, runs the implement skill (TDD-first), opens a PR via the GitHub connector, runs `evidence-post` (best-effort), transitions to `factory:needs-qa` to hand off to the QA holdout. _(M7 originally transitioned straight to `factory:approved`; M8 inserted QA + Review before the human gate.)_
- **`qa`** (M8) — picks up `factory:needs-qa` issues, runs the QA holdout skill (lint + tests + Playwright via the project's `lintCommand` / `testCommand` / `e2eCommand`), transitions to `factory:needs-review` on pass or `factory:qa-failed` on fail (escalates to `factory:needs-human` after `maxRetries`).
- **`review`** (M8) — picks up `factory:needs-review` issues, runs the Review holdout skill (diff vs. original issue, criteria checks), transitions to `factory:approved`, `factory:needs-fix`, or `factory:needs-human`.
- **`retro`** (M9) — picks up `factory:retrospecting` issues (set automatically when a PR is approved), runs `retrospective-light` or `retrospective-deep` based on `retrospectivePolicy` and trigger signals (`qaFailed`, etc.), transitions to `factory:done`.

Supporting slices: `holdout-boundary-test` (regression test that context enforcement fires at the runtime layer), `retry-escalate` (counts `qa-failed` / `needs-fix` retries and escalates to `factory:needs-human` when exhausted), and `cost-tracking` (end-to-end lifecycle test for cost recording).

Dev pipeline flow:

```
dev-ready → in-progress → needs-qa → needs-review → approved → (human gate) → merged → retrospecting → done
                             ↘ qa-failed / needs-fix → (retry) → needs-human
```

### Skills (`@goose-hub/skills`)

Versioned markdown prompts + Zod schemas under `skills/<name>/`. The current catalogue is enumerated in `docs/inventory.md` (auto-generated; do not hand-maintain lists here). Each skill ships with `prompt.md`, `schema.ts`, `skill.config.ts`, `slice.test.ts`, optional `eval/eval.json`, and `README.md`. Skills follow the channel-split convention from CONTEXT.md: `prompt.md` is the system prompt, per-run context is rendered as XML in the user message. All prompts are loaded via `readPromptWithContext()` (ADR 0022) which also appends an optional per-project overlay from `target-projects/<slug>/agent-context/<skillName>.md`.

### Holdouts (M8)

QA and Review are **holdouts**: each runs in a fresh agent context with no access to the Developer's reasoning (`agent.decision-summary` events, plan text, advisor output). Enforcement is at the runtime layer via a `contextAllowlist` per skill — a deliberate injection attempt fails with a `tool.violation` event. See ADR 0014 for the architecture and `slices/holdout-boundary-test/` for the regression test.

### Standards & ADRs

- `docs/standards/verification.md` — the three-tier (Structural / Functional / Regression) verification framework + 8-category code-quality rubric (≥ 70/100 threshold). Ships ahead of the M8 QA holdout.
- `docs/adr/` — architectural decisions in chronological order. M7 added ADR 0011 (Playwright agents), 0012 (advisor wrapping + per-step typed timeouts), 0013 (GitHub connectors + fix-issue workflow shape). M8 added ADR 0014 (holdout enforcement architecture). M9 added ADR 0015 (target-projects workspace package), ADR 0016 (cost module architecture), ADR 0017 (core/workflows placement for cross-caller workflows), ADR 0018 (decision-kind taxonomy), ADR 0019 (retrospective output schema), ADR 0020 (centralized skill budgets). M10 added ADR 0021 (multi-project loader and per-project scheduler in core/projects/) — originally filed as 0018, renumbered to resolve the collision. M11 added ADR 0022 (skill file convention consolidation), ADR 0023 (relax per-project workflow lock to per-issue + `maxParallelAgents` cap), ADR 0024 (cross-run learning loop: archive → miner → cross-run retro), ADR 0025 (skill-coach feedback loop with auto-trigger gates), ADR 0026 (predictive model router for dev-side skills), ADR 0027 (workflow init smoke gate), and ADR 0028 (playbook portability + skill description-loop eval).

### Retrospective & Learning Loop (M9)

- **Roster** — at `/projects/<slug>/roster`. Per-role list of personas with quality score, run count, and last-run time. Click any card to open a drill-in panel showing run history and pending improvement candidates. Approve a candidate to create a `type:improvement` Factory issue in the target repo; reject to dismiss.
- **Cost dashboard** — at `/projects/<slug>/costs`. Weekly and monthly spend with per-stage breakdown. Figures sourced from Claude CLI are labelled `~$` (estimated); figures from direct API calls are labelled exact.
- **Persona stats** — accumulated after every agent run across all workflow stages. `persona_stats` table holds `runs_total`, `runs_succeeded`, `runs_failed`, `avg_quality_score`, and `last_run_at` per persona/role pair.

### Multi-project Orchestration (M10)

Goose Hub can now drive more than one target project simultaneously. Two projects are registered under `target-projects/`: `goose-hub-self` (purple, `#7c3aed`) and `nannymudnz` (emerald, `#059669`). New projects are added by hand-creating a `target-projects/<slug>/` directory with `project.config.ts` — no code changes needed.

- **Project switcher** — sidebar dropdown lists every registered project with its color stripe. Selecting a project scopes the Kanban, Roster, and Settings views immediately. Selection persists across page reload.
- **All Projects board** — select "All Projects" in the switcher to see a single aggregated Kanban with cards from every registered project, each carrying a left-border color stripe identifying its source project.
- **Per-project tick scheduler** — each project runs an independent `setInterval` tick loop (configurable via `tickIntervalSeconds` in `project.config.ts`, default 60 s). A crash or long-running workflow in one project never delays another project's tick.
- **Per-project budgets** — daily token counter, per-workflow budget cap, and per-advisor budget are all keyed by project slug. Exceeding one project's daily limit blocks only that project's ticks; others continue unaffected.
- **Per-project active milestone** — each project tracks its own `activeMilestone` independently. The Kanban for each project filters to its own milestone's issues.
- **Cross-project Roster** — at `/projects/all/roster` (or via the project filter dropdown on the Roster page). Shows personas from all registered projects with color-stripe attribution. Filter to a single project to scope the leaderboard.
- **Settings → Projects** — read-only display of every registered project's config (slug, source, active milestone, budget limits, color). A "Reload" button refreshes without a full page reload. Editing is file-based; the UI includes a prompt directing to `target-projects/<slug>/project.config.ts`.

ADR 0021 covers the `core/projects/` loader and scheduler architecture. See `docs/adr/0021-multi-project-loader-and-scheduler.md`.

### Dependency-aware Scheduling & Learning Loop (M11)

The orchestrator now respects body-level `Depends on #N` / `Depends on owner/repo#N` / `Blocks #N` references, including cross-repo. A central learning loop records every closed lifecycle, mines for convergent decision patterns, and feeds them back into a coach that proposes prompt-level changes for the human to approve.

- **Dependency parser** — `core/state-source/dependency-parser.ts` (and a synced client mirror at `apps/web/src/lib/dependency-parser.ts`) handles `Depends on`, `Blocked by`, and `Blocks` with tolerant variants. The web build's `useHasOpenDep` reads the same shape.
- **Scheduler dependency filter** — `core/projects/dependency-scheduler.ts` skips items whose deps are still open and applies `schedule:blocked-by` to surface that state. Closing all deps lifts the label and re-eligibles the item on the next tick.
- **Cross-repo deps** — registered cross-repo deps resolve through `core/state-source/dependency-resolver.ts`. An unregistered cross-repo dep escalates the blocked issue to `factory:needs-human` with a structured comment (idempotent — re-escalation is suppressed).
- **`schedule:blocked-by` on Kanban cards** — the issue card displays an indicator when the issue has at least one open dependency.
- **Issue-detail Dependencies section + Move dialog** — the detail page lists the dependency graph with each dep's current state. `MoveToCurrentDialog` is the UI confirmation for `goose task move … --to=current` when the issue has open deps.
- **Multi-parallel dispatch** — `core/projects/parallel-lock.ts` replaces the single-workflow-per-project lock with a per-issue lock plus a `maxParallelAgents` cap (default `1`, opt-in for higher values). See ADR 0023.
- **Cross-run learning loop** — every closed lifecycle is archived (`core/learning/archive.ts`), patterns are mined (`mine.ts`) and trended (`convergence.ts`), and the cross-run retro skill (`skills/retrospective-cross-run/`, dispatched via `core/workflows/cross-run-retro.ts`) writes structured improvement candidates to the Roster with computed gate thresholds and cost baselines. See ADR 0024.
- **Skill-coach feedback loop** — `skills/skill-coach/` proposes diffs to a target skill's `prompt.md`. Auto-trigger from the cross-run retro is gated on `coachPolicy.enabled`, `lifecycleCount >= minLifecycles` (default 3), `consistencyScore >= consistencyThreshold` (default 0.8), and at least one improvement candidate referencing the convergent pattern. The forbidden-target set (`qa`, `review`, all retros, `skill-coach` itself) is enforced in code. See ADR 0025.
- **Predictive model router** — `core/agent-runtime/model-router.ts` picks per-call tier (haiku / sonnet / opus) for non-holdout dev-side skills using project overrides → mined patterns → static policy (priority / type / AC count). Holdouts never route. See ADR 0026.
- **Workflow init smoke gate** — `core/orchestrator/smoke.ts` runs six non-skippable checks (`gh-auth`, `git-fsck`, `claude-version`, `sqlite-ping`, `api-key`, `budget-floor`) before any dispatch on every project tick. Cached for 60 s on success; not cached on failure. See ADR 0027.
- **Playbook portability** — `goose playbook export <slug>` / `import <slug>` round-trip a versioned `PlaybookManifest` (decision patterns, gate thresholds, cost baselines) so a sibling project can bootstrap from the loop's output. `core/learning/playbook-export.ts` / `playbook-import.ts`. See ADR 0028.
- **SDLC enforcement hooks** — top-level `hooks/require-spec.sh` (PreToolUse) and `hooks/stop-verify-ac.sh` (Stop) are written into agent worktrees by `core/tool-layer/sandbox.ts` to enforce plan-first edits and acceptance-criteria-complete stops. They live outside `.claude/hooks/` because that path is governance-protected from agent writes; manual wiring instructions for the main workspace are in `slices/sdlc-hooks/README.md`.
- **Description-loop eval** — `core/learning/description-loop.ts` measures auto-trigger accuracy of a skill's `prompt.md` description against a labelled prompt fixture. Layer 1 of the skill eval framework; Layer 2 is deferred to M19+. See ADR 0028.