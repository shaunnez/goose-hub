# code-quality-audit skill

Produces an **8-category, 100-point architectural quality scorecard** using Steve's rubric.

## Role

`auditor` — sees full reasoning, not a holdout. Model: Opus (qualitative reasoning required for Cat 1/2/3/4/7).

## Trigger cadence

- **`review` workflow** on `priority:high` PRs only (cost management)
- **Nightly retrospective trigger** (wired via `retrospectivePolicy.deepTriggers`)

## Input context

| Field | Required | Description |
|-------|----------|-------------|
| `worktreePath` | Yes | Absolute path to the checked-out codebase |
| `metricsJson` | No | Pre-computed Cat 5/6/8 scores from `scripts/code-quality-metrics.ts` |
| `workItem` | No | Issue context (number, title) |

Run `scripts/code-quality-metrics.ts` before invoking the skill to pre-compute automated categories.

## Output schema

See `schema.ts`. Key fields:

| Field | Type | Description |
|-------|------|-------------|
| `scorecard` | `ScorecardEntry[8]` | One entry per category with score, max, and evidence |
| `rating` | `'Exemplary'\|'Good'\|'NeedsWork'\|'Concerning'\|'Redesign'` | Derived from total score |
| `strengths` | `string[]` | What the codebase does well |
| `recommendations` | `Recommendation[]` | Ranked P0/P1/P2 with file:line citations |
| `mcIlroyQuestion` | `string` | Unix philosophy composability assessment |
| `projectedScoreAfterTop3` | `number` | Expected score after top-3 recommendations applied |

## Rating bands

| Rating | Total score |
|--------|------------|
| Exemplary | ≥ 90 |
| Good | 75–89 |
| NeedsWork | 55–74 |
| Concerning | 35–54 |
| Redesign | < 35 |

## The 8 categories

| # | Category | Points | Scored by |
|---|----------|--------|-----------|
| 1 | Open/Closed Compliance | 20 | Auditor |
| 2 | Concept Count | 15 | Auditor |
| 3 | Time-to-New-Capability | 15 | Auditor |
| 4 | Complecting Score | 15 | Auditor |
| 5 | LOC Discipline | 10 | `code-quality-metrics.ts` |
| 6 | Coupling / Fan-Out | 10 | `code-quality-metrics.ts` |
| 7 | Gall's Law Compliance | 10 | Auditor (git history) |
| 8 | Cyclomatic Complexity | 5 | `code-quality-metrics.ts` |

## Cascade (downstream consumers)

- **Run archive** — scorecard persists via the standard retrospective pipe
- **Cross-run pattern miner** (M11.11) — detects convergent recommendations across runs
- **Skill-coach** — convergent recommendations auto-file improvement candidates
- **UI** — quality-trend tab shows `architecturalQualityScore` (total score) per project
- **Autonomous gate** — score < 60 triggers `factory:needs-human` (autonomous mode only)

## Eval fixtures

`eval.json` provides 5 fixture prompts × 5 binary assertions for skill-coach self-improvement loops.

## References

- Steve's rubric: `docs/steves-training-materials/Markdown Files/Autonomous Decelopment/07-code-quality-audit.md`
- Automated metrics: `scripts/code-quality-metrics.ts`
- Role defaults: `core/agent-runtime/roles.ts` (`auditor`: opus, $3.00, 30 turns)
