# CLAUDE.md

You are an AI agent working on Goose Hub. Read this file first, every time, before any task.

## What this repo is

Goose Hub is a personal command centre for AI-assisted software delivery, powered by Factory (the orchestration engine inside it). One user (Shaun), local-first, opinionated. See `MISSION.md` for the full statement.

## Your role

You execute one narrow GitHub issue at a time. The issue is your build spec.

`docs/PLAN.md` is **the constitution**, not a build spec. Use it for direction, domain vocabulary, and the milestone roadmap. Do not try to build "from the document." Build from the issue.

`CONTEXT.md` (repo root) is the **resolved-implementation-decision registry**. Read it before writing any code in `core/` or `apps/`. It answers concrete "how is this wired?" questions: how the SSE event stream works, what format context takes in agent prompts, where improvement candidates get filed, how holdout context filtering works. If the code you're about to write touches a decision recorded there, follow it — don't re-litigate it.

`docs/adr/` is the long-form record. CONTEXT.md summarizes; ADRs justify. When you need the *why* behind a decision (or are filing a new one), go to ADRs.

## Hard rules to remember

`FACTORY_RULES.md` is the source of truth (numbered list, currently rules 1–33). The ones most likely to bite you:

- Vertical slices, never horizontal layers. Slices include only the surfaces they touch (no empty `ui.tsx` for workflow-only slices). `slice.test.ts` and `README.md` are always required.
- Slices import from `core/` through public interfaces only. Slices never import from other slices.
- Skills are versioned. Every skill in `skills/<name>/` has three required files: a Markdown prompt, a Zod output schema (`schema.ts`), and a TypeScript config (role, context schema, budgets). Two file-name conventions currently coexist — the legacy pair `skill.md` + `config.ts` (used by most skills today; loaded by `core/agent-runtime/read-prompt.ts` and `import config from '@goose-hub/skills/<name>/config.js'`) and the newer pair `prompt.md` + `skill.config.ts` (used by `triage`, `repo-match`, `bug-enhance`, `echo-test`, `echo-test-holdout`; loaded dynamically by the CLI). Match the convention of the skill you're touching; do not mix the two within a single skill. Inline prompts in code fail review either way.
- Every agent run produces JSON conforming to its skill schema. Free-text-only outputs fail.
- State labels live on **issues**, not PRs.
- Governance files cannot be modified by any Factory PR — creation is only allowed in PRs tagged `factory:bootstrap-pr`. Per FACTORY_RULES rule 12 the perimeter is: `MISSION.md`, `FACTORY_RULES.md`, `CLAUDE.md`, project configs (`target-projects/<slug>/project.config.ts`), and persona configs (`target-projects/<slug>/personas/`).
- The orchestrator is stateless across ticks. Work-item authority lives in the source of truth (GitHub Issues, Jira). Operational state (events, persona stats, budgets) lives in local SQLite.
- QA and Review are holdouts. They never see implementation reasoning.
- New top-level directories imported by two or more apps must be pnpm workspace packages before the first cross-app import lands (rule 28a).

## Stack

- Node + pnpm + TypeScript
- React + Vite + shadcn/ui (frontend)
- Drizzle + SQLite (local DB)
- Biome (lint + format)
- Vitest (unit + integration tests)
- Playwright (e2e)
- Zod (schema validation)

Use these. Don't introduce new heavyweight dependencies without an ADR.

## App conventions

Before touching any file in an app, read its `README.md` first. The README will tell you what else to read.

- Touching `apps/server/` → read `apps/server/README.md`
- Touching `apps/web/` → read `apps/web/README.md`

## Starting the next issue

When prompted with "start the next issue" (or similar), resolve the issue to work on as follows:

1. Determine the active milestone for the project. Each project declares its own `activeMilestone` in `target-projects/<slug>/project.config.ts` (e.g. `goose-hub-self` is currently on `M11: Dependency-aware Scheduling`). Read that string and substitute it into the next step. Do not hardcode a milestone — the active value moves over time and differs between projects.
2. Run, with the milestone string from step 1: `gh issue list --milestone "<active-milestone>" --label "schedule:current" --state open --json number,title,body,labels --jq 'sort_by(.number)'`
3. Skip any issue already labeled `factory:in-progress`.
4. For each remaining issue in ascending number order, check its body for `Depends on #N` (or `Depends on owner/repo#N`) lines. Fetch each referenced issue number with `gh issue view <N> --json state` and skip this issue if any dependency is still open. The canonical parser is `parseDependencies()` in `core/state-source/dependency-parser.ts`; mirror its tolerance (case-insensitive, optional colon, supports `Blocks` / `Blocked by` / `Depends-On`).
5. Pick the lowest-numbered issue that passes the dependency check.
6. Label it `factory:in-progress` on GitHub immediately: `gh issue edit <N> --add-label "factory:in-progress"`
7. Then follow "How to approach a task" below.

## When there is no next issue

If the `gh issue list` command above returns no eligible issues — meaning all open issues in the active milestone either:
- Don't exist (the milestone has no remaining open issues), OR
- Have unmet `Depends on #N` references pointing at still-open issues
— then the milestone is structurally complete.

Run the exit audit per `docs/exit-audit.md`. That file describes the generic checks. It also instructs you to read the milestone-specific exit criteria from `docs/PLAN.md` section 28 for the active milestone, and combine both.

Report findings using the structured format `docs/exit-audit.md` specifies. Do NOT close the milestone yourself. Do NOT start work on the next milestone. The human reviews the audit and decides.

## Recovering a stuck issue

If you see an issue labelled `factory:in-progress` with no recent activity (no PR opened, no commits, no comments since last session), it's likely orphaned from a previous session. Ask the human before picking it up — they may want you to resume the work, or to remove the label and start fresh.


## How to approach a task

1. Read the issue carefully. Identify the acceptance criteria.
2. Read this file (`CLAUDE.md`) and the relevant section of `docs/PLAN.md`.
3. Check `FACTORY_RULES.md` for any rule that bears on this task.
3a. If the task touches `core/` and requires a new architectural decision not already covered by `CONTEXT.md`, write an ADR in `docs/adr/` before opening the PR.
4. If the task contradicts a rule or principle, reject it with a comment citing the violation. Do not proceed.
5. If the task is ambiguous, look up the domain model (PLAN section 4) and interfaces (PLAN section 7). Most ambiguity is resolved there.
6. If still unsure, label the issue `factory:gate-pending` and request human input. Do not guess on architectural decisions.
7. Follow TDD: write the failing test first, then the implementation, then refactor.
8. Run lint and tests before opening a PR.
9. Open PR with a clear description linking back to the issue. Always include `Closes #N` (where N is the issue number) in the PR body so GitHub auto-closes the issue on merge. Do not include implementation reasoning the QA/Reviewer agents shouldn't see — that goes in `agent.decision-summary` events, not PR descriptions.
10. After opening the PR, update the issue body to check off all completed acceptance criteria (`[ ]` → `[x]`). Use `gh issue view N --json body` to fetch the current body, flip the boxes, and `gh issue edit N --body "..."` to write it back. Then post a structured transition comment to the issue:
    ```
    Transitioned to `factory:needs-qa`
    PR: #<pr-number>
    Completed criteria:
    - <criterion 1>
    - <criterion 2>
    ```
    Do not repeat implementation reasoning here — just which criteria are satisfied and where the PR is.

## PR conventions

- Title format: `M<milestone>.<task>: <short description>` — e.g. `M1.01: state enum`
- Body must contain `Closes #N` on its own line to trigger GitHub's auto-close on merge
- No implementation reasoning in the body (QA/Review are holdouts)

## Decision summaries

Every agent run emits decision summaries. Two streams (see CONTEXT.md for the full design + ADR 0018 for the taxonomy):

1. **Canonical (schema field).** Each skill schema declares `decisionSummaries: Array<{kind, summary, evidence?}>`. The agent populates this in its terminal JSON; the orchestrator extracts and emits `agent.decision-summary` events post-validation. This is the record QA and Review will never see, but Retro will.
2. **Live markers (`[decision] KIND: ...`).** Mid-run, emit `[decision] KIND: <one sentence>` lines in your text turn. The PostToolUse hook scans the transcript and forwards them as best-effort progress events.

`KIND` is constrained to the `DecisionKindSchema` enum in `core/agent-runtime/decision-types.ts`. Use a recognized value (e.g. `REPO_SELECTION`, `IMPLEMENTATION_PLAN`, `QUERY_PIVOT`); unknown kinds are coerced to `UNKNOWN` rather than dropped. Both streams reconcile at run end.

Good summaries:
- "Selected payments-api as primary repo based on keyword match + code search hits"
- "Implementation plan: add validation in src/api/handlers.ts and update tests in slices/0042"
- "Tried query X, got no results, switching to query Y"

Bad summaries:
- Raw chain-of-thought
- Anything containing credentials, API keys, file dumps, or PII
- More than one sentence
- Anything you wouldn't want a future reviewer to see

Tool-call audit (`agent.tool-call`) is a separate, automatic stream emitted by the PreToolUse hook — you don't write to it, but be aware it captures every tool invocation with redacted inputs.

## What's currently in scope

Goose Hub is built milestone-by-milestone (M0–M18 in `docs/PLAN.md` section 28). Work on the issue you're given. Do not scope-creep into earlier or later milestones.

If you find work that should belong in a later milestone, file a new issue (don't do the work now).

## What never happens

- You don't run autonomously without explicit project config.
- You don't merge your own PRs (in supervised mode, a human approves).
- You don't modify governance files.
- You don't bypass the tool allowlist for your role.
- You don't pretend to know things. If you're uncertain, say so and surface the question.

## When in doubt

`docs/PLAN.md` first. `MISSION.md` second. `FACTORY_RULES.md` third. Ask the human fourth. Guess never.
