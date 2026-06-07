# Audit Fix Plan 3: agent-runtime Helper Deduplication

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract copy-pasted private helpers shared across multiple agent-runtime files into two new shared modules: `core/agent-runtime/event-utils.ts` (pure functions used by all runners) and `core/agent-runtime/enhance-common.ts` (shared between `bug-enhance-runner.ts` and `feature-enhance-runner.ts`).

**Architecture:** The helpers are already private inside each runner file. Moving them into shared modules requires no public API changes — callers inside runners replace their local copy with an import. The canonical copy in the new file becomes the source of truth; divergent values (e.g. `outputPreview` truncation at 2000 vs 4000 chars) get resolved in one place.

**Tech Stack:** TypeScript, `node:crypto` (already used in runners)

**Files to create:**
- `core/agent-runtime/event-utils.ts` — `stableJson`, `outputSchemaHash`, `payloadRecord`, `normalizedToolName`, `outputPreview`, `ToolEventAnalysis`, `analyzeToolEvents`
- `core/agent-runtime/enhance-common.ts` — `ToolEventAnalysis`, `analyzeToolEvents` (already in event-utils; this file re-exports them and adds enhance-runner-specific shared logic)

**Files to modify (remove local copies, add import):**
- `core/agent-runtime/claude-cli.ts` (stableJson, outputSchemaHash)
- `core/agent-runtime/codex-cli.ts` (stableJson, outputSchemaHash, payloadRecord, normalizedToolName)
- `core/agent-runtime/feature-enhance-runner.ts` (stableJson, outputSchemaHash, payloadRecord, normalizedToolName, ToolEventAnalysis, analyzeToolEvents, outputPreview)
- `core/agent-runtime/bug-enhance-runner.ts` (payloadRecord, normalizedToolName, ToolEventAnalysis, analyzeToolEvents, outputPreview)
- `core/agent-runtime/invoke-skill.ts` (stableJson, outputSchemaHash)
- `core/agent-runtime/scout-runner.ts` (payloadRecord, normalizedToolName, outputPreview)
- `core/cost/repository.ts` (payloadRecord — note: this copy returns `{}` not `null`; align or keep separate — see Task 1)

---

### Task 1: Read all local copies and resolve divergences

Before writing `event-utils.ts`, read each private copy to find divergent implementations.

- [ ] **Step 1: Read stableJson copies**

```bash
grep -n -A 10 "^function stableJson" \
  core/agent-runtime/claude-cli.ts \
  core/agent-runtime/codex-cli.ts \
  core/agent-runtime/feature-enhance-runner.ts \
  core/agent-runtime/invoke-skill.ts
```

Verify all 4 copies are byte-identical. Note the TypeScript types used (`unknown` vs `Record<string, unknown>`).

- [ ] **Step 2: Read outputSchemaHash/schemaHash copies**

```bash
grep -n -A 4 "function outputSchemaHash\|function schemaHash" \
  core/agent-runtime/claude-cli.ts \
  core/agent-runtime/codex-cli.ts \
  core/agent-runtime/feature-enhance-runner.ts \
  core/agent-runtime/invoke-skill.ts
```

Note: `codex-cli.ts` calls this `schemaHash`. Use `outputSchemaHash` as the canonical name.

- [ ] **Step 3: Read payloadRecord copies**

```bash
grep -n -A 8 "function payloadRecord" \
  core/agent-runtime/codex-cli.ts \
  core/agent-runtime/feature-enhance-runner.ts \
  core/agent-runtime/bug-enhance-runner.ts \
  core/agent-runtime/scout-runner.ts \
  core/cost/repository.ts
```

The audit notes `cost/repository.ts:355` returns `{}` not `null` — divergent. **Decision:** keep `cost/repository.ts` using its own local copy (or an inline expression). The shared `payloadRecord` in `event-utils.ts` returns `Record<string, unknown> | null`.

- [ ] **Step 4: Read normalizedToolName copies**

```bash
grep -n -A 8 "function normalizedToolName" \
  core/agent-runtime/codex-cli.ts \
  core/agent-runtime/feature-enhance-runner.ts \
  core/agent-runtime/bug-enhance-runner.ts \
  core/agent-runtime/scout-runner.ts
```

Verify all 3 copies are identical.

- [ ] **Step 5: Read outputPreview copies**

```bash
grep -n -A 8 "function outputPreview\|function previewOutput" \
  core/agent-runtime/feature-enhance-runner.ts \
  core/agent-runtime/bug-enhance-runner.ts \
  core/agent-runtime/scout-runner.ts
```

Note the truncation limit differences (2000 vs 4000). **Decision:** use 4000 as the canonical limit — the larger value was already in use and is more informative in logs. Record this in a comment in `event-utils.ts`.

- [ ] **Step 6: Read ToolEventAnalysis + analyzeToolEvents**

```bash
grep -n -A 30 "ToolEventAnalysis\|analyzeToolEvents" \
  core/agent-runtime/bug-enhance-runner.ts \
  core/agent-runtime/feature-enhance-runner.ts
```

Verify the two copies are identical.

---

### Task 2: Create `core/agent-runtime/event-utils.ts`

**Files:**
- Create: `core/agent-runtime/event-utils.ts`

- [ ] **Step 1: Write the shared module**

Using the canonical implementations found in Task 1, create `core/agent-runtime/event-utils.ts`:

```typescript
import { createHash } from 'node:crypto';

type JsonSchema = Record<string, unknown>;

export function stableJson(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

export function outputSchemaHash(schema: JsonSchema | undefined): string | undefined {
  if (schema == null) return undefined;
  return createHash('sha256').update(stableJson(schema)).digest('hex').slice(0, 16);
}

export function payloadRecord(value: unknown): Record<string, unknown> | null {
  if (value != null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function normalizedToolName(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

// Truncates at 4000 chars (was 2000 in some copies — 4000 is more useful in logs).
export function outputPreview(output: unknown): string {
  const str = typeof output === 'string' ? output : JSON.stringify(output) ?? '';
  return str.length > 4000 ? `${str.slice(0, 4000)}…` : str;
}

export type ToolEventAnalysis = {
  toolName: string | null;
  toolInput: Record<string, unknown> | null;
  toolOutput: unknown;
};

export function analyzeToolEvents(events: unknown[]): ToolEventAnalysis[] {
  // Copy the exact body from feature-enhance-runner.ts or bug-enhance-runner.ts (Task 1 Step 6).
  // Replace the placeholder below with the real implementation.
  throw new Error('Replace with real implementation from Task 1 Step 6');
}
```

**IMPORTANT:** Before writing the final file, replace the `analyzeToolEvents` body with the actual implementation from Task 1 Step 6. The placeholder above will cause a runtime error if left in.

Also replace the `stableJson` body with the exact implementation verified in Task 1 Step 1 (the version above is a template — the actual sort-keys approach may differ slightly).

- [ ] **Step 2: Verify it compiles standalone**

```bash
pnpm --filter @goose-hub/core tsc --noEmit
```

---

### Task 3: Update `claude-cli.ts` to use `event-utils`

**Files:**
- Modify: `core/agent-runtime/claude-cli.ts`

- [ ] **Step 1: Find the local copies**

```bash
grep -n "function stableJson\|function outputSchemaHash" core/agent-runtime/claude-cli.ts
```

Note the line numbers.

- [ ] **Step 2: Add import**

Near the top of `claude-cli.ts`, add:

```typescript
import { outputSchemaHash, stableJson } from './event-utils.js';
```

- [ ] **Step 3: Delete local function bodies**

Delete the `stableJson` and `outputSchemaHash` private function definitions identified in Step 1.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @goose-hub/core tsc --noEmit
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @goose-hub/core test -- agent-runtime/claude-cli
```

- [ ] **Step 6: Commit**

```bash
git add core/agent-runtime/event-utils.ts core/agent-runtime/claude-cli.ts
git commit -m "refactor: extract stableJson/outputSchemaHash from claude-cli.ts to event-utils"
```

---

### Task 4: Update `codex-cli.ts` to use `event-utils`

**Files:**
- Modify: `core/agent-runtime/codex-cli.ts`

- [ ] **Step 1: Find local copies**

```bash
grep -n "function stableJson\|function outputSchemaHash\|function schemaHash\|function payloadRecord\|function normalizedToolName" \
  core/agent-runtime/codex-cli.ts
```

- [ ] **Step 2: Add import**

```typescript
import { normalizedToolName, outputSchemaHash, payloadRecord, stableJson } from './event-utils.js';
```

- [ ] **Step 3: Delete the 4 local function definitions**

Also find and rename any local call of `schemaHash(...)` to `outputSchemaHash(...)`:

```bash
grep -n "schemaHash(" core/agent-runtime/codex-cli.ts
```

Replace each call with `outputSchemaHash(`.

- [ ] **Step 4: Typecheck + test**

```bash
pnpm --filter @goose-hub/core tsc --noEmit
pnpm --filter @goose-hub/core test -- agent-runtime/codex-cli
```

- [ ] **Step 5: Commit**

```bash
git add core/agent-runtime/codex-cli.ts
git commit -m "refactor: remove stableJson/outputSchemaHash/payloadRecord/normalizedToolName from codex-cli.ts"
```

---

### Task 5: Update `feature-enhance-runner.ts` to use `event-utils`

**Files:**
- Modify: `core/agent-runtime/feature-enhance-runner.ts`

- [ ] **Step 1: Find all local copies**

```bash
grep -n "^function \|^type ToolEvent\|^export type ToolEvent" core/agent-runtime/feature-enhance-runner.ts
```

- [ ] **Step 2: Add import**

```typescript
import {
  type ToolEventAnalysis,
  analyzeToolEvents,
  normalizedToolName,
  outputPreview,
  outputSchemaHash,
  payloadRecord,
  stableJson,
} from './event-utils.js';
```

- [ ] **Step 3: Delete local function and type definitions**

Remove: `stableJson`, `outputSchemaHash`, `payloadRecord`, `normalizedToolName`, `outputPreview`, `ToolEventAnalysis` type, `analyzeToolEvents`.

- [ ] **Step 4: Typecheck + test**

```bash
pnpm --filter @goose-hub/core tsc --noEmit
pnpm --filter @goose-hub/core test -- agent-runtime/feature-enhance
```

- [ ] **Step 5: Commit**

```bash
git add core/agent-runtime/feature-enhance-runner.ts
git commit -m "refactor: remove duplicated helpers from feature-enhance-runner.ts (use event-utils)"
```

---

### Task 6: Update `bug-enhance-runner.ts` to use `event-utils`

**Files:**
- Modify: `core/agent-runtime/bug-enhance-runner.ts`

- [ ] **Step 1: Find local copies**

```bash
grep -n "^function \|^type ToolEvent" core/agent-runtime/bug-enhance-runner.ts
```

- [ ] **Step 2: Add import**

```typescript
import {
  type ToolEventAnalysis,
  analyzeToolEvents,
  normalizedToolName,
  outputPreview,
  payloadRecord,
} from './event-utils.js';
```

- [ ] **Step 3: Delete local definitions**

- [ ] **Step 4: Typecheck + test**

```bash
pnpm --filter @goose-hub/core tsc --noEmit
pnpm --filter @goose-hub/core test -- agent-runtime/bug-enhance
```

- [ ] **Step 5: Commit**

```bash
git add core/agent-runtime/bug-enhance-runner.ts
git commit -m "refactor: remove duplicated helpers from bug-enhance-runner.ts (use event-utils)"
```

---

### Task 7: Update `invoke-skill.ts` to use `event-utils`

**Files:**
- Modify: `core/agent-runtime/invoke-skill.ts`

- [ ] **Step 1: Find copies**

```bash
grep -n "function stableJson\|function outputSchemaHash" core/agent-runtime/invoke-skill.ts
```

- [ ] **Step 2: Add import + delete local definitions**

```typescript
import { outputSchemaHash, stableJson } from './event-utils.js';
```

- [ ] **Step 3: Typecheck + test**

```bash
pnpm --filter @goose-hub/core tsc --noEmit
pnpm --filter @goose-hub/core test -- agent-runtime/invoke
```

- [ ] **Step 4: Commit**

```bash
git add core/agent-runtime/invoke-skill.ts
git commit -m "refactor: remove stableJson/outputSchemaHash from invoke-skill.ts (use event-utils)"
```

---

### Task 8: Update `scout-runner.ts` to use `event-utils`

**Files:**
- Modify: `core/agent-runtime/scout-runner.ts`

- [ ] **Step 1: Find copies**

```bash
grep -n "function payloadRecord\|function normalizedToolName\|function outputPreview\|function previewOutput" \
  core/agent-runtime/scout-runner.ts
```

- [ ] **Step 2: Add import + delete local definitions**

```typescript
import { normalizedToolName, outputPreview, payloadRecord } from './event-utils.js';
```

If the local function is named `previewOutput`, rename all call-sites to `outputPreview` before deleting the definition.

- [ ] **Step 3: Typecheck + test**

```bash
pnpm --filter @goose-hub/core tsc --noEmit
pnpm --filter @goose-hub/core test -- agent-runtime/scout
```

- [ ] **Step 4: Commit**

```bash
git add core/agent-runtime/scout-runner.ts
git commit -m "refactor: remove duplicated helpers from scout-runner.ts (use event-utils)"
```

---

### Task 9: Write tests for `event-utils.ts`

**Files:**
- Create: `core/agent-runtime/event-utils.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, expect, it } from 'vitest';
import {
  normalizedToolName,
  outputPreview,
  outputSchemaHash,
  payloadRecord,
  stableJson,
} from './event-utils.js';

describe('stableJson', () => {
  it('sorts keys deterministically', () => {
    expect(stableJson({ b: 1, a: 2 })).toBe(stableJson({ a: 2, b: 1 }));
  });

  it('handles arrays', () => {
    expect(stableJson([1, 2, 3])).toBe('[1,2,3]');
  });

  it('handles null', () => {
    expect(stableJson(null)).toBe('null');
  });
});

describe('outputSchemaHash', () => {
  it('returns undefined for undefined input', () => {
    expect(outputSchemaHash(undefined)).toBeUndefined();
  });

  it('returns 16-char hex for a schema', () => {
    const hash = outputSchemaHash({ type: 'object' });
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic', () => {
    const s = { type: 'object', properties: { x: { type: 'string' } } };
    expect(outputSchemaHash(s)).toBe(outputSchemaHash(s));
  });
});

describe('payloadRecord', () => {
  it('returns the object for a plain object', () => {
    const obj = { tool_name: 'read_file' };
    expect(payloadRecord(obj)).toBe(obj);
  });

  it('returns null for arrays', () => {
    expect(payloadRecord([])).toBeNull();
  });

  it('returns null for primitives', () => {
    expect(payloadRecord('string')).toBeNull();
    expect(payloadRecord(null)).toBeNull();
  });
});

describe('normalizedToolName', () => {
  it('returns the string when non-empty', () => {
    expect(normalizedToolName('read_file')).toBe('read_file');
  });

  it('returns null for empty string', () => {
    expect(normalizedToolName('')).toBeNull();
  });

  it('returns null for non-strings', () => {
    expect(normalizedToolName(42)).toBeNull();
    expect(normalizedToolName(null)).toBeNull();
  });
});

describe('outputPreview', () => {
  it('returns short strings unchanged', () => {
    expect(outputPreview('hello')).toBe('hello');
  });

  it('truncates at 4000 chars with ellipsis', () => {
    const long = 'x'.repeat(5000);
    const preview = outputPreview(long);
    expect(preview).toHaveLength(4001); // 4000 + '…'
    expect(preview.endsWith('…')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
pnpm --filter @goose-hub/core test -- agent-runtime/event-utils
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add core/agent-runtime/event-utils.test.ts
git commit -m "test: add unit tests for event-utils.ts"
```

---

### Wrap-up

- [ ] **Step 1: Confirm no remaining local copies**

```bash
grep -rn "^function stableJson\|^function outputSchemaHash\|^function schemaHash\|^function payloadRecord\|^function normalizedToolName\|^function outputPreview\|^function previewOutput" \
  core/agent-runtime/ --include="*.ts" | grep -v "event-utils.ts"
```

Expected: no output.

- [ ] **Step 2: Full core typecheck**

```bash
pnpm --filter @goose-hub/core tsc --noEmit
```

- [ ] **Step 3: Full core test suite**

```bash
pnpm --filter @goose-hub/core test
```

Expected: all pass.
