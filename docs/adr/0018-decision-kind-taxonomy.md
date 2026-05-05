# ADR 0018 — Decision-kind taxonomy (`step` → `kind` rename)

## Status

Accepted (M9, issue #466).

## Context

`DecisionSummary.step` was typed as a free-text string. Three coexisting flavours emerged across skills:

1. Phase names — `plan`, `red`, `green`, `lint`, `commit` (TDD checkpoints in implement)
2. Verification tier names — `structural-check`, `functional-check`, `criteria-check` (QA)
3. Free text — `keyword-match`, `tier-select`, `retro-complete`, `analyse`, `root-cause-hypothesis`

Only `skills/triage/README.md` documented a (separate) vocabulary, and the schema enforced none of it. Multi-project retrospective (M10+) needs a stable group-by key to compare decisions across the corpus; an unconstrained string makes that work harder than it needs to be.

## Decision

Promote `step: z.string()` to `kind: DecisionKindSchema` — a shared `z.enum` defined once in `core/agent-runtime/decision-types.ts` and consumed everywhere through `core/retrospective/schemas.ts`.

`kind` is enforced at three points: skill output schemas (validation at run end), the PostToolUse hook regex (live `[decision]` markers), and `recordDecisionSummary()` on the server (best-effort; invalid kinds are coerced to `UNKNOWN` and logged rather than dropped, so events surface even when an agent emits a malformed marker).

Three groups, chosen to cover the observed vocabulary without expanding the surface area:

- **Cross-cutting decisions** — apply to any role: `MODEL_SELECTION`, `SCOPE_CHANGE`, `FIX_STRATEGY`, `SKIP_GATE`, `ESCALATE`
- **Phase markers** — TDD-loop and verification-tier checkpoints: `READ`, `PLAN`, `RED`, `GREEN`, `REFACTOR`, `LINT`, `COMMIT`, `STRUCTURAL_CHECK`, `FUNCTIONAL_CHECK`, `REGRESSION_CHECK`, `CRITERIA_CHECK`, `QUALITY_SCORE`, `DIFF_READ`, `VERDICT`
- **Self-observations** — the agent reporting on its own state: `TOOL_FAILURE`, `RETRY`, `BLOCKER`, `INSIGHT`, `UNCERTAINTY`, `DEFERRED`

`summary` and `evidence` are unchanged — they remain free text. The enum constrains only the group-by key.

## Live-marker format

The `[decision]` marker line in skill prompts becomes `[decision] KIND: <one-sentence summary>`. The PostToolUse hook regex is `/^\[decision\]\s+([A-Z_]+):\s+(.+)$/m`. Markers without a recognisable kind are forwarded with `kind: 'UNKNOWN'` so the live stream doesn't go silent on a malformed line.

## Migration of historical events

Out of scope for this ADR. The SQLite event store may contain `agent.decision-summary` events written under the old `step` shape. Readers that touch these events label them `kind: 'UNKNOWN'`; we accept the discontinuity rather than rewriting history.

## Consequences

- One PR touches every skill schema (12 local duplicates removed → all import the shared `DecisionSummarySchema`), every skill prompt example, every skill `slice.test.ts` fixture, and the mock-output table. Noisy diff, mechanical pass.
- Retro can group decisions across runs and projects without parsing free-text. Pattern surfacing (M10) gets a clean key.
- Future kinds are added centrally in `decision-types.ts` — skill-author churn drops to zero for vocabulary changes.
- The escape hatch `UNKNOWN` keeps the live stream resilient when an agent emits a marker the schema doesn't recognise.

## Out of scope

- UI grouping by kind in the retrospective tab (M10).
- Migration of pre-existing `step` events in SQLite (accept discontinuity).
- Auto-classification of marker text into kinds (kind is provided by the agent, not inferred).
