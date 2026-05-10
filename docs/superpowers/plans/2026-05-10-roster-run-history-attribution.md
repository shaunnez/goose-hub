# Roster: Run History + Improvement Candidate Attribution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix improvement candidate attribution so candidates appear under the correct persona, and implement the `agentRuns` table + write/read path so the Roster Run History section is populated.

**Architecture:** Two independent fixes. Fix 1 is schema + prompt changes (no migration). Fix 2 adds a new `agent_runs` SQLite table, inserts a row at the end of every `ClaudeCliRuntime.run()` call (success and failure), then wires the read path in the roster repository/service.

**Tech Stack:** TypeScript, Zod, Drizzle ORM + better-sqlite3, Hono, Vitest

---

## Files touched

| File | Change |
|---|---|
| `core/retrospective/schemas.ts` | Add `sourcePersonaId` to `ImprovementCandidateSchema` |
| `core/workflows/retrospective.ts` | `persistCandidates` uses `c.sourcePersonaId ?? provenance.personaId`; add `workItemId` to spec call |
| `skills/retrospective-light/skill.config.ts` | Add `'activePersonas'` to `contextAllowlist` |
| `skills/retrospective-light/prompt.md` | Step 3: instruct agent to set `sourcePersonaId` |
| `skills/retrospective-deep/prompt.md` | Step 6: instruct agent to set `sourcePersonaId` |
| `core/db/schema.ts` | Add `agentRuns` table definition |
| `core/db/migrations/0014_agent_runs.sql` | New migration |
| `core/db/migrations/meta/_journal.json` | Add journal entry for 0014 |
| `core/agent-runtime/interface.ts` | Add `workItemId?: string` to `AgentSpec` |
| `core/agent-runtime/claude-cli.ts` | Insert into `agentRuns` on close (success + failure) |
| `apps/server/src/domains/roster/repository.ts` | Add `listRunsByPersona()` + `AgentRunRow` type |
| `apps/server/src/domains/roster/service.ts` | Replace stub in `getPersonaRuns()`; fix `qualityScore: number \| null` |

---

## Task 1: Add `sourcePersonaId` to `ImprovementCandidateSchema`

**Files:**
- Modify: `core/retrospective/schemas.ts`
- Test: `core/workflows/slice.test.ts` (new describe block)

- [ ] **Step 1: Write the failing test**

Add a new describe block to `core/workflows/slice.test.ts`. This test needs a DB mock because `persistCandidates` calls `db.insert`. Add `vi.mock('@goose-hub/core/db/db.js', ...)` with the other mocks at the top of the file (after the existing `vi.mock` calls) and a new `mockInsert` function via `vi.hoisted`.

```ts
// In vi.hoisted block, add:
const mockDbInsert = vi.fn();

// New vi.mock:
vi.mock('@goose-hub/core/db/db.js', () => ({
  db: {
    insert: mockDbInsert,
  },
}));
```

Then add at the bottom of `core/workflows/slice.test.ts`:

```ts
describe('persistCandidates (via runRetrospectiveWorkflow)', () => {
  it('uses sourcePersonaId when present', async () => {
    const mockRun2 = vi.fn();
    const valuesRun = vi.fn().mockReturnValue(undefined);
    const values = vi.fn().mockReturnValue({ run: valuesRun });
    mockDbInsert.mockReturnValue({ values });

    mockRun2.mockResolvedValueOnce({
      output: {
        outcome: 'success',
        workItemNumber: 42,
        summary: { wentWell: 'ok', didNotGoWell: 'none', architecturalTakeaway: 'good' },
        improvementCandidates: [
          {
            kind: 'skill-prompt',
            targetPath: 'skills/developer/prompt.md',
            suggestionText: 'Add TDD instructions',
            confidence: 'high',
            sourcePersonaId: 'test-project/developer/0',
          },
        ],
        decisionSummaries: [{ kind: 'VERDICT', summary: 'Done' }],
      },
      decisionSummaries: [],
      events: [],
    });

    const { runRetrospectiveWorkflow } = await import('./retrospective.js');
    // Force module re-import to pick up mock — use the already-mocked runtime via deps
    await runRetrospectiveWorkflow({
      workItem: makeWorkItem(),
      stateSource: makeSource(),
      projectId: 'test-project',
      policy: 'always-light',
      deps: { runtime: { run: mockRun2 } },
    });

    expect(mockDbInsert).toHaveBeenCalled();
    const insertedValues = values.mock.calls[0][0];
    expect(insertedValues.personaName).toBe('test-project/developer/0');
  });

  it('falls back to provenance personaId when sourcePersonaId is absent', async () => {
    const valuesRun = vi.fn().mockReturnValue(undefined);
    const values = vi.fn().mockReturnValue({ run: valuesRun });
    mockDbInsert.mockReturnValue({ values });

    mockRun.mockResolvedValueOnce({
      output: {
        outcome: 'success',
        workItemNumber: 42,
        summary: { wentWell: 'ok', didNotGoWell: 'none', architecturalTakeaway: 'good' },
        improvementCandidates: [
          {
            kind: 'skill-prompt',
            targetPath: 'skills/developer/prompt.md',
            suggestionText: 'Add TDD instructions',
            confidence: 'high',
          },
        ],
        decisionSummaries: [{ kind: 'VERDICT', summary: 'Done' }],
      },
      decisionSummaries: [],
      events: [],
    });

    const { runRetrospectiveWorkflow } = await import('./retrospective.js');
    await runRetrospectiveWorkflow({
      workItem: makeWorkItem(),
      stateSource: makeSource(),
      projectId: 'test-project',
      policy: 'always-light',
    });

    expect(mockDbInsert).toHaveBeenCalled();
    const insertedValues = values.mock.calls[0][0];
    // retrospector persona (not developer) because sourcePersonaId absent
    expect(insertedValues.personaName).toBe('test-project/retrospector/0');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/shaunnesbitt/projects/goose-hub
pnpm vitest run core/workflows/slice.test.ts 2>&1 | tail -30
```

Expected: TypeScript error about `sourcePersonaId` not being in `ImprovementCandidateSchema`, or test fails asserting `personaName`.

- [ ] **Step 3: Add `sourcePersonaId` to `ImprovementCandidateSchema`**

In `core/retrospective/schemas.ts`, change `ImprovementCandidateSchema`:

```ts
export const ImprovementCandidateSchema = z.object({
  kind: ImprovementKindSchema,
  targetPath: z.string(),
  suggestionText: z.string(),
  evidence: z.string().optional(),
  confidence: ConfidenceSchema,
  proposedDiff: z.string().optional(),
  sourcePersonaId: z.string().optional(),
});
```

The `ImprovementCandidate` type is derived via `z.infer` — it updates automatically.

- [ ] **Step 4: Run the test again — expect failure on the assertion (schema now parses)**

```bash
pnpm vitest run core/workflows/slice.test.ts 2>&1 | tail -30
```

- [ ] **Step 5: Commit**

```bash
git add core/retrospective/schemas.ts core/workflows/slice.test.ts
git commit -m "feat(retrospective): add sourcePersonaId to ImprovementCandidateSchema"
```

---

## Task 2: Wire `sourcePersonaId` in `persistCandidates`

**Files:**
- Modify: `core/workflows/retrospective.ts`

- [ ] **Step 1: Update `persistCandidates` to use `c.sourcePersonaId`**

In `core/workflows/retrospective.ts`, change `persistCandidates`:

```ts
function persistCandidates(
  provenance: CandidateProvenance,
  candidates: ImprovementCandidate[],
): void {
  for (const c of candidates) {
    db.insert(improvementCandidates)
      .values({
        projectId: provenance.projectId,
        personaName: c.sourcePersonaId ?? provenance.personaId,
        sourceTaskId: provenance.sourceWorkItem,
        suggestionText: c.suggestionText,
        suggestionType: c.kind,
      })
      .run();
  }
}
```

- [ ] **Step 2: Run the tests**

```bash
pnpm vitest run core/workflows/slice.test.ts 2>&1 | tail -30
```

Expected: both new tests pass.

- [ ] **Step 3: Commit**

```bash
git add core/workflows/retrospective.ts
git commit -m "fix(retrospective): attribute improvement candidates to sourcePersonaId, not retrospector"
```

---

## Task 3: Fix retrospective-light skill config and prompt

**Files:**
- Modify: `skills/retrospective-light/skill.config.ts`
- Modify: `skills/retrospective-light/prompt.md`

- [ ] **Step 1: Add `'activePersonas'` to skill config contextAllowlist**

In `skills/retrospective-light/skill.config.ts`, update the `contextAllowlist`:

```ts
const config: SkillConfig = {
  contextSchema: LightRetroContextSchema,
  contextAllowlist: [
    'workItem.title',
    'workItem.body',
    'workItem.number',
    'runSummary.personaId',
    'runSummary.role',
    'runSummary.outcome',
    'runSummary.decisionSummaries',
    'activePersonas',
  ],
  toolBundles: ['core'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'retrospector',
};
```

- [ ] **Step 2: Add `sourcePersonaId` attribution instructions to prompt Step 3**

In `skills/retrospective-light/prompt.md`, in the **Step 3** section, after the existing fields list, add:

```markdown
- `sourcePersonaId` (optional) — set this to the persona ID from `<active_personas>` whose role best matches the candidate's `kind`. Use this mapping:
  - `skill-prompt`, `skill-schema`, `skill-config` → match on `targetPath` (e.g., path contains `skills/developer/` → use the developer persona ID from `<active_personas>`)
  - `workflow`, `project-config` → use the developer persona ID from `<active_personas>` (first one matching role `developer`)
  - `persona` → use the persona ID being described, if present in `<active_personas>`
  - When ambiguous or `<active_personas>` is empty, omit — the orchestrator falls back to the retrospector's ID
```

The full updated Step 3 fields block becomes:

```markdown
For each candidate, populate **only** these fields:
- `kind` — one of: `skill-prompt | skill-schema | skill-config | global-config | project-config | persona | workflow | governance-suggestion`
- `targetPath` — the file most likely to fix the issue
- `suggestionText` — one clear sentence on what to change and why
- `confidence` — `low | medium | high`
- `evidence` (optional) — short phrase pointing at the decision summary that surfaced it
- `proposedDiff` (optional) — fenced diff if obvious
- `sourcePersonaId` (optional) — set this to the persona ID from `<active_personas>` whose role best matches the candidate's `kind`. Use this mapping:
  - `skill-prompt`, `skill-schema`, `skill-config` → match on `targetPath` (e.g., path contains `skills/developer/` → developer persona ID from `<active_personas>`)
  - `workflow`, `project-config` → first persona ID from `<active_personas>` with role `developer`
  - `persona` → the persona ID being described, if present in `<active_personas>`
  - When ambiguous or `<active_personas>` is empty, omit — orchestrator falls back to retrospector ID
```

- [ ] **Step 3: Commit**

```bash
git add skills/retrospective-light/skill.config.ts skills/retrospective-light/prompt.md
git commit -m "fix(retrospective-light): add activePersonas to allowlist, instruct sourcePersonaId attribution"
```

---

## Task 4: Update retrospective-deep prompt

**Files:**
- Modify: `skills/retrospective-deep/prompt.md`

- [ ] **Step 1: Add `sourcePersonaId` attribution to Step 6**

In `skills/retrospective-deep/prompt.md`, in **Step 6 — Improvement candidates**, after the existing fields block, add the same `sourcePersonaId` instructions:

```markdown
Populate **only** these fields per candidate:
- `kind` — required, from the `ImprovementKindSchema` enum
- `targetPath` — required
- `suggestionText` — required, one clear sentence
- `confidence` — required
- `evidence` (optional) — short phrase pointing at decision summary that surfaced it
- `proposedDiff` (optional) — fenced diff if obvious
- `sourcePersonaId` (optional) — set to the persona ID from `<active_personas>` whose role best matches the candidate's `kind`. Use this mapping:
  - `skill-prompt`, `skill-schema`, `skill-config` → match on `targetPath` (e.g., path contains `skills/developer/` → developer persona ID from `<active_personas>`)
  - `workflow`, `project-config` → first persona ID from `<active_personas>` with role `developer`
  - `persona` → the persona ID being described, if present in `<active_personas>`
  - When ambiguous or `<active_personas>` is empty, omit — orchestrator falls back to retrospector ID
```

- [ ] **Step 2: Commit**

```bash
git add skills/retrospective-deep/prompt.md
git commit -m "fix(retrospective-deep): instruct sourcePersonaId attribution in Step 6"
```

---

## Task 5: Add `agentRuns` table to DB schema + migration

**Files:**
- Modify: `core/db/schema.ts`
- Create: `core/db/migrations/0014_agent_runs.sql`
- Modify: `core/db/migrations/meta/_journal.json`

- [ ] **Step 1: Add `agentRuns` to `core/db/schema.ts`**

At the end of `core/db/schema.ts`, add:

```ts
export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: text('run_id').notNull(),
    personaId: text('persona_id').notNull(),
    workItemId: text('work_item_id'),
    projectId: text('project_id').notNull(),
    role: text('role').notNull(),
    skill: text('skill').notNull(),
    outcome: text('outcome', { enum: ['success', 'failure'] }).notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  },
  (t) => ({
    runIdUniq: uniqueIndex('agent_runs_run_id_uniq').on(t.runId),
    personaIdx: index('agent_runs_persona_idx').on(t.personaId),
    projectIdx: index('agent_runs_project_idx').on(t.projectId),
  }),
);
```

- [ ] **Step 2: Create `core/db/migrations/0014_agent_runs.sql`**

Create the file with this content:

```sql
CREATE TABLE IF NOT EXISTS `agent_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`persona_id` text NOT NULL,
	`work_item_id` text,
	`project_id` text NOT NULL,
	`role` text NOT NULL,
	`skill` text NOT NULL,
	`outcome` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `agent_runs_run_id_uniq` ON `agent_runs` (`run_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `agent_runs_persona_idx` ON `agent_runs` (`persona_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `agent_runs_project_idx` ON `agent_runs` (`project_id`);
```

- [ ] **Step 3: Add entry to `core/db/migrations/meta/_journal.json`**

Append to the `entries` array in `_journal.json`:

```json
{
  "idx": 14,
  "version": "7",
  "when": 1746979200001,
  "tag": "0014_agent_runs",
  "breakpoints": true
}
```

- [ ] **Step 4: Verify migration applies cleanly (runs the smoke test)**

```bash
pnpm vitest run core/db/smoke.test.ts 2>&1 | tail -20
```

Expected: passes (smoke test uses an in-memory DB that manually creates tables, so it won't test the new migration directly — that's fine, the migration file format matches existing ones).

- [ ] **Step 5: Commit**

```bash
git add core/db/schema.ts core/db/migrations/0014_agent_runs.sql core/db/migrations/meta/_journal.json
git commit -m "feat(db): add agent_runs table for per-run history"
```

---

## Task 6: Write path — insert into `agentRuns` from `ClaudeCliRuntime`

**Files:**
- Modify: `core/agent-runtime/interface.ts`
- Modify: `core/agent-runtime/claude-cli.ts`
- Modify: `core/workflows/retrospective.ts`
- Test: `core/agent-runtime/claude-cli.test.ts` (new file)

- [ ] **Step 1: Add `workItemId?: string` to `AgentSpec`**

In `core/agent-runtime/interface.ts`, add the optional field to `AgentSpec`:

```ts
export type AgentSpec<R extends RoleSpec = RoleSpec> = {
  runId: string;
  role: R['kind'];
  skill: string;
  context: Record<string, unknown>;
  contextAllowlist: string[];
  freshContext: R extends { requiresFreshContext: true } ? true : boolean;
  toolBundles: string[];
  toolExtras: string[];
  budgets: AgentBudgets;
  personaId: string;
  /** Work-item driving this run. Promotes context.workItemId to first-class for runtime use. */
  workItemId?: string;
  modelOverride?: string;
  outputJsonSchema?: Record<string, unknown>;
  appendSystemPrompt?: string;
  workspaceDir?: string;
  env?: Record<string, string>;
  extraEventPayload?: Record<string, unknown>;
  mcpConfigPath?: string;
};
```

- [ ] **Step 2: Write the failing test for the write path**

Create `core/agent-runtime/claude-cli.test.ts`:

```ts
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDbInsert, mockRecordCost, mockEventStore, mockExecFileSync, mockSpawn } = vi.hoisted(
  () => ({
    mockDbInsert: vi.fn(),
    mockRecordCost: vi.fn(),
    mockEventStore: { appendEvent: vi.fn(), replay: vi.fn().mockReturnValue([]) },
    mockExecFileSync: vi.fn().mockReturnValue('/usr/local/bin/claude\n'),
    mockSpawn: vi.fn(),
  }),
);

vi.mock('@goose-hub/core/db/db.js', () => ({
  db: { insert: mockDbInsert },
}));
vi.mock('../cost/repository.js', () => ({ recordCost: mockRecordCost }));
vi.mock('../event-stream/store.js', () => ({ eventStore: mockEventStore }));
vi.mock('../cost/extract.js', () => ({ costFromCliEnvelope: vi.fn().mockReturnValue(null) }));
vi.mock('../cost/skill-stage.js', () => ({ stageForSkill: vi.fn().mockReturnValue('develop') }));
vi.mock('../tool-layer/allowlist.js', () => ({ computeAllowlist: vi.fn().mockReturnValue([]) }));
vi.mock('../tool-layer/pre-tool-use-hook.js', () => ({ deployHooks: vi.fn() }));
vi.mock('../tool-layer/sandbox.js', () => ({ writeWorkspaceSandbox: vi.fn() }));
vi.mock('./context-assembly.js', () => ({
  assembleSpawnContext: vi.fn().mockReturnValue({ contextXml: '<task></task>' }),
}));
vi.mock('./models.js', () => ({ defaultModelForTier: vi.fn().mockReturnValue('claude-sonnet-4-6') }));
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
  spawn: mockSpawn,
}));

import { ClaudeCliRuntime } from './claude-cli.js';

function makeSpec(overrides = {}) {
  return {
    runId: 'run-abc',
    role: 'developer' as const,
    skill: 'fix-issue',
    context: { projectId: 'test-project', workItemId: 'github:owner/repo#1' },
    contextAllowlist: [],
    freshContext: false,
    toolBundles: [],
    toolExtras: [],
    budgets: { maxTurns: 10, maxBudgetUsd: 1, timeoutMs: 5000 },
    personaId: 'test-project/developer/0',
    workItemId: 'github:owner/repo#1',
    ...overrides,
  };
}

function makeChildProcess(
  exitCode: number,
  stdout: string,
): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> } {
  const child = new EventEmitter() as ReturnType<typeof makeChildProcess>;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();

  setTimeout(() => {
    child.stdout.emit('data', Buffer.from(stdout));
    child.emit('close', exitCode);
  }, 0);

  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecFileSync.mockReturnValue('/usr/local/bin/claude\n');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ClaudeCliRuntime — agentRuns write path', () => {
  it('inserts a success row when the CLI exits with valid JSON', async () => {
    const valuesRun = vi.fn();
    const values = vi.fn().mockReturnValue({ run: valuesRun });
    mockDbInsert.mockReturnValue({ values });

    const envelope = JSON.stringify({ is_error: false, result: '{"ok":true}' });
    mockSpawn.mockReturnValue(makeChildProcess(0, envelope));

    const runtime = new ClaudeCliRuntime();
    await runtime.run(makeSpec());

    expect(mockDbInsert).toHaveBeenCalled();
    const row = values.mock.calls[0][0];
    expect(row.runId).toBe('run-abc');
    expect(row.personaId).toBe('test-project/developer/0');
    expect(row.outcome).toBe('success');
    expect(row.projectId).toBe('test-project');
    expect(row.role).toBe('developer');
    expect(row.skill).toBe('fix-issue');
    expect(row.workItemId).toBe('github:owner/repo#1');
  });

  it('inserts a failure row when the CLI exits with is_error=true', async () => {
    const valuesRun = vi.fn();
    const values = vi.fn().mockReturnValue({ run: valuesRun });
    mockDbInsert.mockReturnValue({ values });

    const envelope = JSON.stringify({ is_error: true, result: 'budget exceeded' });
    mockSpawn.mockReturnValue(makeChildProcess(0, envelope));

    const runtime = new ClaudeCliRuntime();
    await runtime.run(makeSpec()).catch(() => {});

    expect(mockDbInsert).toHaveBeenCalled();
    const row = values.mock.calls[0][0];
    expect(row.outcome).toBe('failure');
  });

  it('inserts a failure row when the CLI exits non-zero with no envelope', async () => {
    const valuesRun = vi.fn();
    const values = vi.fn().mockReturnValue({ run: valuesRun });
    mockDbInsert.mockReturnValue({ values });

    mockSpawn.mockReturnValue(makeChildProcess(1, 'not json'));

    const runtime = new ClaudeCliRuntime();
    await runtime.run(makeSpec()).catch(() => {});

    expect(mockDbInsert).toHaveBeenCalled();
    const row = values.mock.calls[0][0];
    expect(row.outcome).toBe('failure');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm vitest run core/agent-runtime/claude-cli.test.ts 2>&1 | tail -30
```

Expected: test fails because `agentRuns` insert doesn't happen yet.

- [ ] **Step 4: Wire the insert into `claude-cli.ts`**

In `core/agent-runtime/claude-cli.ts`, add imports at the top:

```ts
import { db } from '../db/db.js';
import { agentRuns } from '../db/schema.js';
```

In the `child.on('close', ...)` handler, insert a failure row **before** any existing `reject()` calls, and a success row **before** the final `resolve()` call.

For the non-zero exit (no envelope) branch — add insert before `reject`:

```ts
if (code !== 0 && envelope == null) {
  db.insert(agentRuns).values({
    runId,
    personaId,
    workItemId: spec.workItemId ?? workItemId ?? null,
    projectId,
    role: spec.role,
    skill: spec.skill,
    outcome: 'failure',
  }).run();
  eventStore.appendEvent({ ... });
  reject(...);
  return;
}
```

For the `envelope.is_error` branch — add insert before `reject`:

```ts
if (envelope?.is_error) {
  db.insert(agentRuns).values({
    runId,
    personaId,
    workItemId: spec.workItemId ?? workItemId ?? null,
    projectId,
    role: spec.role,
    skill: spec.skill,
    outcome: 'failure',
  }).run();
  eventStore.appendEvent({ ... });
  reject(...);
  return;
}
```

For the success path — add insert before `resolve`:

```ts
db.insert(agentRuns).values({
  runId,
  personaId,
  workItemId: spec.workItemId ?? workItemId ?? null,
  projectId,
  role: spec.role,
  skill: spec.skill,
  outcome: 'success',
}).run();

resolve({
  output: extractResultJson(envelope?.result ?? stdout, runId),
  decisionSummaries: [],
  events: eventStore.replay({ runId }),
});
```

The full diff for `claude-cli.ts` — only the `child.on('close', ...)` handler changes. Do not alter any other section.

- [ ] **Step 5: Update `retrospective.ts` to pass `workItemId` in spec**

In `core/workflows/retrospective.ts`, add `workItemId` to the `runtime.run()` call (alongside the existing fields):

```ts
const result = await runtime.run({
  runId,
  role: 'retrospector',
  skill: skillName,
  workItemId: workItem.id,   // ← add this
  context: { ... },
  ...
});
```

- [ ] **Step 6: Run all tests**

```bash
pnpm vitest run core/agent-runtime/claude-cli.test.ts core/workflows/slice.test.ts 2>&1 | tail -30
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add core/agent-runtime/interface.ts core/agent-runtime/claude-cli.ts core/agent-runtime/claude-cli.test.ts core/workflows/retrospective.ts
git commit -m "feat(agent-runtime): insert agent_runs row on every ClaudeCliRuntime.run() completion"
```

---

## Task 7: Read path — `listRunsByPersona` + roster service

**Files:**
- Modify: `apps/server/src/domains/roster/repository.ts`
- Modify: `apps/server/src/domains/roster/repository.test.ts`
- Modify: `apps/server/src/domains/roster/service.ts`

- [ ] **Step 1: Write the failing test for `listRunsByPersona`**

In `apps/server/src/domains/roster/repository.test.ts`, add a new import to the mock setup and a describe block.

The `mockSelect` is already hoisted. The new function needs `orderBy`, `limit`, `where` in the chain. Add at the bottom:

```ts
describe('listRunsByPersona', () => {
  it('returns rows ordered by createdAt desc', async () => {
    const rows = [
      {
        id: 1,
        runId: 'run-001',
        personaId: 'proj/developer/0',
        workItemId: 'github:owner/repo#1',
        projectId: 'proj',
        role: 'developer',
        skill: 'fix-issue',
        outcome: 'success',
        createdAt: '2026-05-10T10:00:00Z',
      },
    ];
    const all = vi.fn().mockReturnValue(rows);
    const limit = vi.fn().mockReturnValue({ all });
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({ where }),
    });

    const { listRunsByPersona } = await import('./repository.js');
    const result = listRunsByPersona('proj/developer/0');
    expect(result).toEqual(rows);
    expect(where).toHaveBeenCalled();
    expect(orderBy).toHaveBeenCalled();
    expect(limit).toHaveBeenCalledWith(50);
  });

  it('accepts a custom limit', async () => {
    const all = vi.fn().mockReturnValue([]);
    const limit = vi.fn().mockReturnValue({ all });
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({ where }),
    });

    const { listRunsByPersona } = await import('./repository.js');
    listRunsByPersona('proj/developer/0', 10);
    expect(limit).toHaveBeenCalledWith(10);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run apps/server/src/domains/roster/repository.test.ts 2>&1 | tail -20
```

Expected: `listRunsByPersona is not a function`.

- [ ] **Step 3: Add `AgentRunRow` type and `listRunsByPersona` to repository**

In `apps/server/src/domains/roster/repository.ts`:

At the top, add `agentRuns` to the schema import and `desc, eq` to the drizzle import:

```ts
import { db } from '@goose-hub/core/db/db.js';
import { agentRuns, improvementCandidates, personaNames, personaStats } from '@goose-hub/core/db/schema.js';
import { and, asc, desc, eq } from 'drizzle-orm';
```

Add the `AgentRunRow` interface (after the existing interfaces):

```ts
export interface AgentRunRow {
  id: number;
  runId: string;
  personaId: string;
  workItemId: string | null;
  projectId: string;
  role: string;
  skill: string;
  outcome: string;
  createdAt: string;
}
```

Add `listRunsByPersona` function at the end of the file:

```ts
export function listRunsByPersona(personaId: string, limit = 50): AgentRunRow[] {
  return db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.personaId, personaId))
    .orderBy(desc(agentRuns.createdAt))
    .limit(limit)
    .all();
}
```

- [ ] **Step 4: Run the repository test**

```bash
pnpm vitest run apps/server/src/domains/roster/repository.test.ts 2>&1 | tail -20
```

Expected: all tests pass, including the two new ones.

- [ ] **Step 5: Replace stub in `getPersonaRuns` in service**

In `apps/server/src/domains/roster/service.ts`:

Update the import to include `AgentRunRow` and `listRunsByPersona`:

```ts
import type { AgentRunRow, ImprovementCandidateRow, PersonaNameRow, PersonaStat } from './repository.js';
import {
  getCandidateById,
  listCandidatesByPersona,
  listPersonaNames,
  listPersonaStats,
  listRunsByPersona,
  updateCandidateGithubIssue,
  updateCandidateStatus,
} from './repository.js';
```

Update `PersonaRunDto` so `qualityScore` accepts `null`:

```ts
export interface PersonaRunDto {
  runId: string;
  workItemId: string | null;
  outcome: string;
  qualityScore: number | null;
  createdAt: string;
}
```

Replace the stub:

```ts
export async function getPersonaRuns(
  personaName: string,
): Promise<Result<{ runs: PersonaRunDto[] }>> {
  const rows = listRunsByPersona(personaName);
  const runs: PersonaRunDto[] = rows.map((r: AgentRunRow) => ({
    runId: r.runId,
    workItemId: r.workItemId,
    outcome: r.outcome,
    qualityScore: null,
    createdAt: r.createdAt,
  }));
  return { ok: true, data: { runs } };
}
```

- [ ] **Step 6: Run all roster tests**

```bash
pnpm vitest run apps/server/src/domains/roster/ 2>&1 | tail -30
```

Expected: all pass.

- [ ] **Step 7: Run full typecheck**

```bash
cd /Users/shaunnesbitt/projects/goose-hub
pnpm tsc -p apps/server/tsconfig.json --noEmit 2>&1 | head -30
pnpm tsc -p core/tsconfig.json --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/domains/roster/repository.ts apps/server/src/domains/roster/repository.test.ts apps/server/src/domains/roster/service.ts
git commit -m "feat(roster): implement listRunsByPersona read path, replace getPersonaRuns stub"
```

---

## Task 8: Full test suite + typecheck

- [ ] **Step 1: Run all tests**

```bash
pnpm vitest run 2>&1 | tail -40
```

Expected: all pass.

- [ ] **Step 2: Full typecheck both apps**

```bash
pnpm tsc -p apps/server/tsconfig.json --noEmit 2>&1 | head -20
pnpm tsc -p apps/web/tsconfig.json --noEmit 2>&1 | head -20
pnpm tsc -p core/tsconfig.json --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Lint**

```bash
pnpm biome check . 2>&1 | tail -20
```

Expected: no errors (or only pre-existing warnings).

---

## Self-review

Spec coverage check:

| Spec requirement | Task |
|---|---|
| `sourcePersonaId` in `ImprovementCandidateSchema` | Task 1 |
| `persistCandidates` uses `sourcePersonaId ?? provenance.personaId` | Task 2 |
| `activePersonas` in `contextAllowlist` for retro-light | Task 3 |
| retro-light prompt Step 3 attribution instructions | Task 3 |
| retro-deep prompt Step 6 attribution instructions | Task 4 |
| `agentRuns` DB table + migration | Task 5 |
| `workItemId?: string` on `AgentSpec` | Task 6 |
| `ClaudeCliRuntime.run()` inserts row on success + failure | Task 6 |
| `listRunsByPersona` in repository | Task 7 |
| `getPersonaRuns` stub replaced | Task 7 |
| `qualityScore: number \| null` in `PersonaRunDto` | Task 7 |
| Unit: `persistCandidates` attribution | Task 1+2 |
| Unit: `listRunsByPersona` ordering + limit | Task 7 |
| Integration: runtime writes row on success + failure | Task 6 |
