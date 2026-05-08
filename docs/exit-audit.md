# Milestone Exit Audit

This file is run by an AI agent (or a human) at the end of each milestone, **before** the milestone is closed. It validates that the milestone is genuinely done — not just that the headline criterion works, but that the implementation matches the architecture in `CONTEXT.md` and the rules in `FACTORY_RULES.md`.

## When this is run

`CLAUDE.md` instructs agents to run this audit when "next" is invoked but no eligible open issues remain in the active milestone. The audit produces a structured report. The human decides whether to close the milestone.

The agent never closes the milestone. The agent never starts work on the next milestone before this audit completes and the human approves.

## How this works

The audit has two parts:

1. **Generic checks** (this file) — apply to every milestone
2. **Milestone-specific exit criteria** — read from `docs/archive/PLAN.md` section 28 for the active milestone

The active milestone name is in `CLAUDE.md` under "Starting the next issue." Read it from there.

The agent runs both parts and reports findings in a single structured output.

## Required reading before audit

Read these files in order before running checks:

1. `CLAUDE.md` (root) — confirm the active milestone name
2. `docs/archive/PLAN.md` section 28 — entry for the active milestone (exit criteria)
3. `MISSION.md` and `FACTORY_RULES.md` — the immutable constraints

## Generic checks

Run each check. For each, output `PASS`, `FAIL`, or `FOLLOW-UP-NEEDED` with a one-line note.

### Check 1 — All milestone issues closed

Run:
```bash
gh issue list --milestone "<active-milestone-name>" --state open --json number,title,labels
```

PASS if the list is empty.
FAIL if any issue is still open.
If issues remain open with unmet dependencies pointing at *closed* issues (i.e. nothing actionable left), treat that as FAIL — those issues either need to be worked or explicitly closed/deferred.

### Check 2 — Headline exit criterion met

Read the milestone's "Exit criteria" field from `docs/archive/PLAN.md` section 28. Run whatever the criterion specifies. Examples:
- M1: `pnpm goose status goose-hub-self` produces real output against real GitHub
- M2: Playwright happy path passes
- M4: `goose run-agent --skill=echo-test ...` works end-to-end

PASS if the criterion is verifiably met by running the command or test it specifies.
FAIL otherwise.

### Check 3 — Abstractions used, not bypassed

For every code module under `core/`, confirm it's actually consumed by the milestone's surface code (CLI, UI, orchestrator, etc.). Look for signs of inline reimplementation:

- Native `fetch()` calls in surface code where a `core/state-source/` adapter exists
- Inline state resolution where `core/state-machine/conflict-resolver.ts` exists
- Inline workflow logic where `core/orchestrator/workflows/` is the canonical location
- String-literal state names where `core/state-machine/states.ts` exports a typed enum

PASS if all `core/` modules are consumed by their intended consumers.
FAIL if surface code bypasses an existing `core/` module.
FOLLOW-UP-NEEDED if a `core/` module exists but isn't yet consumed because consumers don't exist (acceptable if a follow-up issue tracks the wiring).

### Check 4 — Slices import only via core interfaces

For each `slices/<n>-<name>/` folder modified during this milestone:

- Confirm imports come from `core/` only, not from other slices
- Confirm `slice.test.ts` and `README.md` exist
- Confirm no empty placeholder files (e.g. an empty `ui.tsx` for a workflow-only slice)

PASS if all slices follow the rules.
FAIL on any slice-to-slice import.
FOLLOW-UP-NEEDED for missing tests or README.

### Check 5 — Tests, lint, typecheck

Run from a clean install:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
```

PASS if all four succeed with zero errors.
FAIL on any failure.

### Check 6 — CI passes on a fresh PR

Open the most recent PR (or trigger a trivial new one with a typo fix). Confirm:
- GitHub Actions ran
- Lint, typecheck, test all green
- Total CI time under 3 minutes for an empty-change PR

PASS if CI is green and reasonably fast.
FAIL if CI doesn't run, or fails on green code, or is unreasonably slow (over 5 minutes).

### Check 7 — ADRs exist for core changes

Run:
```bash
ls docs/adr/
```

For every PR merged this milestone that modified code under `core/`, an ADR should exist. Check the milestone's PRs:

```bash
gh pr list --search "milestone:<active-milestone-name>" --state merged --json number,title,files
```

For each PR that touched `core/`, look for a corresponding ADR file. ADR filenames typically follow `NNNN-short-name.md` format.

PASS if every `core/`-touching PR has an ADR.
FOLLOW-UP-NEEDED if some are missing — list them.
FAIL if zero ADRs exist despite `core/` having been modified extensively.

### Check 8 — No scope creep from later milestones

Confirm the following directories are absent or empty (unless the active milestone explicitly includes them):

- `apps/web/` — UI lives here, introduced in M2
- `core/agent-runtime/` — introduced in M4
- `core/orchestrator/workflows/` — introduced from M5
- Webhook handlers — introduced in M2/M3
- `skills/` real implementations — introduced from M5

Check `docs/archive/PLAN.md` section 28 for what *should* exist by the active milestone. Anything present that belongs to a later milestone is scope creep.

PASS if scope is correct for the active milestone.
FOLLOW-UP-NEEDED if early-implemented work exists; flag and recommend either revert or explicit "wired in M<N>" tracking.

### Check 9 — Governance files unchanged

Run:
```bash
gh pr list --search "milestone:<active-milestone-name>" --state merged --json number,title,files
```

For each merged PR, confirm none of the governance files were modified (only created via PRs tagged `factory:bootstrap-pr`):

- `MISSION.md`
- `FACTORY_RULES.md`
- `CLAUDE.md`
- `target-projects/**/MISSION.md`
- `target-projects/**/FACTORY_RULES.md`
- `target-projects/**/project.config.ts`
- `target-projects/**/personas/**`
PASS if no governance file was modified by a Factory PR (manual human edits via direct push are fine but should be rare and intentional).
FAIL if any Factory PR modified a governance file outside the bootstrap exception.

### Check 10 — Repo structure matches PLAN section 6

Run:
```bash
tree -L 3 -I 'node_modules|dist|.git|build|coverage'
```

Compare against `CONTEXT.md` for current expected layout. Drift now compounds — catch it.

PASS if structure matches.
FOLLOW-UP-NEEDED if structure has drifted in minor ways (file in wrong subfolder, etc.).
FAIL if structure has fundamentally diverged.

### Check 11 — README is current

Read `README.md`. Confirm it points to `MISSION.md`, `FACTORY_RULES.md`, and `CLAUDE.md`. If the milestone added significant new capability (a CLI command, a UI surface, etc.), confirm the README at least mentions it.

PASS if current.
FOLLOW-UP-NEEDED if stale — easy to fix, file as a chore.

### Check 12 — Milestone-specific exit criteria from PLAN

Read the active milestone's full entry in `docs/archive/PLAN.md` section 28. Specifically:

- "Outcome" — has it been delivered?
- "Included scope" — every item shipped?
- "Explicit exclusions" — none crept in?
- "Exit criteria" — verifiably met?

For each item under "Included scope," verify it exists in the codebase. For each under "Explicit exclusions," verify it does NOT exist.

PASS if every "Included scope" item is shipped and no "Explicit exclusion" was implemented.
FAIL on any deviation.
FOLLOW-UP-NEEDED for partial scope (e.g. shipped but thin — note for follow-up issue).

## Output format

For each of the 12 checks, output:

```
Check N: [name]
Status: PASS | FAIL | FOLLOW-UP-NEEDED
Notes: [one line — what was verified, or what was missing]
```

After all checks, output:

```
---
VERDICT: [READY-TO-CLOSE | KEEP-OPEN | NEEDS-FOLLOW-UPS-THEN-CLOSE]

Reason: [one paragraph explaining the verdict]

Required follow-up issues to file before closing (if any):
- [Issue title 1]
- [Issue title 2]

Recommended retrospective notes:
- [What worked]
- [What didn't]
- [What to change for the next milestone]
---
```

## Decision rules

The verdict is mechanical:

- **READY-TO-CLOSE** if checks 1, 2, 5, 6, 9, 12 are all PASS, and checks 3, 4, 7, 8, 10, 11 are PASS or FOLLOW-UP-NEEDED with at most 3 follow-ups total.
- **NEEDS-FOLLOW-UPS-THEN-CLOSE** if checks 1, 2, 5, 6, 9, 12 are all PASS but more than 3 follow-ups are needed across other checks. The human should file the follow-ups, then close.
- **KEEP-OPEN** if any of checks 1, 2, 5, 6, 9, 12 fail. These are the hard exit criteria.

The agent reports the verdict but does not act on it. The human:
- Reviews the report
- Decides to close the milestone, file follow-ups, or reopen specific issues
- Writes the milestone retrospective at `docs/retros/m<N>.md` (200–500 words; what worked, what didn't, what to change next milestone)
- Updates `CLAUDE.md` to point at the next milestone name
- Confirms the next milestone has its issues filed and ready

## What the agent never does

- Closes the milestone
- Modifies CLAUDE.md to advance the active milestone
- Files follow-up issues without explicit human approval (it can recommend them, but not file them)
- Starts work on the next milestone's issues
- Modifies governance files

## Notes for humans reading this

This audit is deliberately strict. Skipping it lets quiet drift accumulate across milestones — bypassed abstractions, missing ADRs, scope leaks. Each individual oversight is small; the cumulative effect is technical debt that compounds for 17 milestones.

The audit is also versioned: as Goose Hub matures, this file evolves. New rules in `FACTORY_RULES.md` should add corresponding checks here. Audits from M1 may be lighter than audits from M9 simply because more rules exist by then.

When Goose Hub itself reaches M9 (retrospective infrastructure) or M10 (multi-project orchestration), this audit becomes a real workflow that auto-runs. Until then, it's a markdown file an agent reads when prompted.