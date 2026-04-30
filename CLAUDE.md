# CLAUDE.md

You are an AI agent working on Goose Hub. Read this file first, every time, before any task.

## What this repo is

Goose Hub is a personal command centre for AI-assisted software delivery, powered by Factory (the orchestration engine inside it). One user (Shaun), local-first, opinionated. See `MISSION.md` for the full statement.

## Your role

You execute one narrow GitHub issue at a time. The issue is your build spec.

`docs/PLAN.md` is **the constitution**, not a build spec. Read it for context, vocabulary, and architectural decisions. Do not try to build "from the document." Build from the issue.

## Hard rules to remember

`FACTORY_RULES.md` lists 28 non-negotiable rules. The ones most likely to bite you:

- Vertical slices, never horizontal layers. Slices include only the surfaces they touch (no empty `ui.tsx` for workflow-only slices). `slice.test.ts` and `README.md` are always required.
- Slices import from `core/` through public interfaces only. Slices never import from other slices.
- Skills are versioned markdown with Zod schemas in `skills/<name>/`. Inline prompts in code fail review.
- Every agent run produces JSON conforming to its skill schema. Free-text-only outputs fail.
- State labels live on **issues**, not PRs.
- Governance files (`MISSION.md`, `FACTORY_RULES.md`, `CLAUDE.md`, `target-projects/**`) cannot be modified by any Factory PR. Creation is only allowed in PRs tagged `factory:bootstrap-pr`.
- The orchestrator is stateless across ticks. Work-item authority lives in the source of truth (GitHub Issues, Jira). Operational state (events, persona stats, budgets) lives in local SQLite.
- QA and Review are holdouts. They never see implementation reasoning.

## Stack

- Node + pnpm + TypeScript
- React + Vite + shadcn/ui (frontend)
- Drizzle + SQLite (local DB)
- Biome (lint + format)
- Vitest (unit + integration tests)
- Playwright (e2e)
- Zod (schema validation)

Use these. Don't introduce new heavyweight dependencies without an ADR.

## Starting the next issue

When prompted with "start the next issue" (or similar), resolve the issue to work on as follows:

1. Run: `gh issue list --milestone "M1: Bootstrap Source of Truth" --label "schedule:current" --state open --json number,title,labels --jq 'sort_by(.number)'`
2. Skip any issue already labeled `factory:in-progress`.
3. Pick the lowest-numbered remaining issue.
4. Label it `factory:in-progress` on GitHub immediately: `gh issue edit <N> --add-label "factory:in-progress"`
5. Then follow "How to approach a task" below.

Update the milestone name as the active milestone advances.

## How to approach a task

1. Read the issue carefully. Identify the acceptance criteria.
2. Read this file (`CLAUDE.md`) and the relevant section of `docs/PLAN.md`.
3. Check `FACTORY_RULES.md` for any rule that bears on this task.
4. If the task contradicts a rule or principle, reject it with a comment citing the violation. Do not proceed.
5. If the task is ambiguous, look up the domain model (PLAN section 4) and interfaces (PLAN section 7). Most ambiguity is resolved there.
6. If still unsure, label the issue `factory:gate-pending` and request human input. Do not guess on architectural decisions.
7. Follow TDD: write the failing test first, then the implementation, then refactor.
8. Run lint and tests before opening a PR.
9. Open PR with a clear description linking back to the issue. Always include `Closes #N` (where N is the issue number) in the PR body so GitHub auto-closes the issue on merge. Do not include implementation reasoning the QA/Reviewer agents shouldn't see — that goes in `agent.decision-summary` events, not PR descriptions.

## PR conventions

- Title format: `M<milestone>.<task>: <short description>` — e.g. `M1.01: state enum`
- Body must contain `Closes #N` on its own line to trigger GitHub's auto-close on merge
- No implementation reasoning in the body (QA/Review are holdouts)

## Decision summaries

You must emit `agent.decision-summary` events at decision points. Examples of good summaries:

- "Selected payments-api as primary repo based on keyword match + code search hits"
- "Implementation plan: add validation in src/api/handlers.ts and update tests in slices/0042"
- "Tried query X, got no results, switching to query Y"

Bad summaries:
- Raw chain-of-thought
- Anything containing credentials, API keys, file dumps, or PII
- More than one sentence
- Anything you wouldn't want a future reviewer to see

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
