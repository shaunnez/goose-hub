# Dev skill: self-quality-score loop before PR open

**Type:** feature  
**Priority:** medium  
**Milestone target:** M10 (first milestone after M9 completion — do not file against M9)  
**Surfaces touched:** `skills/implement/skill.md`, `skills/implement/schema.ts`, `core/agent-runtime/decision-types.ts`

---

## Background

The 8-category code quality rubric (sourced from Steve's training materials) is implemented in `skills/qa/schema.ts` and enforced by the QA holdout at ≥ 70/100. Scoring happens post-PR: if dev code scores below threshold, the workflow burns a full QA run, triggers `needs-fix`, and the dev agent re-runs.

Fix: dev agent runs one self-scoring pass + one optional quality-refactor before committing. Same rubric, same threshold, same single-zero-category rule. If still below after one refactor, dev opens the PR anyway but records the low score so QA and the retrospector have the signal.

QA remains a holdout and always runs independently. Dev self-scores are preventive signals, not a replacement for QA.

---

## Acceptance criteria

### AC1 — Self-score step in skill
A new step `5a — Self-score` exists in `skills/implement/skill.md` inserted after step `5 — Refactor` and before step `6 — Lint and typecheck`. **Existing step numbers 6–9 remain unchanged** (insert as 5a, do not renumber). The step instructs the agent to score its own written files against the 8 categories, emit a `[decision] SELF_SCORE:` line, and follow the loop described in the implementation notes.

**Verify:** Both of the following match:
```
grep -w "SELF_SCORE" skills/implement/skill.md      # ≥ 2 lines (distinct from SELF_SCORE_WARN)
grep -w "SELF_SCORE_WARN" skills/implement/skill.md # ≥ 1 line
```

### AC2 — One quality-refactor pass on sub-threshold score
The skill instructs the agent: when self-score < 70 **or** any single category is zero (same rule as QA), make one focused quality-refactor targeting the failing condition, re-run the targeted Vitest test command (same paths as Green step, no Playwright), re-score. The second score — pass or fail — is final. The quality-refactor does **not** count toward the two-rewrite cap (discipline rule 4); they are separate limits.

**Verify:** The following all match in `skills/implement/skill.md`:
```
grep -w "quality-refactor" skills/implement/skill.md      # ≥ 2 lines
grep "two-rewrite cap" skills/implement/skill.md          # ≥ 1 line (distinguishes limits)
grep "single category.*zero\|zero.*single category" skills/implement/skill.md  # ≥ 1 line
```

### AC3 — Sub-threshold after refactor recorded and PR still opens
When the second self-score still fails (aggregate < 70 or any category zero), the skill instructs the agent to: populate `selfScoreBelowThreshold: true`, emit `[decision] SELF_SCORE_WARN: <aggregate>/100 after quality-refactor — proceeding, QA will adjudicate`. The PR is still opened. No EventKind is emitted to the event stream (that is a follow-up concern).

**Verify:**
```
grep "selfScoreBelowThreshold" skills/implement/skill.md   # ≥ 1 line
grep "SELF_SCORE_WARN" skills/implement/skill.md           # ≥ 1 line
```

### AC4 — Schema updated
`skills/implement/schema.ts` gains two optional fields:

```ts
selfQualityScore?: QualityScores   // the 8-tuple; agent populates per-category scores
selfScoreBelowThreshold?: boolean  // true when final self-score fails threshold or single-zero rule
```

`QualityScores` is imported from `skills/qa/schema.ts` as a type (see cross-import note in implementation notes).

`ImplementSchema` superRefine adds **two** consistency checks (neither hard-fails; both collect into a `selfScoreWarnings` string array field on the output so the orchestrator can log them without `safeParse` returning `success: false`):

1. `selfScoreBelowThreshold: true` and `confidence: "high"` — contradictory (passed below threshold but claims high confidence)
2. `selfScoreBelowThreshold: false` and `confidence: "low"` — contradictory (self-score passed but agent claims low confidence)

**Implementation of non-hard-fail warnings:** add `selfScoreWarnings: z.array(z.string()).default([])` to the schema. The superRefine populates this array when contradictions are detected; it does NOT call `ctx.addIssue`. This keeps `safeParse` returning `success: true` while surfacing the inconsistency.

Additionally, superRefine enforces consistency between the score tuple and the flag: if both `selfQualityScore` and `selfScoreBelowThreshold` are present, verify that `computeOverallScore(selfQualityScore) < 70 || anyZeroCategory(selfQualityScore)` equals `selfScoreBelowThreshold`. Mismatch **hard-fails** (agent populated the fields inconsistently).

**Verify:**
```
grep "selfQualityScore" skills/implement/schema.ts        # ≥ 1 match
grep "selfScoreBelowThreshold" skills/implement/schema.ts # ≥ 1 match
grep "selfScoreWarnings" skills/implement/schema.ts       # ≥ 1 match
pnpm typecheck   # exits 0
pnpm test        # exits 0
```

### AC5 — Decision-summary kinds registered
`SELF_SCORE` and `SELF_SCORE_WARN` added to the `DecisionKind` enum in `core/agent-runtime/decision-types.ts`.

**Verify:**
```
grep -w "SELF_SCORE" core/agent-runtime/decision-types.ts     # exactly 1 match (the enum value)
grep -w "SELF_SCORE_WARN" core/agent-runtime/decision-types.ts # exactly 1 match
```

### AC6 — Skill output example updated
The example JSON block in `skills/implement/skill.md` (the one that shows plan/filesWritten/decisionSummaries etc.) includes `selfQualityScore` with all 8 sub-fields populated with realistic non-zero non-maximum integers, `selfScoreBelowThreshold: false`, `selfScoreWarnings: []`, and a `{ "kind": "SELF_SCORE", "summary": "..." }` entry in `decisionSummaries`.

**Verify:**
```
grep '"openClosed"' skills/implement/skill.md   # ≥ 1 match (in the example block)
grep '"SELF_SCORE"' skills/implement/skill.md   # ≥ 1 match (in decisionSummaries example)
```

### AC7 — Chore PRs skip self-score
Step 5a instructs: when `testsWritten` is empty (chore PR — no behaviour changed), skip the self-score step entirely. Leave `selfQualityScore` and `selfScoreBelowThreshold` absent. The 8-category rubric assumes executable logic to score; a config-only change has nothing meaningful to grade.

**Verify:** `grep "chore\|testsWritten.*empty\|no.*test" skills/implement/skill.md` returns ≥ 1 match in or near step 5a.

### AC8 — QA skill unchanged
`skills/qa/skill.md` and `skills/qa/schema.ts` are not modified by this PR.

**Verify:** `git diff HEAD -- skills/qa/` produces no output.

---

## Out of scope

- Any change to the QA holdout, review holdout, or orchestrator workflow
- Emitting a dedicated EventKind for `SELF_SCORE_WARN` to the event stream (file as follow-up if retrospector needs it)
- Wiring `selfQualityScore` into the UI
- Retrospector consuming dev vs QA score delta for calibration tracking (the `confidenceCalibration` field in `PersonaStats` is the right target; file as follow-up)
- Changing the threshold (70 is the standard from `docs/standards/verification.md`)

---

## Implementation notes

### Cross-import: skills/ are the same workspace package
`skills/implement/schema.ts` may import from `skills/qa/schema.ts`. Both live in the `@goose-hub/skills` workspace package (`skills/package.json`). This is not a slice-to-slice import (FACTORY_RULES rule 11 applies to workflow slices in `slices/`, not skill files in `skills/`). Confirm the import path resolves before writing skill.md:

```ts
import { QualityScoresSchema, computeOverallScore } from '../qa/schema.js';
```

Run `pnpm typecheck` immediately after adding the import and before writing any other changes.

### Step insertion — exact placement
Insert step 5a AFTER the existing step 5 ("Refactor") and BEFORE the existing step 6 ("Lint and typecheck"). Do not renumber steps 6–9. The existing step numbering in `skill.md` is 1–9; after this change it becomes 1–5, 5a, 6–9.

### Full self-score loop logic for step 5a

```
5a — Self-score

Skip this step entirely if testsWritten is [] (chore PR — nothing behavioural to score).

Score the files you wrote or modified during this session. Do NOT run git diff — 
you have already read every file you touched. Score from memory of what you wrote.

For each of the 8 categories, assign an integer score using the table below.
Compute aggregate = sum of all 8 scores (0–100).
Any single category at 0 is an automatic fail regardless of aggregate.

Emit: [decision] SELF_SCORE: <aggregate>/100 — lowest: <category> (<score>/<max>) because <one sentence>

If aggregate ≥ 70 AND no category is 0: proceed to step 6.

If aggregate < 70 OR any category is 0:
  Make one focused quality-refactor targeting the lowest-scoring or zero category.
  The quality-refactor does NOT count toward the two-rewrite cap (discipline rule 4).
  Re-run the targeted Vitest test command (same paths as step 4 Green) to confirm still green.
  Do NOT re-run Playwright at this stage.
  Re-score using the same table. Second score is final.
  
  If second aggregate ≥ 70 AND no category is 0:
    Emit: [decision] SELF_SCORE: <aggregate>/100 after quality-refactor — lowest: <category> (<score>/<max>)
    Proceed to step 6.
  
  If second aggregate < 70 OR any category still 0:
    Set selfScoreBelowThreshold = true.
    Emit: [decision] SELF_SCORE_WARN: <aggregate>/100 after quality-refactor — proceeding, QA will adjudicate
    Proceed to step 6.
```

### Scoring table

Score honestly. Identify your single lowest-scoring category and explain it in the decision summary. If every category scores its maximum, briefly justify why in the summary — unexplained perfect scores are a grade-inflation signal.

| Category | Max | 0 pts — absent/broken | Half pts — standard | Max pts — exceptional |
|---|---:|---|---|---|
| Open/Closed | 20 | New behaviour required modifying existing code paths | New feature is contained; existing code unchanged | Pure extension; existing functions/classes not touched |
| Concept count | 15 | Module introduces ≥ 5 new abstractions | 2–4 new abstractions | ≤ 1 new abstraction |
| Time-to-capability | 15 | A new dev would need > 30 min to understand usage | 10–30 min | < 10 min from reading names alone |
| Complecting | 15 | Unrelated concerns share functions/modules | Minor incidental coupling | Each function has exactly one job |
| LOC | 10 | > 200 net new lines for this change | 50–200 lines | < 50 lines |
| Coupling | 10 | Module adds ≥ 5 new cross-module deps | 2–4 new deps | ≤ 1 new dep |
| Gall's Law | 10 | Complexity introduced all at once | Some incremental growth | Grew from simplest working version |
| Cyclomatic complexity | 5 | Avg branches/function ≥ 8 | 4–7 | ≤ 3 |

### `computeOverallScore` usage
The agent computes the sum manually when deciding to proceed or refactor. The orchestrator can also call `computeOverallScore(selfQualityScore)` independently to verify. The superRefine consistency check uses `computeOverallScore` to validate the agent did not populate mismatched values.

Add a helper `anyZeroCategory(scores: QualityScores): boolean` in `skills/implement/schema.ts` to check single-zero-category rule. Both `computeOverallScore` and `anyZeroCategory` are needed for the superRefine consistency check.

---

## Files to create or modify

| File | Change |
|---|---|
| `skills/implement/skill.md` | Insert step 5a (full loop logic + scoring table + chore skip); update example JSON block |
| `skills/implement/schema.ts` | Add `selfQualityScore`, `selfScoreBelowThreshold`, `selfScoreWarnings` fields; import `QualityScoresSchema` + `computeOverallScore` from `../qa/schema.js`; add `anyZeroCategory` helper; add superRefine checks |
| `core/agent-runtime/decision-types.ts` | Add `SELF_SCORE` and `SELF_SCORE_WARN` to `DecisionKind` enum |

No new files. No new slice directory.

---

## Tests required

In `skills/implement/slice.test.ts` (add to existing file, do not create a new test file unless one does not yet exist):

1. **Valid with scores, threshold passed:** `ImplementSchema.parse({...validBase, selfQualityScore: { openClosed: 18, conceptCount: 12, ... }, selfScoreBelowThreshold: false, selfScoreWarnings: [] })` succeeds.

2. **Valid without scores (backward compat / chore):** `ImplementSchema.parse({...validBase})` succeeds when `selfQualityScore` and `selfScoreBelowThreshold` are absent.

3. **Warning: high confidence but below threshold:** `ImplementSchema.parse({...validBase, selfScoreBelowThreshold: true, confidence: 'high', selfScoreWarnings: [] })` succeeds (no hard-fail) but output has `selfScoreWarnings` containing ≥ 1 string about the contradiction.

4. **Warning: low confidence but threshold passed:** `ImplementSchema.parse({...validBase, selfScoreBelowThreshold: false, confidence: 'low', selfScoreWarnings: [] })` succeeds but `selfScoreWarnings` contains ≥ 1 string.

5. **Hard-fail: score tuple inconsistent with flag:** Calling parse with `selfQualityScore` that sums to 80 (no zero categories) and `selfScoreBelowThreshold: true` throws a ZodError (superRefine consistency check hard-fails this).

6. **`anyZeroCategory` helper:** `anyZeroCategory({ openClosed: 0, ...rest })` returns `true`; `anyZeroCategory({ openClosed: 1, ...rest })` returns `false`.

7. **`computeOverallScore` round-trip:** scores summing to exactly 100 return 100; scores summing to 0 return 0.

---

## Risks

**Grade inflation:** same agent that wrote the code scores it — tends optimistic. Mitigated by: (a) must name the lowest category with a reason, (b) unexplained perfect score is flagged as a signal, (c) QA remains authoritative gate. Retrospector can track dev vs QA score delta via `confidenceCalibration` in `PersonaStats` in a follow-up.

**Token cost:** no tool calls during self-score (agent scores from memory of what it wrote). One structured reasoning pass per non-chore run — marginal vs a full QA re-run on failure.

**Scope of quality-refactor:** agent may over-expand (treat the quality-refactor as a mini-rewrite). Mitigated by the "focused, targeting the lowest/zero category" instruction and the fact that tests must still pass after it.
