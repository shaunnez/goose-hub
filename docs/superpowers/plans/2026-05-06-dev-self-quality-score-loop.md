# Dev Self-Quality-Score Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-scoring step (5a) to the implement skill so dev agents score their own code against the 8-category rubric before opening a PR, enabling one quality-refactor pass if below threshold.

**Architecture:** Three files change — `decision-types.ts` gains two new enum values, `skills/implement/schema.ts` adds three optional fields plus helpers and superRefine checks, and `skills/implement/skill.md` gains step 5a (with full loop logic, scoring table, and chore skip) plus an updated example JSON block. Tests added to existing `slice.test.ts`.

**Tech Stack:** TypeScript, Zod, Vitest, pnpm

---

## File Map

| File | Change |
|---|---|
| `core/agent-runtime/decision-types.ts` | Add `SELF_SCORE`, `SELF_SCORE_WARN` to `DecisionKindSchema` enum |
| `skills/implement/schema.ts` | Import `QualityScoresSchema`+`computeOverallScore` from qa; add `anyZeroCategory` helper; add `selfQualityScore`, `selfScoreBelowThreshold`, `selfScoreWarnings` fields; extend superRefine |
| `skills/implement/skill.md` | Insert step 5a between steps 5 and 6; update output example JSON |
| `skills/implement/slice.test.ts` | Add 7 new test cases for the new schema fields |

---

### Task 1: Add SELF_SCORE and SELF_SCORE_WARN to DecisionKind enum

**Files:**
- Modify: `core/agent-runtime/decision-types.ts`

- [ ] **Step 1: Write failing test** — add to a temporary scratch check (we'll verify via typecheck after, no dedicated test file needed for enum values; AC5 verified by grep)

- [ ] **Step 2: Edit `decision-types.ts`** — add the two new enum values after `QUALITY_SCORE`:

```ts
  'QUALITY_SCORE',
  'SELF_SCORE',
  'SELF_SCORE_WARN',
  'DIFF_READ',
```

- [ ] **Step 3: Verify grep matches**

```bash
grep -w "SELF_SCORE" core/agent-runtime/decision-types.ts
grep -w "SELF_SCORE_WARN" core/agent-runtime/decision-types.ts
```
Expected: exactly 1 match each (the enum value line).

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add core/agent-runtime/decision-types.ts
git commit -m "feat: add SELF_SCORE and SELF_SCORE_WARN to DecisionKind enum"
```

---

### Task 2: Extend skills/implement/schema.ts

**Files:**
- Modify: `skills/implement/schema.ts`
- Modify: `skills/implement/slice.test.ts`

- [ ] **Step 1: Write failing tests first** — add to `skills/implement/slice.test.ts` inside the existing `describe('implement output schema', ...)` block:

```ts
describe('self-quality-score fields', () => {
  const validScores = {
    openClosed: 18,
    conceptCount: 12,
    timeToCapability: 13,
    complecting: 14,
    loc: 8,
    coupling: 9,
    gallsLaw: 9,
    cyclomaticComplexity: 4,
  }; // sum = 87

  const baseChore = {
    plan: 'chore',
    filesWritten: [{ path: 'docs/x.md', reason: 'docs' }],
    testsWritten: [],
    testsRun: { command: 'pnpm test ', paths: [] },
    prUrl: 'https://github.com/owner/repo/issues/1',
    evidenceSpecPath: null,
    confidence: 'medium' as const,
    decisionSummaries: [{ kind: 'PLAN', summary: 'docs only' }],
  };

  const baseImpl = {
    ...baseChore,
    filesWritten: [
      { path: 'core/foo/bar.ts', reason: 'impl' },
      { path: 'core/foo/bar.test.ts', reason: 'tests' },
    ],
    testsWritten: [{ path: 'core/foo/bar.test.ts', cases: 3 }],
    testsRun: { command: 'pnpm test ', paths: ['core/foo/bar.test.ts'] },
    confidence: 'high' as const,
  };

  it('AC schema T1: accepts valid scores with selfScoreBelowThreshold false', () => {
    const result = ImplementSchema.safeParse({
      ...baseImpl,
      selfQualityScore: validScores,
      selfScoreBelowThreshold: false,
      selfScoreWarnings: [],
    });
    expect(result.success).toBe(true);
  });

  it('AC schema T2: accepts without scores (backward compat / chore)', () => {
    expect(ImplementSchema.safeParse(baseChore).success).toBe(true);
  });

  it('AC schema T3: high confidence + below threshold => warns, no hard-fail', () => {
    const result = ImplementSchema.safeParse({
      ...baseImpl,
      selfScoreBelowThreshold: true,
      confidence: 'high',
      selfScoreWarnings: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.selfScoreWarnings.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('AC schema T4: low confidence + threshold passed => warns, no hard-fail', () => {
    const result = ImplementSchema.safeParse({
      ...baseImpl,
      selfScoreBelowThreshold: false,
      confidence: 'low',
      selfScoreWarnings: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.selfScoreWarnings.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('AC schema T5: score tuple inconsistent with flag => hard-fail', () => {
    // validScores sums to 87 (>= 70, no zero) but flag says below threshold
    const result = ImplementSchema.safeParse({
      ...baseImpl,
      selfQualityScore: validScores,
      selfScoreBelowThreshold: true,
      selfScoreWarnings: [],
    });
    expect(result.success).toBe(false);
  });

  it('AC schema T6a: anyZeroCategory returns true when a category is zero', () => {
    expect(anyZeroCategory({ ...validScores, openClosed: 0 })).toBe(true);
  });

  it('AC schema T6b: anyZeroCategory returns false when no category is zero', () => {
    expect(anyZeroCategory(validScores)).toBe(false);
  });

  it('AC schema T7a: computeOverallScore sums to 100 for max scores', () => {
    expect(
      computeOverallScore({
        openClosed: 20,
        conceptCount: 15,
        timeToCapability: 15,
        complecting: 15,
        loc: 10,
        coupling: 10,
        gallsLaw: 10,
        cyclomaticComplexity: 5,
      }),
    ).toBe(100);
  });

  it('AC schema T7b: computeOverallScore returns 0 for all-zero scores', () => {
    expect(
      computeOverallScore({
        openClosed: 0,
        conceptCount: 0,
        timeToCapability: 0,
        complecting: 0,
        loc: 0,
        coupling: 0,
        gallsLaw: 0,
        cyclomaticComplexity: 0,
      }),
    ).toBe(0);
  });
});
```

Also add this import at the top of the test file:
```ts
import { anyZeroCategory, computeOverallScore } from '../qa/schema.js';
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test  skills/implement/slice.test.ts
```
Expected: tests in `self-quality-score fields` describe block fail (anyZeroCategory not exported yet, new schema fields absent).

- [ ] **Step 3: Implement schema changes in `skills/implement/schema.ts`**

Add import at top (after existing imports):
```ts
import { QualityScoresSchema, computeOverallScore } from '../qa/schema.js';
export { computeOverallScore };
```

Add helper function after imports:
```ts
export function anyZeroCategory(scores: z.infer<typeof QualityScoresSchema>): boolean {
  return Object.values(scores).some((v) => v === 0);
}
```

Add three fields to `ImplementSchema` object (after `confidence`):
```ts
    selfQualityScore: QualityScoresSchema.optional().describe(
      '8-category quality score the developer self-assigned; absent for chore PRs',
    ),
    selfScoreBelowThreshold: z
      .boolean()
      .optional()
      .describe('true when final self-score fails threshold (< 70) or single-zero rule'),
    selfScoreWarnings: z.array(z.string()).default([]).describe(
      'Non-fatal consistency warnings from superRefine (confidence vs threshold contradictions)',
    ),
```

Extend the superRefine function — add the following checks after the existing two checks:

```ts
    // Soft warning 1: below threshold but high confidence
    if (val.selfScoreBelowThreshold === true && val.confidence === 'high') {
      val.selfScoreWarnings.push(
        'selfScoreBelowThreshold is true but confidence is high — contradictory',
      );
    }
    // Soft warning 2: threshold passed but low confidence
    if (val.selfScoreBelowThreshold === false && val.confidence === 'low') {
      val.selfScoreWarnings.push(
        'selfScoreBelowThreshold is false but confidence is low — contradictory',
      );
    }
    // Hard-fail: score tuple inconsistent with flag
    if (val.selfQualityScore != null && val.selfScoreBelowThreshold != null) {
      const score = computeOverallScore(val.selfQualityScore);
      const hasZero = anyZeroCategory(val.selfQualityScore);
      const shouldBeBelow = score < 70 || hasZero;
      if (shouldBeBelow !== val.selfScoreBelowThreshold) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `selfScoreBelowThreshold (${val.selfScoreBelowThreshold}) is inconsistent with selfQualityScore (aggregate ${score}, anyZero ${hasZero})`,
          path: ['selfScoreBelowThreshold'],
        });
      }
    }
```

Note: the superRefine callback must be changed to `async`-style with mutable `val`. Since Zod's superRefine gives us the value after parsing (including `.default([])`), we can mutate `val.selfScoreWarnings` directly (it's a mutable array).

- [ ] **Step 4: Run tests**

```bash
pnpm test  skills/implement/slice.test.ts
```
Expected: all tests pass.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```
Expected: exits 0.

- [ ] **Step 6: Verify grep checks from spec**

```bash
grep "selfQualityScore" skills/implement/schema.ts
grep "selfScoreBelowThreshold" skills/implement/schema.ts
grep "selfScoreWarnings" skills/implement/schema.ts
```
Expected: ≥ 1 match each.

- [ ] **Step 7: Commit**

```bash
git add skills/implement/schema.ts skills/implement/slice.test.ts
git commit -m "feat: add selfQualityScore, selfScoreBelowThreshold, selfScoreWarnings to ImplementSchema"
```

---

### Task 3: Update skills/implement/skill.md

**Files:**
- Modify: `skills/implement/skill.md`

- [ ] **Step 1: Insert step 5a after step 5 ("Refactor") and before step 6 ("Lint and typecheck")**

Insert the following block between `### 5 — Refactor` and `### 6 — Lint and typecheck`:

```markdown
### 5a — Self-score

Skip this step entirely if `testsWritten` is `[]` (chore PR — nothing behavioural to score; leave `selfQualityScore` and `selfScoreBelowThreshold` absent).

Score the files you wrote or modified during this session. Do NOT run git diff — you have already read every file you touched. Score from memory of what you wrote.

For each of the 8 categories, assign an integer score using the table below.
Compute aggregate = sum of all 8 scores (0–100).
Any single category at 0 is an automatic fail regardless of aggregate.

Emit: `[decision] SELF_SCORE: <aggregate>/100 — lowest: <category> (<score>/<max>) because <one sentence>`

If aggregate ≥ 70 AND no category is 0: proceed to step 6.

If aggregate < 70 OR any category is 0:
  Make one focused quality-refactor targeting the lowest-scoring or zero category.
  The quality-refactor does NOT count toward the two-rewrite cap (discipline rule 4); they are separate limits.
  Re-run the targeted Vitest test command (same paths as step 4 Green) to confirm still green.
  Do NOT re-run Playwright at this stage.
  Re-score using the same table. Second score is final.

  If second aggregate ≥ 70 AND no category is 0:
    Emit: `[decision] SELF_SCORE: <aggregate>/100 after quality-refactor — lowest: <category> (<score>/<max>)`
    Proceed to step 6.

  If second aggregate < 70 OR any category still 0:
    Set `selfScoreBelowThreshold = true`.
    Emit: `[decision] SELF_SCORE_WARN: <aggregate>/100 after quality-refactor — proceeding, QA will adjudicate`
    Proceed to step 6.

#### Scoring table

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
```

- [ ] **Step 2: Update the output example JSON block** — in the `## Output format` section, replace the example JSON with one that includes `selfQualityScore`, `selfScoreBelowThreshold`, `selfScoreWarnings`, and a `SELF_SCORE` decision summary:

```json
{
  "plan": "1. Add tests for X in Y. 2. Implement X. 3. Lint passes.",
  "filesWritten": [
    { "path": "core/foo/bar.ts", "reason": "new helper for X" },
    { "path": "core/foo/bar.test.ts", "reason": "tests for X" }
  ],
  "testsWritten": [{ "path": "core/foo/bar.test.ts", "cases": 3 }],
  "testsRun": {
    "command": "pnpm test ",
    "paths": ["core/foo/bar.test.ts"]
  },
  "prUrl": "https://github.com/owner/repo/issues/123",
  "evidenceSpecPath": "apps/web/e2e/issue-123.spec.ts",
  "selfQualityScore": {
    "openClosed": 18,
    "conceptCount": 12,
    "timeToCapability": 13,
    "complecting": 14,
    "loc": 8,
    "coupling": 9,
    "gallsLaw": 9,
    "cyclomaticComplexity": 4
  },
  "selfScoreBelowThreshold": false,
  "selfScoreWarnings": [],
  "confidence": "high",
  "decisionSummaries": [
    { "kind": "PLAN", "summary": "Add helper at core/foo/bar.ts; mirror existing baz pattern" },
    { "kind": "RED", "summary": "Wrote 3 failing tests covering the success and two error paths" },
    { "kind": "GREEN", "summary": "Implementation passes all 3 targeted tests" },
    { "kind": "SELF_SCORE", "summary": "87/100 — lowest: loc (8/10) because helper adds ~60 net lines" },
    { "kind": "LINT", "summary": "Lint and typecheck clean" }
  ]
}
```

- [ ] **Step 3: Verify grep checks from spec**

```bash
grep -w "SELF_SCORE" skills/implement/skill.md
grep -w "SELF_SCORE_WARN" skills/implement/skill.md
grep -w "quality-refactor" skills/implement/skill.md
grep "two-rewrite cap" skills/implement/skill.md
grep "single category.*zero\|zero.*single category" skills/implement/skill.md
grep "selfScoreBelowThreshold" skills/implement/skill.md
grep '"openClosed"' skills/implement/skill.md
grep '"SELF_SCORE"' skills/implement/skill.md
grep "chore\|testsWritten.*empty\|no.*test" skills/implement/skill.md
```
Expected: all return ≥ 1 match (SELF_SCORE ≥ 2, SELF_SCORE_WARN ≥ 1).

- [ ] **Step 4: Verify QA skill unchanged**

```bash
git diff HEAD -- skills/qa/
```
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add skills/implement/skill.md
git commit -m "feat: insert step 5a self-score loop into implement skill"
```

---

### Task 4: Full verification pass

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```
Expected: exits 0, all tests pass.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```
Expected: exits 0.

- [ ] **Step 3: Run all AC grep checks from spec**

```bash
grep -w "SELF_SCORE" skills/implement/skill.md | wc -l       # >= 2
grep -w "SELF_SCORE_WARN" skills/implement/skill.md | wc -l  # >= 1
grep -w "quality-refactor" skills/implement/skill.md | wc -l # >= 2
grep "two-rewrite cap" skills/implement/skill.md | wc -l     # >= 1
grep "selfScoreBelowThreshold" skills/implement/schema.ts | wc -l  # >= 1
grep "selfQualityScore" skills/implement/schema.ts | wc -l         # >= 1
grep "selfScoreWarnings" skills/implement/schema.ts | wc -l        # >= 1
grep -w "SELF_SCORE" core/agent-runtime/decision-types.ts | wc -l      # == 1
grep -w "SELF_SCORE_WARN" core/agent-runtime/decision-types.ts | wc -l # == 1
git diff HEAD -- skills/qa/   # no output
```
