# ADR 0011 — Playwright test agents and evidence pipeline (M5/M7-prep)

Status: accepted
Date: 2026-05-02
Closes part of: pre-M7 infrastructure prep (no milestone issue yet — M7 issues
to be filed for the Factory-side work)

## Context

Two distinct capabilities sit on a shared foundation:

- **(A) Spec authoring.** Microsoft ships `playwright-test-{planner,generator,healer}`
  subagents in Playwright 1.56+ for AI-assisted test authoring. Installed via
  `npx playwright init-agents --loop=claude`.
- **(B) Evidence pipeline.** When a feature ships, before/after screenshots and
  a walkthrough video should be posted to the GitHub issue automatically,
  embedded inline via `raw.githubusercontent.com` URLs pinned to the commit SHA.
  The pattern was proven by the smoke test on issue #217.

This ADR records the placement and scoping decisions so future work can land
without re-litigating them.

## Decisions

### 1. Microsoft's playwright-test-{planner,generator,healer} are dev-time scaffolding, not Factory skills

FACTORY_RULES rule 13 ("Skills are versioned markdown with JSON schemas") and
CONTEXT.md's Skill definition ("packaged agent capability… lives under
`skills/<name>/`") describe **Factory skills invoked by `core/orchestrator/`**.
They produce schema-validated JSON and emit `agent.decision-summary` events.

Microsoft's subagents are **Claude Code IDE subagents** invoked by a human
running `claude` locally. They:
- are not invoked by `core/orchestrator/`
- do not produce schema-validated JSON (they write spec files / test plans)
- do not emit `agent.decision-summary` events
- have no Zod schema, no `skill.config.ts`, no `slice.test.ts`

Rule 13's intent ("inline prompts in code fail review") is to prevent ad-hoc
prompts in the orchestrator's runtime layer. Pre-existing precedent for
human-facing tooling: `.claude/skills/advance-milestone/skill.md` and
`.claude/hooks/*.sh` are already at the repo root and never touched by Factory.

The playwright-test agents are accepted as dev tools, not repackaged into
`skills/<name>/`.

### 2. Place the scaffold in `apps/web/.claude/`, not the repo root

Two `.claude/` precedents already exist: `/.claude/` (governance hooks +
`advance-milestone` skill) and `/.claude/hooks/` for orchestrator hooks.
Microsoft's MCP config (`.mcp.json`) and the planner's `specs/` output dir
must be co-located with the Playwright runtime — that is, under `apps/web/`.

Putting the agents in `apps/web/.claude/agents/` keeps the playwright-test MCP,
the agents that use it, and the Playwright config that the agents target all in
the same scope. Repo-root `.claude/` stays Goose-Hub-wide.

### 3. `seed.spec.ts` is a stub; `happy-path.spec.ts` keeps its own GitHub fixtures

`apps/web/e2e/seed.spec.ts` is the fixture inheritance point Microsoft's
generator references when writing specs ("Seed: e2e/seed.spec.ts").

The existing `happy-path.spec.ts` `beforeAll`/`afterAll` creates a real
`[E2E] Test Fixture` milestone and issue against `shaunnez/goose-hub` via the
GitHub API. That fixture is **heavy** (live HTTP, real artefacts on the repo
if cleanup fails, coupled to the `goose-hub-self` project) and does not belong
in a baseline every generated spec inherits.

`seed.spec.ts` stays a minimal stub. `happy-path.spec.ts` keeps its own
`beforeAll`/`afterAll`. When a second production spec lands and needs shared
state, decide then — don't refactor the only shipped e2e to chase a hypothetical
future.

### 4. Evidence pipeline is a Factory skill (M7), not a CI workflow

Posting screenshots/video to an issue is a **product artefact** — proof that
Goose Hub shipped a feature. Three placements were considered:

| Option | Verdict |
|---|---|
| (a) GitHub Actions YAML on PR open | Rejected. FACTORY_RULES 26: product workflows are TS modules in `core/orchestrator/workflows/`, never YAML. CI is allowed but evidence-posting is a product workflow, not a CI concern. |
| (b) Factory skill (`skills/<name>/`) | **Accepted.** Versioned, schema-bound, mirrors `skills/playwright-repro/`. Reuses the `validate` tool bundle. |
| (c) Bare core/ helper | Rejected. Posting evidence is an agent run (it captures, narrates, summarises) — wrap it in a skill so it goes through the runtime layer with a tool allowlist and decision-summary discipline. |

Skill name: `evidence-post`. Invoked by the M7 `fix-issue` workflow as the
final step before transitioning to `factory:needs-qa` (or `factory:approved`
in M7's pre-M8 shape). Schema mirrors `playwright-repro` — `screenshots[]`,
`videoPath`, plus a `commentUrl` field for the posted comment.

PLAN section 11.1 lists `fix-issue` as the M7 workflow. PLAN section 13.6
(Implement, M7) leaves a natural slot at "PR opened" for evidence posting.

### 5. Comparison strategy for v1: after-only, with bug BEFORE coming from playwright-repro

Three options:
- worktree-based dual-run (spec on main + on PR) — feasible (M6.01 worktrees
  exist) but expensive and noisy on main (selectors don't exist yet).
- baseline-folder (pre-stored approved screenshots) — needs an approval workflow
  Goose Hub doesn't have.
- after-only — cheap, demonstrates the feature ships.

For v1 (M7): after-only. The "before" for `type:bug` issues already comes from
`skills/playwright-repro/` in M6 — the M7 evidence-post skill can reference it
when the work item is a bug, producing a side-by-side comment that combines the
two captures. Worktree-based dual-run for features is filed as a later
enhancement (post-M8).

### 6. evidence-post complements playwright-repro; does not duplicate or replace it

| Skill | When | Captures |
|---|---|---|
| `playwright-repro` (M6) | `factory:investigating` for `type:bug` | BEFORE state (broken behaviour) |
| `evidence-post` (M7, planned) | `factory:in-progress` (after PR opens) | AFTER state (feature shipped / bug fixed) |

For bugs, the M7 evidence-post comment can include both captures by reading the
`playwright-repro` artefact paths from the investigation findings already
attached to the issue. Implementation detail; documented in the M7 issue.

## Consequences

- The dev-time scaffold (Microsoft's planner/generator/healer + `.mcp.json` +
  `seed.spec.ts` stub) lands now under `apps/web/.claude/`. Humans drive it
  from a Claude Code session opened in `apps/web/`.
- `apps/web/README.md` documents when humans invoke it.
- A new Factory skill `skills/evidence-post/` is filed as #233 (M7). It
  reuses the `validate` tool bundle and ships with `slice.test.ts`, `README.md`,
  `schema.ts`, `config.ts`, `skill.md` per the existing skill template.
- #234 (M7) wires the evidence-post skill into the `fix-issue` workflow as
  the final step before state transition.
- #235 (M7) covers a Factory-side spec authoring skill (`skills/spec-author/`)
  that uses the same `playwright-test` MCP server, so authoring happens inside
  an orchestrated agent run — not only in human Claude Code sessions.
- Worktree-based dual-run (BEFORE on main, AFTER on PR) is deferred. File an
  enhancement issue when the after-only output proves limiting.
