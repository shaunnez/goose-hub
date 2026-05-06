# Steve's Training Docs ↔ Goose Hub Mapping

Quick translation table between Steve's vocabulary (in `Markdown Files/Autonomous Decelopment/`) and Goose Hub's existing concepts. Same ideas, different words. Use this when reading Steve's docs to understand which of our types/tables/skills correspond.

## Vocabulary

| Steve's term | Goose Hub equivalent | Where it lives |
|---|---|---|
| `decision_type` (enum) | `DecisionKindSchema` | `core/agent-runtime/decision-types.ts` |
| `phase` (PLANNING / BUILDING / VERIFICATION) | role + workflow stage | `core/workflows/*`, `role` field on `AgentSpec` |
| `DecisionRecord { what, why }` | `agent.decision-summary` event payload | `core/event-stream/store.ts` |
| `LearningEntry` | `LearningEntry` (deep retro output) | `core/retrospective/schemas.ts` |
| `QualityScore` | `QualityScore` (per-persona) | `core/retrospective/schemas.ts`, `persona_stats` table |
| `DecisionPattern` | `DecisionPattern` (deep retro output) | `core/retrospective/schemas.ts` |
| `archived lifecycles` | events table + `improvement_candidates` rows; **no per-lifecycle aggregate yet** | gap |
| `consistency_score` | not computed yet | gap |
| `playbook` (export bundle) | scattered across DB rows; **no aggregator yet** | gap |
| `gate_thresholds` | not tracked | gap |
| Fast path (per-iteration) | per-merge retrospective workflow | `core/workflows/retrospective.ts` |
| Analytical path (cross-session) | not built yet | gap (planned: cross-run miner + cross-merge retro) |
| Nightly retrospective | not built yet | gap (planned as on-demand + scheduled) |
| Session mining (user corrections) | not built yet | future milestone |
| `skills/<name>/SKILL.md` | `skills/<name>/skill.md` | same idea, lowercase filename |
| Skill frontmatter (YAML) | `skills/<name>/config.ts` (Zod) + `skill.md` body | split across two files |

## Decision-type overlap

Steve's `decision_type` enum and our `DecisionKindSchema` cover overlapping ground but aren't identical. Steve's tend to be workflow-orchestration decisions; ours include those plus per-skill verdicts.

| Steve's decision_type | Closest Goose Hub kind | Notes |
|---|---|---|
| MODEL_SELECTION | (none yet) | Would be added when model-router lands |
| SCOPE_CHANGE | `SCOPE_CHANGE` (if added) or `WORKFLOW_NOTE` | Currently we don't track scope changes as a first-class kind |
| SKIP_GATE | `GATE_SKIPPED` (if added) | Currently surfaced via gate events, not decision summaries |
| ESCALATE | `agent.retry-escalated` event | We emit it as an event kind, not a decision-summary kind |
| FIX_STRATEGY | `STRATEGY` / `VERDICT` | Captured but less structured |

## Learning categories

Steve's enum maps cleanly:

| Steve | Goose Hub | Notes |
|---|---|---|
| GOTCHA | use as-is in `LearningEntry.observation` | We don't enforce a category enum |
| PATTERN | `DecisionPattern` | Different shape, same intent |
| REGRESSION_ROOT_CAUSE | `improvementKind: workflow` | Loose mapping |
| TOOL_ISSUE | `improvementKind: project-config` | Loose mapping |
| ARCHITECTURE | `improvementKind: skill-prompt` or ADR | Loose mapping |

## What we're adopting

In sequence:

1. **Lifecycle archive** — explicit per-lifecycle aggregate row, so the miner has a clean input.
2. **Cross-run pattern miner** — group decision summaries by `(kind, role)`, compute `consistency_score`, persist to a `decision_patterns` table.
3. **Convergence detector** — per-persona, per-skill quality-score trend across the windowed archive (today's `trend` field becomes computed, not self-reported).
4. **Cross-merge retro skill** — on-demand and scheduled. Reads N archives, produces ranked improvement candidates with consistency + impact/effort.
5. **Playbook writer** — aggregator that turns mined patterns + learnings + gate thresholds + cost baselines into a single `PlaybookManifest` artifact.
6. **Skill-coach** — triggered when a candidate of `kind ∈ {skill-prompt, skill-schema, skill-config}` has `consistency_score > 0.8` across ≥N archives. Output is a candidate `proposedDiff` to a `skill.md`. Never auto-applied.
7. **Model router** (separate track) — pick model upfront based on issue complexity / mined patterns; current escalation logic stays as the safety net.

## What we're keeping as-is

- Per-merge retrospective (`core/workflows/retrospective.ts`) — the fast path. Feeds the new cross-run miner.
- `agent.decision-summary` capture — the "why" is the learning signal, already enforced by skill schemas.
- Holdout discipline (QA, Review never see implementation reasoning) — coach inherits this: it cannot propose patches to QA, Review, or to itself.

## What we're not adopting

- Steve's exact CLI shape (`python3 scripts/<name>.py`) — we're TypeScript + workflows, not Python scripts.
- Auto-spawning improvement lifecycles — stays human-gated per M9 defer list.
- Cross-project playbook import — deferred until multi-project support matures.
