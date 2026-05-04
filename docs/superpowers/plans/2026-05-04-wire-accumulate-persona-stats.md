# Wire accumulatePersonaStats into Agent Workflows

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Call `accumulatePersonaStats()` at the end of every agent workflow so the Roster page shows populated persona cards.

**Architecture:** `accumulatePersonaStats()` already exists in `core/persona/accumulate.ts` with the correct DB upsert logic. It is synchronous (no await). Each workflow already has `personaId` in scope from `selectPersona()`. We add the call at each success/failure exit point — before `stateSource.transitionState` on success, at the start of each catch block on failure. Tests mock `accumulatePersonaStats` at module level (same pattern as `eventStore.appendEvent`).

**Tech Stack:** Node + TypeScript, Vitest, Drizzle SQLite

---

## File Map

| File | Change |
|------|--------|
| `slices/fix-issue/workflow.ts` | Add import + 4 call sites (abort, advisor-proceed, main-success, catch) |
| `slices/fix-issue/slice.test.ts` | Add vi.mock + assertions for success and failure paths |
| `slices/qa/workflow.ts` | Add import + 2 call sites (success/failure, catch) |
| `slices/qa/slice.test.ts` | Add vi.mock + assertions |
| `slices/review/workflow.ts` | Add import + 2 call sites (success/failure, catch) |
| `slices/review/slice.test.ts` | Add vi.mock + assertions |
| `slices/investigate/workflow.ts` | Add import + 2 call sites (success, catch) |
| `slices/investigate/slice.test.ts` | Add vi.mock + assertions |
| `core/workflows/retrospective.ts` | Add import + 2 call sites (success, catch) |
| `core/workflows/slice.test.ts` | Add vi.mock + assertions |

---

## Task 1: Wire fix-issue workflow

**Files:**
- Modify: `slices/fix-issue/workflow.ts`
- Test: `slices/fix-issue/slice.test.ts`

- [ ] **Step 1: Add failing test assertions**

In `slices/fix-issue/slice.test.ts`, add the mock at the top of the file with existing `vi.mock` calls:

```typescript
const mockAccumulatePersonaStats = vi.fn();
vi.mock('@goose-hub/core/persona/accumulate.js', () => ({
  accumulatePersonaStats: (...args: unknown[]) => mockAccumulatePersonaStats(...args),
}));
```

Add `mockAccumulatePersonaStats.mockClear();` in the `beforeEach` block.

Then add to the existing success test (find the test that checks `transitionState` is called with `'factory:needs-qa'`):

```typescript
expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
  personaName: 'proj/developer/0',
  role: 'developer',
  outcome: 'success',
});
```

And add a test for the failure path (find the test that checks transition to `'factory:needs-human'` on error):

```typescript
expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
  personaName: 'proj/developer/0',
  role: 'developer',
  outcome: 'failure',
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm vitest run slices/fix-issue/slice.test.ts 2>&1 | tail -20
```

Expected: FAIL — `accumulatePersonaStats` not called.

- [ ] **Step 3: Add import to fix-issue/workflow.ts**

At the top of `slices/fix-issue/workflow.ts`, after the existing imports, add:

```typescript
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';
```

- [ ] **Step 4: Add call at advisor abort exit (line ~134)**

Replace:
```typescript
        await stateSource.transitionState(
          workItem.externalId,
          'factory:in-progress',
          'factory:needs-human',
        );
        return;
```
With:
```typescript
        await stateSource.transitionState(
          workItem.externalId,
          'factory:in-progress',
          'factory:needs-human',
        );
        accumulatePersonaStats({ personaName: implementPersonaId, role: 'developer', outcome: 'failure' });
        return;
```

- [ ] **Step 5: Add call at advisor-proceed success exit (line ~157)**

Replace:
```typescript
        await afterImplement({
          implementOutput: firstAttempt,
          workItem,
          stateSource,
          projectId,
          targetRepo,
          runId,
          worktreePath,
          openPRFn,
          runtime,
          evidencePostPrompt,
          evidencePostJsonSchema,
          resolveHeadShaFn,
        });
        return;
```
With:
```typescript
        await afterImplement({
          implementOutput: firstAttempt,
          workItem,
          stateSource,
          projectId,
          targetRepo,
          runId,
          worktreePath,
          openPRFn,
          runtime,
          evidencePostPrompt,
          evidencePostJsonSchema,
          resolveHeadShaFn,
        });
        accumulatePersonaStats({ personaName: implementPersonaId, role: 'developer', outcome: 'success' });
        return;
```

- [ ] **Step 6: Add call at main success exit (line ~189)**

Replace:
```typescript
    await afterImplement({
      implementOutput,
      workItem,
      stateSource,
      projectId,
      targetRepo,
      runId,
      worktreePath,
      openPRFn,
      runtime,
      evidencePostPrompt,
      evidencePostJsonSchema,
      resolveHeadShaFn,
    });
  } catch (err) {
```
With:
```typescript
    await afterImplement({
      implementOutput,
      workItem,
      stateSource,
      projectId,
      targetRepo,
      runId,
      worktreePath,
      openPRFn,
      runtime,
      evidencePostPrompt,
      evidencePostJsonSchema,
      resolveHeadShaFn,
    });
    accumulatePersonaStats({ personaName: implementPersonaId, role: 'developer', outcome: 'success' });
  } catch (err) {
```

- [ ] **Step 7: Add call in catch block (line ~191)**

Replace:
```typescript
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    eventStore.appendEvent({
```
With:
```typescript
  } catch (err) {
    accumulatePersonaStats({ personaName: implementPersonaId, role: 'developer', outcome: 'failure' });
    const error = err instanceof Error ? err : new Error(String(err));
    eventStore.appendEvent({
```

- [ ] **Step 8: Run tests and confirm they pass**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm vitest run slices/fix-issue/slice.test.ts 2>&1 | tail -20
```

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add slices/fix-issue/workflow.ts slices/fix-issue/slice.test.ts
git commit -m "feat(persona): wire accumulatePersonaStats into fix-issue workflow"
```

---

## Task 2: Wire QA workflow

**Files:**
- Modify: `slices/qa/workflow.ts`
- Test: `slices/qa/slice.test.ts`

- [ ] **Step 1: Add failing test assertions**

In `slices/qa/slice.test.ts`, add the mock with existing `vi.mock` calls:

```typescript
const mockAccumulatePersonaStats = vi.fn();
vi.mock('@goose-hub/core/persona/accumulate.js', () => ({
  accumulatePersonaStats: (...args: unknown[]) => mockAccumulatePersonaStats(...args),
}));
```

Add `mockAccumulatePersonaStats.mockClear();` in `beforeEach`.

In the existing test that verifies `transitionState` is called with `'factory:needs-review'` (pass verdict), add:

```typescript
expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
  personaName: 'test-project/qa/0',
  role: 'qa',
  outcome: 'success',
  qualityScore: 0.85, // overallScore 85 / 100
});
```

In the existing test that verifies transition to `'factory:qa-failed'` (fail verdict), add:

```typescript
expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
  personaName: 'test-project/qa/0',
  role: 'qa',
  outcome: 'failure',
  qualityScore: expect.any(Number),
});
```

In the test for runtime error (transition to `'factory:needs-human'` from catch), add:

```typescript
expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
  personaName: 'test-project/qa/0',
  role: 'qa',
  outcome: 'failure',
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm vitest run slices/qa/slice.test.ts 2>&1 | tail -20
```

Expected: FAIL

- [ ] **Step 3: Add import to qa/workflow.ts**

```typescript
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';
```

- [ ] **Step 4: Add call before transitionState (line ~172)**

Replace:
```typescript
    await stateSource.transitionState(workItem.externalId, 'factory:needs-qa', nextState);
  } catch (err) {
```
With:
```typescript
    accumulatePersonaStats({
      personaName: personaId,
      role: 'qa',
      outcome: passes ? 'success' : 'failure',
      qualityScore: qaOutput.overallScore / 100,
    });
    await stateSource.transitionState(workItem.externalId, 'factory:needs-qa', nextState);
  } catch (err) {
```

- [ ] **Step 5: Add call in catch block (line ~174)**

Replace:
```typescript
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
```
With:
```typescript
  } catch (err) {
    accumulatePersonaStats({ personaName: personaId, role: 'qa', outcome: 'failure' });
    const error = err instanceof Error ? err : new Error(String(err));
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
```

- [ ] **Step 6: Run tests and confirm they pass**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm vitest run slices/qa/slice.test.ts 2>&1 | tail -20
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add slices/qa/workflow.ts slices/qa/slice.test.ts
git commit -m "feat(persona): wire accumulatePersonaStats into qa workflow"
```

---

## Task 3: Wire Review workflow

**Files:**
- Modify: `slices/review/workflow.ts`
- Test: `slices/review/slice.test.ts`

- [ ] **Step 1: Add failing test assertions**

In `slices/review/slice.test.ts`, add mock:

```typescript
const mockAccumulatePersonaStats = vi.fn();
vi.mock('@goose-hub/core/persona/accumulate.js', () => ({
  accumulatePersonaStats: (...args: unknown[]) => mockAccumulatePersonaStats(...args),
}));
```

Add `mockAccumulatePersonaStats.mockClear();` in `beforeEach`.

In the test that verifies transition to `'factory:approved'` (approved verdict), add:

```typescript
expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
  personaName: 'test-project/reviewer/0',
  role: 'reviewer',
  outcome: 'success',
  qualityScore: 0.9, // confidence from makeApprovedResult()
});
```

In the test that verifies transition to `'factory:needs-fix'` (needs-fix verdict), add:

```typescript
expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
  personaName: 'test-project/reviewer/0',
  role: 'reviewer',
  outcome: 'failure',
  qualityScore: 0.7, // confidence from makeNeedsFixResult()
});
```

In the test for runtime error path, add:

```typescript
expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
  personaName: 'test-project/reviewer/0',
  role: 'reviewer',
  outcome: 'failure',
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm vitest run slices/review/slice.test.ts 2>&1 | tail -20
```

Expected: FAIL

- [ ] **Step 3: Add import to review/workflow.ts**

```typescript
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';
```

- [ ] **Step 4: Add call before transitionState (line ~125)**

Replace:
```typescript
    await stateSource.transitionState(workItem.externalId, 'factory:needs-review', nextState);
  } catch (err) {
```
With:
```typescript
    accumulatePersonaStats({
      personaName: personaId,
      role: 'reviewer',
      outcome: reviewOutput.verdict === 'approved' ? 'success' : 'failure',
      qualityScore: reviewOutput.confidence,
    });
    await stateSource.transitionState(workItem.externalId, 'factory:needs-review', nextState);
  } catch (err) {
```

- [ ] **Step 5: Add call in catch block (line ~127)**

Replace:
```typescript
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    eventStore.appendEvent({
```
With:
```typescript
  } catch (err) {
    accumulatePersonaStats({ personaName: personaId, role: 'reviewer', outcome: 'failure' });
    const error = err instanceof Error ? err : new Error(String(err));

    eventStore.appendEvent({
```

- [ ] **Step 6: Run tests and confirm they pass**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm vitest run slices/review/slice.test.ts 2>&1 | tail -20
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add slices/review/workflow.ts slices/review/slice.test.ts
git commit -m "feat(persona): wire accumulatePersonaStats into review workflow"
```

---

## Task 4: Wire Investigate workflow

**Files:**
- Modify: `slices/investigate/workflow.ts`
- Test: `slices/investigate/slice.test.ts`

- [ ] **Step 1: Add failing test assertions**

In `slices/investigate/slice.test.ts`, add mock:

```typescript
const mockAccumulatePersonaStats = vi.fn();
vi.mock('@goose-hub/core/persona/accumulate.js', () => ({
  accumulatePersonaStats: (...args: unknown[]) => mockAccumulatePersonaStats(...args),
}));
```

Add `mockAccumulatePersonaStats.mockClear();` in `beforeEach`.

In the test that verifies `transitionState` to `'factory:investigation-complete'` (success path), add:

```typescript
expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
  personaName: 'test-project/investigator/0',
  role: 'investigator',
  outcome: 'success',
});
```

In the test that verifies `transitionState` to `'factory:needs-human'` (failure path), add:

```typescript
expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
  personaName: 'test-project/investigator/0',
  role: 'investigator',
  outcome: 'failure',
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm vitest run slices/investigate/slice.test.ts 2>&1 | tail -20
```

Expected: FAIL

- [ ] **Step 3: Add import to investigate/workflow.ts**

```typescript
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';
```

- [ ] **Step 4: Add call before success transitionState**

Locate the `await stateSource.transitionState(workItem.externalId, 'factory:investigating', 'factory:investigation-complete');` line.

Replace:
```typescript
    await stateSource.transitionState(
      workItem.externalId,
      'factory:investigating',
      'factory:investigation-complete',
    );
```
With:
```typescript
    accumulatePersonaStats({ personaName: personaId, role: 'investigator', outcome: 'success' });
    await stateSource.transitionState(
      workItem.externalId,
      'factory:investigating',
      'factory:investigation-complete',
    );
```

- [ ] **Step 5: Add call in catch block**

Locate the catch block:
```typescript
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    // Persist failure event
    eventStore.appendEvent({
```

Replace:
```typescript
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    // Persist failure event
    eventStore.appendEvent({
```
With:
```typescript
  } catch (err) {
    accumulatePersonaStats({ personaName: personaId, role: 'investigator', outcome: 'failure' });
    const error = err instanceof Error ? err : new Error(String(err));

    // Persist failure event
    eventStore.appendEvent({
```

- [ ] **Step 6: Run tests and confirm they pass**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm vitest run slices/investigate/slice.test.ts 2>&1 | tail -20
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add slices/investigate/workflow.ts slices/investigate/slice.test.ts
git commit -m "feat(persona): wire accumulatePersonaStats into investigate workflow"
```

---

## Task 5: Wire Retrospective workflow

**Files:**
- Modify: `core/workflows/retrospective.ts`
- Test: `core/workflows/slice.test.ts`

- [ ] **Step 1: Add failing test assertions**

In `core/workflows/slice.test.ts`, add mock (note: relative import path since this test is inside `core/`):

```typescript
const mockAccumulatePersonaStats = vi.fn();
vi.mock('../persona/accumulate.js', () => ({
  accumulatePersonaStats: (...args: unknown[]) => mockAccumulatePersonaStats(...args),
}));
```

Add `mockAccumulatePersonaStats.mockClear();` in `beforeEach`.

In the test that verifies `transitionState` to `'factory:done'` (success path), add:

```typescript
expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
  personaName: 'test-project/retrospector/0',
  role: 'retrospector',
  outcome: 'success',
});
```

In the test that verifies `transitionState` to `'factory:needs-human'` (failure path), add:

```typescript
expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
  personaName: 'test-project/retrospector/0',
  role: 'retrospector',
  outcome: 'failure',
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm vitest run core/workflows/slice.test.ts 2>&1 | tail -20
```

Expected: FAIL

- [ ] **Step 3: Add import to retrospective.ts**

In `core/workflows/retrospective.ts`, add after existing imports:

```typescript
import { accumulatePersonaStats } from '../persona/accumulate.js';
```

- [ ] **Step 4: Add call before success transitionState**

Locate `await stateSource.transitionState(workItem.externalId, 'factory:retrospecting', 'factory:done');`

Replace:
```typescript
    await stateSource.transitionState(workItem.externalId, 'factory:retrospecting', 'factory:done');
```
With:
```typescript
    accumulatePersonaStats({ personaName: personaId, role: 'retrospector', outcome: 'success' });
    await stateSource.transitionState(workItem.externalId, 'factory:retrospecting', 'factory:done');
```

- [ ] **Step 5: Add call in catch block**

Locate the catch block in `runRetrospectiveWorkflow`:
```typescript
  } catch (err) {
    eventStore.appendEvent({
      kind: 'agent.run-failed',
```

Replace:
```typescript
  } catch (err) {
    eventStore.appendEvent({
      kind: 'agent.run-failed',
```
With:
```typescript
  } catch (err) {
    accumulatePersonaStats({ personaName: personaId, role: 'retrospector', outcome: 'failure' });
    eventStore.appendEvent({
      kind: 'agent.run-failed',
```

- [ ] **Step 6: Run tests and confirm they pass**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm vitest run core/workflows/slice.test.ts 2>&1 | tail -20
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add core/workflows/retrospective.ts core/workflows/slice.test.ts
git commit -m "feat(persona): wire accumulatePersonaStats into retrospective workflow"
```

---

## Task 6: Full test suite + typecheck

- [ ] **Step 1: Run all tests**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm test 2>&1 | tail -30
```

Expected: all pass

- [ ] **Step 2: Typecheck**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm typecheck 2>&1 | tail -20
```

Expected: no errors

- [ ] **Step 3: Lint**

```bash
cd /Users/shaunnesbitt/projects/goose-hub && pnpm lint 2>&1 | tail -20
```

Expected: no errors
