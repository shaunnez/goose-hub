# Goose Hub

Personal command centre for AI-assisted software delivery.

See `MISSION.md` for what this is.  
See `FACTORY_RULES.md` for non-negotiables.  
See `CLAUDE.md` for AI agent orientation.  
See `docs/PLAN.md` for the full plan and milestone ladder.

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

Versioned markdown prompts + Zod schemas under `skills/<name>/`. Current set: `triage`, `repo-match`, `investigate`, `playwright-repro`, `spec-author`, `evidence-post`, `implement`, `advise-on-plan`, `qa`, `review`, `retrospective-light`, `retrospective-deep`. Each ships with `slice.test.ts`, `eval/eval.json`, and `README.md`. Skills follow the channel-split convention from CONTEXT.md: `skill.md` is the system prompt, per-run context is rendered as XML in the user message.

### Holdouts (M8)

QA and Review are **holdouts**: each runs in a fresh agent context with no access to the Developer's reasoning (`agent.decision-summary` events, plan text, advisor output). Enforcement is at the runtime layer via a `contextAllowlist` per skill — a deliberate injection attempt fails with a `tool.violation` event. See ADR 0014 for the architecture and `slices/holdout-boundary-test/` for the regression test.

### Standards & ADRs

- `docs/standards/verification.md` — the three-tier (Structural / Functional / Regression) verification framework + 8-category code-quality rubric (≥ 70/100 threshold). Ships ahead of the M8 QA holdout.
- `docs/adr/` — architectural decisions in chronological order. M7 added ADR 0011 (Playwright agents), 0012 (advisor wrapping + per-step typed timeouts), 0013 (GitHub connectors + fix-issue workflow shape). M8 added ADR 0014 (holdout enforcement architecture). M9 added ADR 0015 (target-projects workspace package), ADR 0016 (cost module architecture), ADR 0017 (core/workflows placement for cross-caller workflows).

### Retrospective & Learning Loop (M9)

- **Roster** — at `/projects/<slug>/roster`. Per-role list of personas with quality score, run count, and last-run time. Click any card to open a drill-in panel showing run history and pending improvement candidates. Approve a candidate to create a `type:improvement` Factory issue in the target repo; reject to dismiss.
- **Cost dashboard** — at `/projects/<slug>/costs`. Weekly and monthly spend with per-stage breakdown. Figures sourced from Claude CLI are labelled `~$` (estimated); figures from direct API calls are labelled exact.
- **Persona stats** — accumulated after every agent run across all workflow stages. `persona_stats` table holds `runs_total`, `runs_succeeded`, `runs_failed`, `avg_quality_score`, and `last_run_at` per persona/role pair.