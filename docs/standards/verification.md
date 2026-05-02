# Three-tier verification framework (Factory standard)

Status: standard, M8 scope
Owner: human (immutable contract for the QA holdout)
Last updated: 2026-05-02

This document defines the canonical mental model for all verification layers in Factory. The QA holdout (`skills/qa/`, M8) is the primary implementer, but every Factory skill that asserts correctness — at any layer — uses these tier names and maps its checks to one of them.

## Tiers

Verification proceeds in strict order: **structural → functional → regression**. A failure in any tier short-circuits the remaining tiers (the tier-specific event records the stop point).

### Tier 1 — Structural

Catches shape regressions before any execution.

- Schema validation (Zod, JSON Schema)
- Type checks (`tsc --noEmit`)
- Lint and format (Biome)
- Contract tests (DTO ↔ wire format)
- Migration validity (Drizzle: schema vs. database in sync)

**Cost profile:** seconds. Always run first.

**Skill emission:** `qa.structural-failed` on failure.

### Tier 2 — Functional

Catches behaviour regressions.

- Unit tests (Vitest) — pure-function and component-level
- Integration tests — module boundaries, DB writes, route handlers
- Workflow tests — orchestrator state transitions, persona selection, skill spawn

**Cost profile:** seconds to a couple of minutes.

**Skill emission:** `qa.functional-failed` on failure.

### Tier 3 — Regression

Catches UX and cross-cutting regressions.

- Playwright E2E (`apps/web/e2e/*.spec.ts`)
- Visual diff (when wired — currently out of scope; placeholder for M9+)
- Accessibility checks (axe, when wired)

**Cost profile:** minutes (browser bring-up + multi-page interaction).

**Skill emission:** `qa.regression-failed` on failure.

## Fix-or-register rule

A finding that blocks tier 1 or tier 2 has exactly two acceptable resolutions:

1. **Fix in-run** — the developer skill (or a follow-up `fix-issue` invocation) makes the change, re-runs the failing tier, and proceeds when green.
2. **Register as `priority:critical`** — a new GitHub issue is filed in the relevant target repo, labelled `priority:critical`, blocking further work on the affected slice.

**Suppressing** (e.g. `// vitest-ignore`, `expect(thing).toBeTruthy()` placeholders, removing the assertion) is forbidden. **Skipping** (`it.skip`, `test.skip`) is forbidden. The QA holdout fails the gate when it detects either pattern in the diff under review.

For tier 3 regressions: same rule, but the registered issue may be `priority:high` if the affected surface is non-critical (e.g. a design polish slice). The discriminator: would a user notice within 24 hours? If yes, `critical`; if no, `high`.

## 8-category code quality rubric

Used by the QA holdout's `code_quality_audit` gate. Each category produces a numeric score; the aggregate must meet a threshold (≥ 70/100) for the gate to pass. Sub-threshold aggregates surface as `qa.functional-failed` (the rubric is a functional-tier check — it asserts that the code is maintainable, which is a behavioural property of the codebase over time).

| Category | Weight | What it measures |
|---|---:|---|
| Open/Closed principle | 20 | Extension without modification |
| Concept count | 15 | Distinct abstractions per module |
| Time-to-capability | 15 | How fast a new dev can use the module |
| Complecting | 15 | Accidental coupling of unrelated concerns |
| LOC | 10 | Raw size signal |
| Coupling | 10 | Cross-module dependencies |
| Gall's Law | 10 | Complexity grew from a simple working system? |
| Cyclomatic complexity | 5 | Branch count per function |

**Threshold:** aggregate ≥ 70/100 to pass. Any single category at zero forces the gate to fail regardless of aggregate (a structural risk in one dimension is not redeemed by averaging).

The rubric is sourced from `docs/steves-training-materials-analysis.md` (`07-code-quality-audit.md`).

## Event schema

Three new event kinds are reserved for tier-specific failures. They extend `EventKind` in `core/event-stream/store.ts`:

- `qa.structural-failed` — payload includes `{ tool, output, exitCode }` (e.g. tsc output)
- `qa.functional-failed` — payload includes `{ suite, failingTests: string[], output }`
- `qa.regression-failed` — payload includes `{ specPath, failingSteps: string[], evidencePaths: string[] }`

Generic `qa.passed` and `qa.failed` events remain for aggregate transitions; the tier-specific kinds are additive and let downstream consumers (the UI, the retro skill) distinguish which tier short-circuited.

## How this contract binds existing M7 skills

- **`skills/spec-author/`** authors the tier-3 spec for a slice. The spec is the regression check the tier-3 stage will execute.
- **`skills/evidence-post/`** captures the post-implementation visual evidence used as the input to tier-3 verification (and to the human-facing comment on the issue).
- **`skills/playwright-repro/`** is the BEFORE-state capture for `type:bug` issues — its output feeds the tier-3 regression check (does the fix make the captured failing scenario pass?).

Each of those skills' output schema already includes `decisionSummaries`, satisfying FACTORY_RULES rule 6. None of them implement tier verification themselves; they produce the artefacts the QA holdout will consume in M8.

## What this document does NOT do

- It does NOT implement `skills/qa/` — that is M8 work (issue #76's framing places this doc as the contract; the implementing skill ships separately).
- It does NOT modify `FACTORY_RULES.md` — per rule 12, governance files are immutable to Factory PRs. The standards doc lives under `docs/standards/` and is referenced from `docs/PLAN.md` (non-governance, mutable) for discoverability.
- It does NOT define the visual-diff tooling for tier 3 — that is an M9+ concern.

## References

- `docs/PLAN.md` § 13.7 (M8 — QA and Review Holdouts)
- `docs/steves-training-materials-analysis.md` — `03-lifecycle-harness.md`, `04-qa-routine.md`, `07-code-quality-audit.md`
- `FACTORY_RULES.md` rules 1, 3, 4, 6, 12
- Issue #76 (this document is the resolution)
