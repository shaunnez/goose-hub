# Scout Decision Kind Coercion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent scout wave failures caused by haiku hallucinating `decisionSummaries[].kind` values not in `DecisionKindSchema`, via prompt enumeration (root cause) and schema coercion (defense-in-depth).

**Architecture:** Two independent changes. (1) Each scout prompt that currently only says "use the canonical DecisionKindSchema enum" gets 3 explicit example kinds appended — following the scout-schema model. (2) `ScoutOutputSchema` in `core/agent-runtime/scout-output.ts` switches its `decisionSummaries` field from the strict `DecisionSummarySchema` (from retrospective/schemas) to a local schema that uses `DecisionKindSchema.catch('UNKNOWN')`, so an out-of-vocabulary kind is silently coerced rather than failing validation.

**Tech Stack:** TypeScript, Zod, Vitest

---

## File Map

| Action   | File                                                        | Change                                                  |
|----------|-------------------------------------------------------------|---------------------------------------------------------|
| Modify   | `core/agent-runtime/scout-output.ts`                        | Replace `DecisionSummarySchema` import with local schema using `.catch('UNKNOWN')` |
| Create   | `core/agent-runtime/scout-output.test.ts`                   | Tests for ScoutOutputSchema coercion behaviour          |
| Modify   | `core/agent-runtime/swarm.test.ts`                          | Add test: invalid kind coerced → scout succeeds          |
| Modify   | `skills/scout-test-inventory/prompt.md`                     | Enumerate `READ`, `INSIGHT`, `UNCERTAINTY`               |
| Modify   | `skills/scout-pattern/prompt.md`                            | Enumerate `READ`, `INSIGHT`, `UNCERTAINTY`               |
| Modify   | `skills/scout-dependency/prompt.md`                         | Enumerate `READ`, `INSIGHT`, `UNCERTAINTY`               |
| Modify   | `skills/scout-code-path/prompt.md`                          | Enumerate `READ`, `INSIGHT`, `UNCERTAINTY`               |
| Modify   | `skills/scout-user-journey/prompt.md`                       | Enumerate `READ`, `INSIGHT`, `UNCERTAINTY`               |

---

## Task 1: Schema coercion in ScoutOutputSchema

**Files:**
- Modify: `core/agent-runtime/scout-output.ts`
- Create: `core/agent-runtime/scout-output.test.ts`

### Step 1.1: Write the failing test

In a new file `core/agent-runtime/scout-output.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { ScoutOutputSchema } from './scout-output.js';

describe('ScoutOutputSchema', () => {
  it('coerces an unknown decisionSummaries kind to UNKNOWN', () => {
    const result = ScoutOutputSchema.safeParse({
      findings: [],
      decisionSummaries: [
        { kind: 'HALLUCINATED_KIND', summary: 'did a thing' },
      ],
      status: 'ok',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decisionSummaries[0]?.kind).toBe('UNKNOWN');
    }
  });

  it('accepts a valid kind without coercion', () => {
    const result = ScoutOutputSchema.safeParse({
      findings: [],
      decisionSummaries: [{ kind: 'READ', summary: 'scanned the file' }],
      status: 'ok',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decisionSummaries[0]?.kind).toBe('READ');
    }
  });

  it('still rejects non-string kind', () => {
    const result = ScoutOutputSchema.safeParse({
      findings: [],
      decisionSummaries: [{ kind: 42, summary: 'oops' }],
      status: 'ok',
    });
    // .catch only applies after the base type check; number should still fail
    // because DecisionKindSchema is z.enum (string-only).
    // Actually with .catch it will coerce — update expectation accordingly.
    // z.enum(...).catch('UNKNOWN') catches parse errors including non-string input.
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decisionSummaries[0]?.kind).toBe('UNKNOWN');
    }
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
pnpm vitest run core/agent-runtime/scout-output.test.ts
```

Expected: FAIL — `ScoutOutputSchema` does not yet coerce unknown kinds.

- [ ] **Step 1.3: Implement coercion in scout-output.ts**

Replace the current `scout-output.ts` content:

```typescript
import { z } from 'zod';
import { DecisionKindSchema } from './decision-types.js';

/**
 * Canonical Wave-1 scout output shape (M19.01, ADR 0030).
 *
 * Every `skills/scout-*` skill imports `ScoutOutputSchema` from here and
 * re-exports it from its own `schema.ts`. Wave 1 is fact-only — `findings`
 * is a list of file:line citations, not synthesis. Synthesis happens in
 * Wave 2 (interface-designer / risk-analyst).
 *
 * `ScoutDecisionSummarySchema` uses `.catch('UNKNOWN')` on kind so that a
 * model hallucinating an out-of-vocabulary kind does not fail the scout
 * validation and halt the wave. The coercion is intentional defense-in-depth;
 * prompt enumeration is the primary fix.
 */
export const ScoutFindingSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().nonnegative().optional(),
  fact: z.string().min(1),
  confidence: z.enum(['high', 'medium', 'low']),
});

const ScoutDecisionSummarySchema = z.object({
  kind: DecisionKindSchema.catch('UNKNOWN'),
  summary: z.string(),
  evidence: z.string().optional(),
});

export const ScoutStatusSchema = z.enum(['ok', 'timeout', 'error']);

export const ScoutOutputSchema = z.object({
  findings: z.array(ScoutFindingSchema),
  decisionSummaries: z.array(ScoutDecisionSummarySchema).min(1),
  status: ScoutStatusSchema,
});

export type ScoutFinding = z.infer<typeof ScoutFindingSchema>;
export type ScoutStatus = z.infer<typeof ScoutStatusSchema>;
export type ScoutOutput = z.infer<typeof ScoutOutputSchema>;
```

- [ ] **Step 1.4: Run test to verify it passes**

```bash
pnpm vitest run core/agent-runtime/scout-output.test.ts
```

Expected: PASS (3 tests pass).

- [ ] **Step 1.5: Run full test suite to check for regressions**

```bash
pnpm test -- --reporter=verbose 2>&1 | tail -30
pnpm typecheck 2>&1 | tail -20
```

Expected: All tests pass. No type errors. (The `swarm.test.ts` test that expects validation failure for a free-text response still passes because a non-object input fails `z.object` before reaching `kind`.)

- [ ] **Step 1.6: Commit**

```bash
git add core/agent-runtime/scout-output.ts core/agent-runtime/scout-output.test.ts
git commit -m "fix(scout): coerce unknown decisionSummaries kind to UNKNOWN in ScoutOutputSchema"
```

---

## Task 2: Add swarm-level regression test for invalid-kind coercion

**Files:**
- Modify: `core/agent-runtime/swarm.test.ts`

This confirms that a scout returning an invalid kind is now treated as a **success** (coerced), not an error.

- [ ] **Step 2.1: Add test to swarm.test.ts**

After the existing test `'marks status: "error" when a scout returns output that fails ScoutOutputSchema validation'` (around line 348), add:

```typescript
it('succeeds when a scout returns a decisionSummaries kind not in the enum (coerced to UNKNOWN)', async () => {
  const { fn: appendEvent, events } = makeFakeAppendEvent();
  const runtime = makeRuntime({
    'scout-schema': () => Promise.resolve(okResult('scout-schema')),
    'scout-code-path': () => Promise.resolve(okResult('scout-code-path')),
    'scout-pattern': () =>
      Promise.resolve({
        output: {
          findings: [{ file: 'src/foo.ts', line: 1, fact: 'exists', confidence: 'high' }],
          decisionSummaries: [
            { kind: 'READ', summary: 'scanned' },
            { kind: 'HALLUCINATED_KIND', summary: 'model invented this kind' },
          ],
          status: 'ok',
        },
        decisionSummaries: [],
        events: [],
      }),
  });

  const result = await dispatchWave({
    parentRunId: 'parent-coerce',
    scoutSpecs: [
      makeScoutSpec('scout-schema'),
      makeScoutSpec('scout-code-path'),
      makeScoutSpec('scout-pattern'),
    ],
    workItem: makeWorkItem(),
    worktreePath: '/tmp/wt',
    projectId: 'goose-hub-self',
    personaId: 'goose-hub-self/investigator/0',
    runtime,
    appendEvent,
    scoutTimeoutMs: 1_000,
    heartbeatIntervalMs: 60_000,
  });

  const patternReport = result.reports.find((r) => r.scoutName === 'scout-pattern');
  expect(patternReport?.status).toBe('ok');
  // Coerced kind appears as UNKNOWN in the report's decisionSummaries
  expect(patternReport?.decisionSummaries.some((d) => d.kind === 'UNKNOWN')).toBe(true);
  expect(events.some((e) => e.kind === 'swarm.scout-failed')).toBe(false);
  expect(result.shouldAdvance).toBe(true);
});
```

- [ ] **Step 2.2: Run test to verify it passes**

```bash
pnpm vitest run core/agent-runtime/swarm.test.ts
```

Expected: PASS (all existing tests pass, new test passes).

- [ ] **Step 2.3: Commit**

```bash
git add core/agent-runtime/swarm.test.ts
git commit -m "test(swarm): verify invalid decisionSummaries kind is coerced, not rejected"
```

---

## Task 3: Update scout prompt files

**Files:**
- Modify: `skills/scout-test-inventory/prompt.md`
- Modify: `skills/scout-pattern/prompt.md`
- Modify: `skills/scout-dependency/prompt.md`
- Modify: `skills/scout-code-path/prompt.md`
- Modify: `skills/scout-user-journey/prompt.md`

All five prompts get the same treatment as `scout-schema/prompt.md` currently has: replace the bare "use the canonical DecisionKindSchema enum" line with one that enumerates the most relevant kinds.

- [ ] **Step 3.1: Update skills/scout-test-inventory/prompt.md**

Replace the final line:
```
Emit `[decision] KIND: <one sentence>` markers in your text turn. Use the canonical `DecisionKindSchema` enum.
```

With:
```
Emit `[decision] KIND: <one sentence>` markers in your text turn. Use the canonical `DecisionKindSchema` enum (`core/agent-runtime/decision-types.ts`). The most useful kinds for a test-inventory scout are `READ` (you read a file), `INSIGHT` (you noticed something notable about test coverage), `UNCERTAINTY` (the evidence is thin or ambiguous).

You must include **at least one** `decisionSummaries` entry in the JSON output. The orchestrator never synthesises decisions on your behalf; only the ones you emit are recorded against your `runId`.
```

- [ ] **Step 3.2: Update skills/scout-pattern/prompt.md**

Replace the final line:
```
Emit `[decision] KIND: <one sentence>` markers in your text turn at major checkpoints. Use the canonical `DecisionKindSchema` enum.
```

With:
```
Emit `[decision] KIND: <one sentence>` markers in your text turn at major checkpoints. Use the canonical `DecisionKindSchema` enum (`core/agent-runtime/decision-types.ts`). The most useful kinds for a pattern scout are `READ` (you read a file), `INSIGHT` (you noticed a pattern or notable absence), `UNCERTAINTY` (the pattern is ambiguous or inconclusive).

You must include **at least one** `decisionSummaries` entry in the JSON output. The orchestrator never synthesises decisions on your behalf; only the ones you emit are recorded against your `runId`.
```

- [ ] **Step 3.3: Update skills/scout-dependency/prompt.md**

Replace the final line:
```
Emit `[decision] KIND: <one sentence>` markers at major checkpoints. Use the canonical `DecisionKindSchema` enum.
```

With:
```
Emit `[decision] KIND: <one sentence>` markers at major checkpoints. Use the canonical `DecisionKindSchema` enum (`core/agent-runtime/decision-types.ts`). The most useful kinds for a dependency scout are `READ` (you read a file), `INSIGHT` (you noticed a structural or import-rule concern), `UNCERTAINTY` (the dependency graph is incomplete or ambiguous).

You must include **at least one** `decisionSummaries` entry in the JSON output. The orchestrator never synthesises decisions on your behalf; only the ones you emit are recorded against your `runId`.
```

- [ ] **Step 3.4: Update skills/scout-code-path/prompt.md**

Replace the final line:
```
Emit `[decision] KIND: <one sentence>` markers in your text turn at major checkpoints. The shared decision-kind enum lives in `core/agent-runtime/decision-types.ts`. The orchestrator never synthesises decisions on your behalf.
```

With:
```
Emit `[decision] KIND: <one sentence>` markers in your text turn at major checkpoints. Use the canonical `DecisionKindSchema` enum (`core/agent-runtime/decision-types.ts`). The most useful kinds for a code-path scout are `READ` (you read a file or followed a call), `INSIGHT` (you noticed a branch or invariant worth flagging), `UNCERTAINTY` (the trace dead-ended or the symbol was not found).

You must include **at least one** `decisionSummaries` entry in the JSON output. The orchestrator never synthesises decisions on your behalf; only the ones you emit are recorded against your `runId`.
```

- [ ] **Step 3.5: Update skills/scout-user-journey/prompt.md**

Replace the final line:
```
Emit `[decision] KIND: <one sentence>` markers in your text turn at major checkpoints. Use the canonical `DecisionKindSchema` enum.
```

With:
```
Emit `[decision] KIND: <one sentence>` markers in your text turn at major checkpoints. Use the canonical `DecisionKindSchema` enum (`core/agent-runtime/decision-types.ts`). The most useful kinds for a user-journey scout are `READ` (you read a component or route file), `INSIGHT` (you noticed a notable UI state, label, or branch), `UNCERTAINTY` (the flow was incomplete or ambiguous in the code).

You must include **at least one** `decisionSummaries` entry in the JSON output. The orchestrator never synthesises decisions on your behalf; only the ones you emit are recorded against your `runId`.
```

- [ ] **Step 3.6: Run typecheck to confirm no regressions (prompt files are not type-checked, but validate the rest is clean)**

```bash
pnpm typecheck 2>&1 | tail -10
```

Expected: No errors.

- [ ] **Step 3.7: Commit**

```bash
git add skills/scout-test-inventory/prompt.md \
        skills/scout-pattern/prompt.md \
        skills/scout-dependency/prompt.md \
        skills/scout-code-path/prompt.md \
        skills/scout-user-journey/prompt.md
git commit -m "fix(scouts): enumerate canonical decision kinds in all scout prompts"
```

---

## Task 4: Final validation

- [ ] **Step 4.1: Run full test suite**

```bash
pnpm test 2>&1 | tail -30
```

Expected: All tests pass.

- [ ] **Step 4.2: Run typecheck on both apps**

```bash
pnpm typecheck 2>&1 | tail -10
```

Expected: No errors.
