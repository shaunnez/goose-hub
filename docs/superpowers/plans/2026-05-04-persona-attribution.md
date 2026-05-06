# Persona Attribution & Goosey Spy Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assign persistent goosey spy codenames to persona slots, write personaId to every agent event, and surface "Grey Honker (DEV)" everywhere in the UI — timeline run headers, kanban initials chips, issue detail sidebar, and the Roster page.

**Architecture:** New `personaNames` DB table stores codenames keyed by `(projectId, role, slotIndex)`. A nullable `personaId` column is added to the `events` table. `selectPersona()` generates and stores a codename on first slot creation and now returns `{personaId, codename}`. All `appendEvent()` callers in the agent runtime thread the personaId through. The frontend resolves codenames via a `usePersonaMap()` hook built on top of the existing `fetchRoster()` API (which gains a `codename` field).

**Tech Stack:** Node + TypeScript, Drizzle ORM + SQLite, React + Vite, Vitest, pnpm

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `core/agent-runtime/persona-names.ts` | Codename list + generation function |
| Modify | `core/db/schema.ts` | Add `personaNames` table; add `personaId` to `events` |
| Modify | `core/agent-runtime/select-persona.ts` | Return `{personaId, codename}`, write to `personaNames` |
| Modify | `core/event-stream/store.ts` | Add `personaId` to `AppendEventInput`, `AgentEvent`, DB write/read |
| Modify | `core/agent-runtime/claude-cli.ts` | Pass `spec.personaId` to all `appendEvent` calls |
| Modify | `apps/server/src/domains/roster/repository.ts` | JOIN `personaNames`, expose `codename` on `PersonaStat` |
| Modify | `apps/server/src/domains/roster/service.ts` | Thread `codename` through `listPersonas` |
| Modify | `apps/server/src/domains/issues/service.ts` | Batch-compute `lastPersonaId` per work item |
| Modify | `apps/web/src/lib/types.ts` | Add `codename` to `PersonaStatDto`; `personaId` to `AgentEventDto`; `lastPersonaId` to `WorkItemDto` |
| Create | `apps/web/src/lib/usePersonaMap.ts` | `usePersonaMap()` hook: `Record<personaId, {codename, role}>` |
| Modify | `apps/web/src/components/detail/lib/timeline.ts` | Add `personaId` to run-group `RenderItem`, extract in `extractRunMeta` |
| Modify | `apps/web/src/components/detail/components/TimelineSection.tsx` | `RunGroupWrapper` shows persona inline |
| Modify | `apps/web/src/components/board/components/IssueCard.tsx` | Initials chip from `lastPersonaId` |
| Modify | `apps/web/src/components/detail/components/OverviewSection.tsx` | "Last agent" stat card |
| Modify | `apps/web/src/components/roster/components/RosterPage.tsx` | `PersonaCard` shows `codename` |
| Modify (10 files) | Various callers of `selectPersona()` | Destructure `{personaId}` from new return type |

---

## Task 1: Schema — `personaNames` table + `personaId` on events

**Files:**
- Modify: `core/db/schema.ts`
- Run: `pnpm db:migrate` (applies schema via drizzle-kit push)

- [ ] **Step 1: Write failing smoke test**

Add to `core/db/smoke.test.ts`:

```ts
it('personaNames table exists', () => {
  expect(() =>
    db.run(sql`INSERT INTO persona_names (project_id, role, slot_index, codename)
               VALUES ('proj', 'developer', 0, 'Grey Honker')`)
  ).not.toThrow();
});

it('events table has personaId column', () => {
  const row = db
    .select()
    .from(events)
    .limit(0)
    .all();
  // Compile-time check: accessing personaId on the schema won't throw
  expect(events.personaId).toBeDefined();
});
```

- [ ] **Step 2: Run smoke test — verify it fails**

```bash
pnpm --filter @goose-hub/core test core/db/smoke.test.ts
```

Expected: FAIL — `personaNames` table does not exist; `events.personaId` is undefined.

- [ ] **Step 3: Add schema definitions**

In `core/db/schema.ts`, add the `personaNames` table and `personaId` column to `events`:

```ts
// existing imports stay; add uniqueIndex if not already imported (already there)

export const personaNames = sqliteTable(
  'persona_names',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: text('project_id').notNull(),
    role: text('role').notNull(),
    slotIndex: integer('slot_index').notNull(),
    codename: text('codename').notNull(),
  },
  (t) => ({
    personaNameSlotUniq: uniqueIndex('persona_names_slot_uniq').on(
      t.projectId,
      t.role,
      t.slotIndex,
    ),
  }),
);
```

In the `events` table definition, add a `personaId` column (after `runId`):

```ts
export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: text('project_id').notNull(),
    workItemId: text('work_item_id'),
    kind: text('kind').notNull(),
    payload: text('payload').notNull(),
    runId: text('run_id'),
    personaId: text('persona_id'),   // ← new
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
  },
  (table) => ({
    projectCreatedIdx: index('events_project_created_idx').on(table.projectId, table.createdAt),
  }),
);
```

- [ ] **Step 4: Run migration**

```bash
pnpm db:migrate
```

Expected output: `[✓] Changes applied` (or equivalent drizzle-kit push success message).

- [ ] **Step 5: Run smoke test — verify it passes**

```bash
pnpm --filter @goose-hub/core test core/db/smoke.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add core/db/schema.ts core/db/smoke.test.ts
git commit -m "feat(db): add personaNames table and personaId column to events"
```

---

## Task 2: Codename generation module

**Files:**
- Create: `core/agent-runtime/persona-names.ts`
- Create: `core/agent-runtime/persona-names.test.ts`

- [ ] **Step 1: Write the failing test**

Create `core/agent-runtime/persona-names.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CODENAMES, generateCodename } from './persona-names.js';

describe('generateCodename', () => {
  it('returns first name for index 0', () => {
    expect(generateCodename(0)).toBe('Grey Honker');
  });

  it('returns 16th name for index 15', () => {
    expect(generateCodename(15)).toBe('Tundra Drift');
  });

  it('wraps around after 30 names', () => {
    expect(generateCodename(30)).toBe(generateCodename(0));
    expect(generateCodename(31)).toBe(generateCodename(1));
  });

  it('CODENAMES has exactly 30 entries', () => {
    expect(CODENAMES).toHaveLength(30);
  });

  it('all names are unique', () => {
    expect(new Set(CODENAMES).size).toBe(30);
  });
});

describe('getInitials', () => {
  it('returns first letter of each word', async () => {
    const { getInitials } = await import('./persona-names.js');
    expect(getInitials('Grey Honker')).toBe('GH');
    expect(getInitials('Tundra Drift')).toBe('TD');
    expect(getInitials('Iron Beak')).toBe('IB');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @goose-hub/core test core/agent-runtime/persona-names.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

Create `core/agent-runtime/persona-names.ts`:

```ts
export const CODENAMES: readonly string[] = [
  'Grey Honker',
  'Iron Beak',
  'Silent Wing',
  'Dark Feather',
  'Swift Migrant',
  'Bold Gosling',
  'Shadow Flock',
  'Crimson Plume',
  'Frost Gaggle',
  'Night Wader',
  'Copper Bill',
  'Ashen Glide',
  'Storm Preen',
  'Jade Gander',
  'Onyx Quill',
  'Tundra Drift',
  'Ember Waddle',
  'Cobalt Flap',
  'Phantom Crest',
  'Rogue Pinion',
  'Silver Down',
  'Marsh Glider',
  'Arctic Honk',
  'Dusk Preen',
  'Gilded Wing',
  'Sable Gosling',
  'Steel Migrate',
  'Amber Feather',
  'Mossy Beak',
  'Velvet Flock',
];

export const ROLE_ABBREV: Record<string, string> = {
  triager: 'TRG',
  developer: 'DEV',
  qa: 'QA',
  reviewer: 'REV',
  investigator: 'INV',
  decomposer: 'DEC',
  'prd-writer': 'PRD',
  researcher: 'RSR',
  retrospector: 'RET',
  griller: 'GRL',
};

export function generateCodename(totalSlots: number): string {
  return CODENAMES[totalSlots % CODENAMES.length];
}

export function getInitials(codename: string): string {
  return codename
    .split(' ')
    .map((w) => w[0])
    .join('');
}

export function formatPersonaLabel(codename: string, role: string): string {
  const abbrev = ROLE_ABBREV[role] ?? role.toUpperCase().slice(0, 3);
  return `${codename} (${abbrev})`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @goose-hub/core test core/agent-runtime/persona-names.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/agent-runtime/persona-names.ts core/agent-runtime/persona-names.test.ts
git commit -m "feat(core): codename generation module with 30 goosey spy names"
```

---

## Task 3: `selectPersona()` — return `{personaId, codename}`, assign name on first slot creation

**Files:**
- Modify: `core/agent-runtime/select-persona.ts`
- Modify: `core/agent-runtime/select-persona.test.ts` (create if not present)

- [ ] **Step 1: Write the failing tests**

Check if a test file exists:
```bash
ls core/agent-runtime/select-persona.test.ts 2>/dev/null || echo "missing"
```

Create/replace `core/agent-runtime/select-persona.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db.js';
import { personaNames, personaRouting } from '../db/schema.js';
import { selectPersona } from './select-persona.js';

beforeEach(() => {
  db.delete(personaRouting).run();
  db.delete(personaNames).run();
});

describe('selectPersona', () => {
  it('returns object with personaId and codename', () => {
    const result = selectPersona('proj', 'developer');
    expect(result).toHaveProperty('personaId');
    expect(result).toHaveProperty('codename');
    expect(typeof result.personaId).toBe('string');
    expect(typeof result.codename).toBe('string');
  });

  it('personaId format is projectId/role/index', () => {
    const { personaId } = selectPersona('my-proj', 'developer');
    expect(personaId).toMatch(/^my-proj\/developer\/\d+$/);
  });

  it('creates a personaNames entry on first call for a slot', () => {
    selectPersona('proj', 'qa');
    const rows = db.select().from(personaNames)
      .where(eq(personaNames.projectId, 'proj'))
      .all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].codename).toBeTruthy();
  });

  it('returns the same codename on repeated calls for the same slot', () => {
    const first = selectPersona('proj', 'developer');
    // Round-robin advances, so to get same slot again call PERSONAS_PER_ROLE times
    selectPersona('proj', 'developer');
    selectPersona('proj', 'developer');
    const fourth = selectPersona('proj', 'developer');
    // slot 0 again (3 personas per role, 0-indexed)
    expect(fourth.codename).toBe(first.codename);
    expect(fourth.personaId).toBe(first.personaId);
  });

  it('different slots get different codenames', () => {
    const a = selectPersona('proj', 'developer');
    const b = selectPersona('proj', 'developer');
    const c = selectPersona('proj', 'developer');
    expect(new Set([a.codename, b.codename, c.codename]).size).toBe(3);
  });
});
```

Add import at top of test file:
```ts
import { eq } from 'drizzle-orm';
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm --filter @goose-hub/core test core/agent-runtime/select-persona.test.ts
```

Expected: FAIL — `selectPersona` returns a string, not `{personaId, codename}`.

- [ ] **Step 3: Rewrite `select-persona.ts`**

Replace the full file content of `core/agent-runtime/select-persona.ts`:

```ts
import { and, count, eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { personaNames, personaRouting } from '../db/schema.js';
import { generateCodename } from './persona-names.js';

const PERSONAS_PER_ROLE = 3;

export interface PersonaSelection {
  personaId: string;
  codename: string;
}

/**
 * Round-robin persona selector. Returns a stable persona identifier and codename
 * for the given (projectId, role) pair, incrementing the round-robin index in
 * SQLite on each call.
 *
 * Persona ID format: "<projectId>/<role>/<index>" — e.g. "goose-hub-self/investigator/0"
 * Codename: assigned once per slot from the goosey spy name list.
 */
export function selectPersona(projectId: string, role: string): PersonaSelection {
  const existing = db
    .select()
    .from(personaRouting)
    .where(and(eq(personaRouting.projectId, projectId), eq(personaRouting.role, role)))
    .all();

  let currentIndex: number;

  if (existing.length === 0) {
    db.insert(personaRouting).values({ projectId, role, lastIndex: 0 }).run();
    currentIndex = 0;
  } else {
    currentIndex = existing[0].lastIndex;
  }

  const slotIndex = currentIndex % PERSONAS_PER_ROLE;
  const personaId = `${projectId}/${role}/${slotIndex}`;

  // Advance the index for the next caller
  const nextIndex = (currentIndex + 1) % PERSONAS_PER_ROLE;
  db.update(personaRouting)
    .set({ lastIndex: nextIndex })
    .where(and(eq(personaRouting.projectId, projectId), eq(personaRouting.role, role)))
    .run();

  // Assign codename on first creation of this slot
  const existingName = db
    .select()
    .from(personaNames)
    .where(
      and(
        eq(personaNames.projectId, projectId),
        eq(personaNames.role, role),
        eq(personaNames.slotIndex, slotIndex),
      ),
    )
    .all();

  let codename: string;
  if (existingName.length === 0) {
    const [{ totalSlots }] = db.select({ totalSlots: count() }).from(personaNames).all();
    codename = generateCodename(totalSlots);
    db.insert(personaNames).values({ projectId, role, slotIndex, codename }).run();
  } else {
    codename = existingName[0].codename;
  }

  return { personaId, codename };
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm --filter @goose-hub/core test core/agent-runtime/select-persona.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @goose-hub/core typecheck
```

Expected: errors for all callers that still treat the return value as a string — this is expected and guides Task 4.

- [ ] **Step 6: Commit**

```bash
git add core/agent-runtime/select-persona.ts core/agent-runtime/select-persona.test.ts
git commit -m "feat(core): selectPersona returns {personaId, codename}, assigns goosey spy name on first slot creation"
```

---

## Task 4: Update all `selectPersona()` call sites

TypeScript errors from Task 3 typecheck guide exactly which lines to fix. Ten call sites across seven files.

**Files:**
- Modify: `core/workflows/retrospective.ts:82`
- Modify: `core/agent-runtime/advisor.ts:53`
- Modify: `slices/investigate/workflow.ts:45,87`
- Modify: `slices/review/workflow.ts:44`
- Modify: `slices/fix-issue/workflow.ts:95,482`
- Modify: `slices/qa/workflow.ts:57`
- Modify: `apps/server/src/domains/workflows/triage-batch.ts:82,143`

- [ ] **Step 1: Fix each call site**

For lines that do `const personaId = selectPersona(...)`:
```ts
// Before:
const personaId = selectPersona(projectId, 'developer');

// After:
const { personaId } = selectPersona(projectId, 'developer');
```

For lines that do `const xyzPersonaId = selectPersona(...)`:
```ts
// Before:
const triagerPersonaId = selectPersona(projectId, 'triager');
const researcherPersonaId = selectPersona(projectId, 'researcher');
const implementPersonaId = selectPersona(projectId, 'developer');
const playwrightPersonaId = selectPersona(projectId, 'investigator');

// After:
const { personaId: triagerPersonaId } = selectPersona(projectId, 'triager');
const { personaId: researcherPersonaId } = selectPersona(projectId, 'researcher');
const { personaId: implementPersonaId } = selectPersona(projectId, 'developer');
const { personaId: playwrightPersonaId } = selectPersona(projectId, 'investigator');
```

For `slices/fix-issue/workflow.ts:482` which is inline:
```ts
// Before:
personaId: selectPersona(input.projectId, 'developer'),

// After:
personaId: selectPersona(input.projectId, 'developer').personaId,
```

- [ ] **Step 2: Typecheck passes**

```bash
pnpm typecheck
```

Expected: no errors related to `selectPersona` return type.

- [ ] **Step 3: Tests pass**

```bash
pnpm test
```

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add core/workflows/retrospective.ts core/agent-runtime/advisor.ts \
  slices/investigate/workflow.ts slices/review/workflow.ts \
  slices/fix-issue/workflow.ts slices/qa/workflow.ts \
  apps/server/src/domains/workflows/triage-batch.ts
git commit -m "feat(core): update all selectPersona call sites to destructure {personaId}"
```

---

## Task 5: Event store — add `personaId` to types, write to DB, read back

**Files:**
- Modify: `core/event-stream/store.ts`
- Modify: `core/event-stream/store.test.ts` (create if not present)

- [ ] **Step 1: Write the failing tests**

Create/extend `core/event-stream/store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db.js';
import { events } from '../db/schema.js';
import { eventStore } from './store.js';

beforeEach(() => {
  db.delete(events).run();
});

describe('appendEvent with personaId', () => {
  it('stores personaId when provided', () => {
    const ev = eventStore.appendEvent({
      projectId: 'proj',
      kind: 'agent.run-started',
      payload: {},
      personaId: 'proj/developer/0',
    });
    expect(ev.personaId).toBe('proj/developer/0');
  });

  it('personaId is null when not provided', () => {
    const ev = eventStore.appendEvent({
      projectId: 'proj',
      kind: 'system.note',
      payload: {},
    });
    expect(ev.personaId).toBeNull();
  });

  it('replay returns personaId', () => {
    eventStore.appendEvent({
      projectId: 'proj',
      kind: 'agent.run-started',
      payload: {},
      runId: 'run-1',
      personaId: 'proj/developer/1',
    });
    const rows = eventStore.replay({ projectId: 'proj' });
    expect(rows[0].personaId).toBe('proj/developer/1');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm --filter @goose-hub/core test core/event-stream/store.test.ts
```

Expected: FAIL — `personaId` property does not exist on `AppendEventInput` or `AgentEvent`.

- [ ] **Step 3: Update `store.ts`**

In `core/event-stream/store.ts`, make the following changes:

**`AgentEvent` interface** — add `personaId`:
```ts
export interface AgentEvent {
  id: number;
  projectId: string;
  workItemId: string | null;
  kind: EventKind;
  payload: unknown;
  runId?: string | null;
  personaId?: string | null;   // ← new
  createdAt: string;
}
```

**`AppendEventInput` interface** — add `personaId`:
```ts
export interface AppendEventInput {
  projectId: string;
  workItemId?: string | null;
  kind: EventKind;
  payload: unknown;
  runId?: string | null;
  personaId?: string | null;   // ← new
}
```

**`appendEvent` method** — include `personaId` in DB insert and returned object:
```ts
appendEvent(input: AppendEventInput): AgentEvent {
  const redacted = redactSecrets(input.payload);
  const payload = JSON.stringify(redacted ?? {});
  const inserted = db
    .insert(events)
    .values({
      projectId: input.projectId,
      workItemId: input.workItemId ?? null,
      kind: input.kind,
      payload,
      runId: input.runId ?? null,
      personaId: input.personaId ?? null,   // ← new
    })
    .returning()
    .all();

  const row = inserted[0];
  const event: AgentEvent = {
    id: row.id,
    projectId: row.projectId,
    workItemId: row.workItemId,
    kind: row.kind as EventKind,
    payload: JSON.parse(row.payload),
    runId: row.runId,
    personaId: row.personaId,   // ← new
    createdAt: row.createdAt,
  };

  this.emitter.emit('event', event);
  return event;
}
```

**`replay` method** — include `personaId` in mapped rows:
```ts
return rows.map((r) => ({
  id: r.id,
  projectId: r.projectId,
  workItemId: r.workItemId,
  kind: r.kind as EventKind,
  payload: JSON.parse(r.payload),
  runId: r.runId,
  personaId: r.personaId,   // ← new
  createdAt: r.createdAt,
}));
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm --filter @goose-hub/core test core/event-stream/store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/event-stream/store.ts core/event-stream/store.test.ts
git commit -m "feat(core): thread personaId through AppendEventInput, AgentEvent, and event store"
```

---

## Task 6: `claude-cli.ts` — pass `spec.personaId` to all `appendEvent` calls

**Files:**
- Modify: `core/agent-runtime/claude-cli.ts`

There are 6 `appendEvent` calls in `claude-cli.ts`. All need `personaId: spec.personaId`.

- [ ] **Step 1: Update each `appendEvent` call**

At line 102 (`agent.run-started`):
```ts
eventStore.appendEvent({
  projectId: (spec.context.projectId as string) ?? 'unknown',
  workItemId: (spec.context.workItemId as string) ?? null,
  kind: 'agent.run-started',
  payload: { skill: spec.skill, runId },
  runId,
  personaId: spec.personaId,   // ← new
});
```

At the `tool.stdout-truncated` call (around line 205):
```ts
eventStore.appendEvent({
  projectId,
  workItemId,
  kind: 'tool.stdout-truncated',
  payload: { runId },
  runId,
  personaId: spec.personaId,   // ← new
});
```

At the `tool.timeout` call (around line 221):
```ts
eventStore.appendEvent({
  projectId,
  workItemId,
  kind: 'tool.timeout',
  payload: { runId },
  runId,
  personaId: spec.personaId,   // ← new
});
```

At the first `agent.run-failed` call (around line 246):
```ts
eventStore.appendEvent({
  projectId,
  workItemId,
  kind: 'agent.run-failed',
  payload: { runId, exitCode: code },
  runId,
  personaId: spec.personaId,   // ← new
});
```

At the second `agent.run-failed` call (around line 259):
```ts
eventStore.appendEvent({
  projectId,
  workItemId,
  kind: 'agent.run-failed',
  payload: { runId, exitCode: code },
  runId,
  personaId: spec.personaId,   // ← new
});
```

At the `agent.run-completed` call (around line 277):
```ts
eventStore.appendEvent({
  projectId,
  workItemId,
  kind: 'agent.run-completed',
  payload: { runId, skill: spec.skill },
  runId,
  personaId: spec.personaId,   // ← new
});
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Tests pass**

```bash
pnpm test
```

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add core/agent-runtime/claude-cli.ts
git commit -m "feat(core): pass spec.personaId to all appendEvent calls in claude-cli"
```

---

## Task 7: Roster repository + service — add codename to `PersonaStat` / `PersonaStatDto`

**Files:**
- Modify: `apps/server/src/domains/roster/repository.ts`
- Modify: `apps/server/src/domains/roster/service.ts`
- Modify: `apps/web/src/lib/types.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/domains/roster/repository.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@goose-hub/core/db/db.js';
import { personaNames, personaStats } from '@goose-hub/core/db/schema.js';
import { listPersonaStats } from './repository.js';

beforeEach(() => {
  db.delete(personaStats).run();
  db.delete(personaNames).run();
});

describe('listPersonaStats', () => {
  it('includes codename when a personaNames entry exists', async () => {
    db.insert(personaNames)
      .values({ projectId: 'proj', role: 'developer', slotIndex: 0, codename: 'Grey Honker' })
      .run();
    db.insert(personaStats)
      .values({
        personaName: 'proj/developer/0',
        role: 'developer',
        runsTotal: 1,
        runsSucceeded: 1,
        runsFailed: 0,
        avgQualityScore: 1.0,
        lastRunAt: new Date().toISOString(),
      })
      .run();

    const rows = await listPersonaStats();
    expect(rows[0].codename).toBe('Grey Honker');
  });

  it('codename is null when no personaNames entry', async () => {
    db.insert(personaStats)
      .values({
        personaName: 'proj/developer/0',
        role: 'developer',
        runsTotal: 0,
        runsSucceeded: 0,
        runsFailed: 0,
        avgQualityScore: 1.0,
        lastRunAt: new Date().toISOString(),
      })
      .run();

    const rows = await listPersonaStats();
    expect(rows[0].codename).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm --filter @goose-hub/server test apps/server/src/domains/roster/repository.test.ts
```

Expected: FAIL — `codename` property does not exist.

- [ ] **Step 3: Update `repository.ts`**

The `personaName` field in `personaStats` uses the format `projectId/role/slotIndex`. Parse it to join with `personaNames`.

Replace `listPersonaStats` in `apps/server/src/domains/roster/repository.ts`:

```ts
import { db } from '@goose-hub/core/db/db.js';
import { improvementCandidates, personaNames, personaStats } from '@goose-hub/core/db/schema.js';
import { and, asc, eq } from 'drizzle-orm';

export interface PersonaStat {
  id: number;
  personaName: string;
  role: string;
  runsTotal: number;
  runsSucceeded: number;
  runsFailed: number;
  avgQualityScore: number;
  lastRunAt: string;
  codename: string | null;
}
```

Replace the `listPersonaStats` function body:

```ts
export async function listPersonaStats(): Promise<PersonaStat[]> {
  const stats = await db
    .select()
    .from(personaStats)
    .orderBy(asc(personaStats.role), asc(personaStats.personaName));

  const names = await db.select().from(personaNames).all();
  const nameMap = new Map(
    names.map((n) => [`${n.projectId}/${n.role}/${n.slotIndex}`, n.codename]),
  );

  return stats.map((s) => ({
    ...s,
    codename: nameMap.get(s.personaName) ?? null,
  }));
}
```

- [ ] **Step 4: Update `apps/web/src/lib/types.ts` — add `codename` to `PersonaStatDto`**

```ts
export interface PersonaStatDto {
  id: number;
  personaName: string;
  role: string;
  runsTotal: number;
  runsSucceeded: number;
  runsFailed: number;
  avgQualityScore: number;
  lastRunAt: string;
  codename: string | null;   // ← new
}
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
pnpm --filter @goose-hub/server test apps/server/src/domains/roster/repository.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/domains/roster/repository.ts \
        apps/server/src/domains/roster/repository.test.ts \
        apps/web/src/lib/types.ts
git commit -m "feat(roster): add codename to PersonaStat via join with personaNames"
```

---

## Task 8: Issues service — batch-compute `lastPersonaId` per work item

**Files:**
- Modify: `apps/server/src/domains/issues/service.ts`
- Modify: `apps/web/src/lib/types.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/server/src/domains/issues/service.test.ts` (or create a focused test file `apps/server/src/domains/issues/last-persona.test.ts`):

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@goose-hub/core/db/db.js';
import { events } from '@goose-hub/core/db/schema.js';
import { getLastPersonaIdsByWorkItem } from './service.js';

beforeEach(() => {
  db.delete(events).run();
});

describe('getLastPersonaIdsByWorkItem', () => {
  it('returns latest personaId per workItemId', () => {
    db.insert(events).values([
      {
        projectId: 'proj',
        workItemId: 'github:repo#1',
        kind: 'agent.run-started',
        payload: '{}',
        personaId: 'proj/developer/0',
        createdAt: '2024-01-01T10:00:00Z',
      },
      {
        projectId: 'proj',
        workItemId: 'github:repo#1',
        kind: 'agent.run-started',
        payload: '{}',
        personaId: 'proj/developer/1',
        createdAt: '2024-01-01T11:00:00Z',
      },
      {
        projectId: 'proj',
        workItemId: 'github:repo#2',
        kind: 'agent.run-started',
        payload: '{}',
        personaId: 'proj/qa/0',
        createdAt: '2024-01-01T09:00:00Z',
      },
    ]).run();

    const result = getLastPersonaIdsByWorkItem('proj');
    expect(result.get('github:repo#1')).toBe('proj/developer/1');
    expect(result.get('github:repo#2')).toBe('proj/qa/0');
  });

  it('returns empty map when no run-started events', () => {
    const result = getLastPersonaIdsByWorkItem('proj');
    expect(result.size).toBe(0);
  });

  it('ignores events with null personaId', () => {
    db.insert(events).values({
      projectId: 'proj',
      workItemId: 'github:repo#1',
      kind: 'agent.run-started',
      payload: '{}',
      personaId: null,
    }).run();
    const result = getLastPersonaIdsByWorkItem('proj');
    expect(result.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm --filter @goose-hub/server test apps/server/src/domains/issues/last-persona.test.ts
```

Expected: FAIL — `getLastPersonaIdsByWorkItem` not exported.

- [ ] **Step 3: Add `getLastPersonaIdsByWorkItem` to `service.ts`**

Add the following function to `apps/server/src/domains/issues/service.ts`. Add `desc` to the drizzle-orm imports and `isNotNull` too:

```ts
import { type SQL, and, asc, desc, eq, gt, isNotNull } from 'drizzle-orm';
import { db } from '@goose-hub/core/db/db.js';
import { events } from '@goose-hub/core/db/schema.js';
```

Add the exported function:

```ts
export function getLastPersonaIdsByWorkItem(projectId: string): Map<string, string> {
  const rows = db
    .select({ workItemId: events.workItemId, personaId: events.personaId, id: events.id })
    .from(events)
    .where(
      and(
        eq(events.projectId, projectId),
        eq(events.kind, 'agent.run-started'),
        isNotNull(events.personaId),
        isNotNull(events.workItemId),
      ),
    )
    .orderBy(desc(events.id))
    .all();

  const result = new Map<string, string>();
  for (const row of rows) {
    if (row.workItemId != null && row.personaId != null && !result.has(row.workItemId)) {
      result.set(row.workItemId, row.personaId);
    }
  }
  return result;
}
```

- [ ] **Step 4: Update `listIssues` to attach `lastPersonaId`**

In `listIssues` in `apps/server/src/domains/issues/service.ts`, enrich items after source fetch:

```ts
export async function listIssues(slug: string): Promise<Result<{ items: unknown[] }>> {
  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const items = await getCached(CACHE_KEY.issues(slug), 60_000, () => source.listOpenWork());
  const repoRef = await getRepoRef(slug);
  const lastPersonaIds = getLastPersonaIdsByWorkItem(slug);
  const enriched = (items as Array<{ externalId: string } & Record<string, unknown>>).map(
    (item) => ({
      ...item,
      lastPersonaId: lastPersonaIds.get(`github:${repoRef}#${item.externalId}`) ?? null,
    }),
  );
  return { ok: true, data: { items: enriched } };
}
```

- [ ] **Step 5: Update `WorkItemDto` in `apps/web/src/lib/types.ts`**

```ts
export interface WorkItemDto {
  id: string;
  externalId: string;
  repoRef: string;
  title: string;
  body: string;
  type: string;
  priority: string;
  mode: string;
  state: string;
  authorIsOwner: boolean;
  milestoneId?: string;
  schedule: string;
  exec: string;
  dependsOn: string[];
  blocks: string[];
  createdAt: string;
  lastPersonaId?: string | null;   // ← new
}
```

- [ ] **Step 6: Update `AgentEventDto` in `apps/web/src/lib/types.ts`**

```ts
export interface AgentEventDto {
  id: number;
  projectId: string;
  workItemId: string | null;
  kind: string;
  payload: unknown;
  runId?: string | null;
  personaId?: string | null;   // ← new
  createdAt: string;
}
```

- [ ] **Step 7: Run tests and typecheck**

```bash
pnpm --filter @goose-hub/server test apps/server/src/domains/issues/last-persona.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/domains/issues/service.ts \
        apps/server/src/domains/issues/last-persona.test.ts \
        apps/web/src/lib/types.ts
git commit -m "feat(issues): batch-compute lastPersonaId per work item from agent.run-started events"
```

---

## Task 9: Frontend — `usePersonaMap` hook

**Files:**
- Create: `apps/web/src/lib/usePersonaMap.ts`
- Create: `apps/web/src/lib/usePersonaMap.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/usePersonaMap.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPersonaMap } from './usePersonaMap.js';

describe('buildPersonaMap', () => {
  it('builds a lookup keyed by personaName', () => {
    const map = buildPersonaMap([
      {
        id: 1,
        personaName: 'proj/developer/0',
        role: 'developer',
        codename: 'Grey Honker',
        runsTotal: 3,
        runsSucceeded: 3,
        runsFailed: 0,
        avgQualityScore: 1.0,
        lastRunAt: '2024-01-01T00:00:00Z',
      },
    ]);
    expect(map['proj/developer/0']).toEqual({ codename: 'Grey Honker', role: 'developer' });
  });

  it('skips entries without codename', () => {
    const map = buildPersonaMap([
      {
        id: 1,
        personaName: 'proj/qa/0',
        role: 'qa',
        codename: null,
        runsTotal: 0,
        runsSucceeded: 0,
        runsFailed: 0,
        avgQualityScore: 1.0,
        lastRunAt: '2024-01-01T00:00:00Z',
      },
    ]);
    expect(map['proj/qa/0']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm --filter @goose-hub/web test src/lib/usePersonaMap.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the hook module**

Create `apps/web/src/lib/usePersonaMap.ts`:

```ts
import { fetchRoster } from '@/lib/api';
import type { PersonaStatDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';

export interface PersonaEntry {
  codename: string;
  role: string;
}

export type PersonaMap = Record<string, PersonaEntry>;

export function buildPersonaMap(personas: PersonaStatDto[]): PersonaMap {
  const map: PersonaMap = {};
  for (const p of personas) {
    if (p.codename != null) {
      map[p.personaName] = { codename: p.codename, role: p.role };
    }
  }
  return map;
}

export function usePersonaMap(): PersonaMap {
  const { data: personas = [] } = useQuery<PersonaStatDto[]>({
    queryKey: ['roster'],
    queryFn: fetchRoster,
    staleTime: 60_000,
  });
  return buildPersonaMap(personas);
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm --filter @goose-hub/web test src/lib/usePersonaMap.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/usePersonaMap.ts apps/web/src/lib/usePersonaMap.test.ts
git commit -m "feat(web): usePersonaMap hook and buildPersonaMap helper"
```

---

## Task 10: Timeline — extract personaId and render in run group header

**Files:**
- Modify: `apps/web/src/components/detail/lib/timeline.ts`
- Modify: `apps/web/src/components/detail/components/TimelineSection.tsx`

The goal: run group headers change from `"Investigator Run · Live"` to `"Marsh Glider (INV) · Investigator Run · Live"`.

- [ ] **Step 1: Write failing test**

Extend `apps/web/src/components/detail/lib/timeline.test.ts` (create if not present):

```ts
import { describe, expect, it } from 'vitest';
import type { AgentEventDto } from '@/lib/types';
import { groupEvents } from './timeline.js';

function makeEvent(overrides: Partial<AgentEventDto>): AgentEventDto {
  return {
    id: Math.random(),
    projectId: 'proj',
    workItemId: 'github:repo#1',
    kind: 'agent.run-started',
    payload: {},
    runId: 'run-1',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('groupEvents — persona attribution', () => {
  it('run-group carries personaId from agent.run-started event', () => {
    const events: AgentEventDto[] = [
      makeEvent({
        kind: 'agent.run-started',
        personaId: 'proj/developer/0',
        runId: 'run-1',
      }),
      makeEvent({
        kind: 'agent.run-completed',
        personaId: 'proj/developer/0',
        runId: 'run-1',
      }),
    ];
    const items = groupEvents(events);
    const runGroup = items.find((i) => i.kind === 'run-group');
    expect(runGroup).toBeDefined();
    if (runGroup?.kind === 'run-group') {
      expect(runGroup.personaId).toBe('proj/developer/0');
    }
  });

  it('personaId is null when not set on events', () => {
    const events: AgentEventDto[] = [
      makeEvent({ kind: 'agent.run-started', runId: 'run-2' }),
      makeEvent({ kind: 'agent.run-completed', runId: 'run-2' }),
    ];
    const items = groupEvents(events);
    const runGroup = items.find((i) => i.kind === 'run-group');
    if (runGroup?.kind === 'run-group') {
      expect(runGroup.personaId).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm --filter @goose-hub/web test src/components/detail/lib/timeline.test.ts
```

Expected: FAIL — `personaId` not on run-group type.

- [ ] **Step 3: Update `timeline.ts`**

In `apps/web/src/components/detail/lib/timeline.ts`:

**Update `RenderItem` type** to add `personaId` to run-group:

```ts
export type RenderItem =
  | { kind: 'event'; event: AgentEventDto }
  | { kind: 'log-group'; events: AgentEventDto[] }
  | {
      kind: 'run-group';
      runId: string;
      items: RenderItem[];
      skill: string | null;
      startedAt: string | null;
      endedAt: string | null;
      personaId: string | null;   // ← new
    };
```

**Update `extractRunMeta`** to return `personaId`:

```ts
function extractRunMeta(items: RenderItem[]): {
  skill: string | null;
  startedAt: string | null;
  endedAt: string | null;
  personaId: string | null;
} {
  let skill: string | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let personaId: string | null = null;
  let earliestMs = Number.POSITIVE_INFINITY;
  let earliestIso: string | null = null;

  for (const item of items) {
    if (item.kind !== 'event') continue;
    const ev = item.event;
    const p = ev.payload as { skill?: string } | null;

    const ms = new Date(ev.createdAt).getTime();
    if (ms < earliestMs) {
      earliestMs = ms;
      earliestIso = ev.createdAt;
    }

    if (ev.kind === 'agent.run-started') {
      if (startedAt == null) startedAt = ev.createdAt;
      if (skill == null && p?.skill != null) skill = p.skill;
      if (personaId == null && ev.personaId != null) personaId = ev.personaId;   // ← new
    } else if (ev.kind === 'agent.spawned') {
      if (skill == null && p?.skill != null) skill = p.skill;
    } else if (ev.kind === 'agent.run-completed') {
      if (skill == null && p?.skill != null) skill = p.skill;
      if (endedAt == null) endedAt = ev.createdAt;
    } else if (ev.kind === 'agent.run-failed') {
      if (endedAt == null) endedAt = ev.createdAt;
    }
  }

  return { skill, startedAt: startedAt ?? earliestIso, endedAt, personaId };
}
```

**Update `groupByRunId`** — the `meta` spread already includes all returned fields, so just ensure the `personaId` field from `extractRunMeta` flows through. The existing spread `{ kind: 'run-group', runId, items: group, ...meta }` already propagates it.

- [ ] **Step 4: Update `TimelineSection.tsx` — `RunGroupWrapper`**

In `apps/web/src/components/detail/components/TimelineSection.tsx`:

**Add `PersonaMap` import** at the top:
```ts
import type { PersonaMap } from '@/lib/usePersonaMap';
import { formatPersonaLabel } from '@goose-hub/core/agent-runtime/persona-names.js';
```

Wait — `formatPersonaLabel` is in core, not accessible from web directly. Instead, inline the logic or duplicate it in the web lib. Since FACTORY_RULES says slices import from `core/` only through public interfaces and this is a display utility, replicate it in `usePersonaMap.ts`:

In `apps/web/src/lib/usePersonaMap.ts`, add:

```ts
const ROLE_ABBREV: Record<string, string> = {
  triager: 'TRG',
  developer: 'DEV',
  qa: 'QA',
  reviewer: 'REV',
  investigator: 'INV',
  decomposer: 'DEC',
  'prd-writer': 'PRD',
  researcher: 'RSR',
  retrospector: 'RET',
  griller: 'GRL',
};

export function formatPersonaLabel(codename: string, role: string): string {
  const abbrev = ROLE_ABBREV[role] ?? role.toUpperCase().slice(0, 3);
  return `${codename} (${abbrev})`;
}

export function getInitials(codename: string): string {
  return codename.split(' ').map((w) => w[0]).join('');
}
```

Back in `TimelineSection.tsx`, update `RunGroupWrapper` props and summary line:

**Update `RunGroupWrapper` signature** to accept `personaId` and `personaMap`:
```ts
function RunGroupWrapper({
  runId,
  items,
  idx,
  skill,
  startedAt,
  endedAt,
  personaId,
  personaMap,
}: {
  runId: string;
  items: RenderItem[];
  idx: number;
  skill: string | null;
  startedAt: string | null;
  endedAt: string | null;
  personaId: string | null;
  personaMap: PersonaMap;
}) {
```

Inside `RunGroupWrapper`, before the return statement, add:
```ts
const persona = personaId != null ? personaMap[personaId] : null;
const personaLabel =
  persona != null ? formatPersonaLabel(persona.codename, persona.role) : null;
```

Update the `summary` line inside `<details>`:
```tsx
<summary className="flex flex-wrap items-center gap-2 cursor-pointer list-none px-4 py-2 font-mono text-[11px] select-none">
  {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
  {personaLabel != null && (
    <span className="text-[color:var(--accent)] font-medium">{personaLabel}</span>
  )}
  {personaLabel != null && <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />}
  <span title={runId} className="cursor-help border-b border-dashed border-fg-5/40">
    {formatSkillName(skill)} Run
  </span>
  <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-fg-4" />
  {statusBadge}
  {metaLine}
  <span className="ml-auto text-fg-5">{items.length} events</span>
</summary>
```

**Update the `renderItem` call for run-groups** — pass personaMap down from the parent:

In `renderItem` function signature, add a third param:
```ts
function renderItem(item: RenderItem, idx: number, personaMap: PersonaMap = {}): React.ReactNode {
```

Update the run-group case in `renderItem`:
```ts
if (item.kind === 'run-group') {
  return (
    <RunGroupWrapper
      key={`run-group-${item.runId}`}
      runId={item.runId}
      items={item.items}
      idx={idx}
      skill={item.skill}
      startedAt={item.startedAt}
      endedAt={item.endedAt}
      personaId={item.personaId}
      personaMap={personaMap}
    />
  );
}
```

**Update `TimelineSection`** to load the persona map and pass it:

Add import at top of `TimelineSection.tsx`:
```ts
import { usePersonaMap } from '@/lib/usePersonaMap';
import type { PersonaMap } from '@/lib/usePersonaMap';
```

In the `TimelineSection` component function body, add:
```ts
const personaMap = usePersonaMap();
```

Update the render return at the bottom:
```tsx
const items = groupEvents(events);
return (
  <div data-testid="timeline-section" className="px-8 py-6">
    <ol className="flex flex-col gap-3">
      {items.map((item, idx) => renderItem(item, idx, personaMap))}
    </ol>
  </div>
);
```

- [ ] **Step 5: Run tests and typecheck**

```bash
pnpm --filter @goose-hub/web test src/components/detail/lib/timeline.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/detail/lib/timeline.ts \
        apps/web/src/components/detail/lib/timeline.test.ts \
        apps/web/src/components/detail/components/TimelineSection.tsx \
        apps/web/src/lib/usePersonaMap.ts
git commit -m "feat(web): show persona codename in timeline run group headers"
```

---

## Task 11: Kanban `IssueCard` — initials chip

**Files:**
- Modify: `apps/web/src/components/board/components/IssueCard.tsx`
- Modify: `apps/web/src/components/board/components/BoardColumn.tsx` (or wherever `IssueCard` is called — to pass `personaMap`)

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/components/board/components/IssueCard.test.tsx`:

```ts
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { IssueCard } from './IssueCard.js';

const baseItem = {
  id: '1',
  externalId: '42',
  repoRef: 'owner/repo',
  title: 'Fix the bug',
  body: '',
  type: 'bug',
  priority: 'high',
  mode: 'auto',
  state: 'factory:triaging',
  authorIsOwner: false,
  schedule: 'current',
  exec: 'auto',
  dependsOn: [],
  blocks: [],
  createdAt: new Date().toISOString(),
};

it('shows initials chip when lastPersonaId is set and in map', () => {
  const personaMap = {
    'proj/developer/0': { codename: 'Grey Honker', role: 'developer' },
  };
  render(
    <MemoryRouter>
      <IssueCard
        item={{ ...baseItem, lastPersonaId: 'proj/developer/0' }}
        projectSlug="proj"
        personaMap={personaMap}
      />
    </MemoryRouter>,
  );
  expect(screen.getByTitle('Grey Honker (DEV)')).toBeInTheDocument();
  expect(screen.getByText('GH')).toBeInTheDocument();
});

it('shows nothing when lastPersonaId is absent', () => {
  render(
    <MemoryRouter>
      <IssueCard item={baseItem} projectSlug="proj" personaMap={{}} />
    </MemoryRouter>,
  );
  expect(screen.queryByText(/GH/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pnpm --filter @goose-hub/web test src/components/board/components/IssueCard.test.tsx
```

Expected: FAIL — `personaMap` not a prop; initials chip not rendered.

- [ ] **Step 3: Update `IssueCard.tsx`**

Replace the full component in `apps/web/src/components/board/components/IssueCard.tsx`:

```tsx
import { Pill } from '@/components/ui/pill';
import { cn } from '@/lib/cn';
import { PRIORITY_COLOR, STATE_LABEL } from '@/lib/constants';
import type { PersonaMap } from '@/lib/usePersonaMap';
import { formatPersonaLabel, getInitials } from '@/lib/usePersonaMap';
import type { WorkItemDto } from '@/lib/types';
import { ageLabel } from '@/lib/utils';
import { Link } from 'react-router-dom';

export function IssueCard({
  item,
  projectSlug,
  personaMap = {},
}: {
  item: WorkItemDto;
  projectSlug: string;
  personaMap?: PersonaMap;
}) {
  const ageStr = ageLabel(item.createdAt);
  const persona =
    item.lastPersonaId != null ? (personaMap[item.lastPersonaId] ?? null) : null;
  const label = persona != null ? formatPersonaLabel(persona.codename, persona.role) : null;
  const initials = persona != null ? getInitials(persona.codename) : null;

  return (
    <Link
      to={`/projects/${projectSlug}/items/${item.externalId}`}
      data-testid="issue-card"
      data-issue-number={item.externalId}
      data-state={item.state}
      className={cn(
        'block rounded-md border border-line bg-bg-elev px-3 py-2.5',
        'hover:border-line-2 hover:bg-bg-hover transition-colors',
      )}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: PRIORITY_COLOR[item.priority] ?? 'var(--fg-3)' }}
        />
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-fg-3">
          #{item.externalId}
        </span>
        <span className="grow" />
        <span className="font-mono tnum text-[10.5px] text-fg-2">{ageStr}</span>
      </div>
      <div className="text-[12.5px] text-fg leading-snug font-medium mb-2">
        {item.title.length <= 55 ? item.title : `${item.title.slice(0, 54).trimEnd()}…`}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <Pill tone="default" className="h-5 text-[10.5px] px-2">
          {STATE_LABEL[item.state] ?? item.state}
        </Pill>
        <Pill tone="default" className="h-5 text-[10.5px] px-2 capitalize">
          {item.type}
        </Pill>
        <Pill tone="default" className="h-5 text-[10.5px] px-2 capitalize">
          {item.priority}
        </Pill>
        {initials != null && label != null ? (
          <span
            title={label}
            className="ml-auto inline-flex items-center justify-center w-6 h-5 rounded text-[10px] font-mono font-semibold bg-[color:var(--accent)]/10 text-[color:var(--accent)] border border-[color:var(--accent)]/20 cursor-default"
          >
            {initials}
          </span>
        ) : (
          <span
            className="ml-auto font-mono text-[10.5px] text-fg-2"
            title="No agent run yet"
            data-testid="cost-placeholder"
          >
            $—
          </span>
        )}
      </div>
    </Link>
  );
}
```

- [ ] **Step 4: Update `BoardColumn.tsx` or `BoardPage.tsx` to pass `personaMap`**

Find where `IssueCard` is rendered (in `BoardColumn.tsx`):

```bash
grep -n "IssueCard" apps/web/src/components/board/components/BoardColumn.tsx
```

Add `usePersonaMap` to the board page/column and thread `personaMap` down. In `BoardColumn.tsx`:

```ts
import { usePersonaMap } from '@/lib/usePersonaMap';
```

Inside the component that renders `IssueCard`:
```tsx
const personaMap = usePersonaMap();
// ...
<IssueCard item={item} projectSlug={projectSlug} personaMap={personaMap} />
```

(If `usePersonaMap` is already called in a parent, thread it as a prop instead of calling it twice. `useQuery` with `staleTime: 60_000` deduplicates the fetch via React Query's cache, so calling it in multiple components is safe.)

- [ ] **Step 5: Run tests and typecheck**

```bash
pnpm --filter @goose-hub/web test src/components/board/components/IssueCard.test.tsx
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/board/components/IssueCard.tsx \
        apps/web/src/components/board/components/IssueCard.test.tsx \
        apps/web/src/components/board/components/BoardColumn.tsx
git commit -m "feat(web): persona initials chip on kanban cards"
```

---

## Task 12: `OverviewSection` "Last agent" row + `RosterPage` codename display

**Files:**
- Modify: `apps/web/src/components/detail/components/OverviewSection.tsx`
- Modify: `apps/web/src/components/roster/components/RosterPage.tsx`

- [ ] **Step 1: Update `OverviewSection.tsx` — "Last agent" stat card**

In `OverviewSection.tsx`, add `usePersonaMap` import:

```ts
import { usePersonaMap, formatPersonaLabel } from '@/lib/usePersonaMap';
```

Inside the `OverviewSection` component, add:
```ts
const personaMap = usePersonaMap();
const lastPersona =
  item?.lastPersonaId != null ? (personaMap[item.lastPersonaId] ?? null) : null;
const lastAgentLabel =
  lastPersona != null
    ? formatPersonaLabel(lastPersona.codename, lastPersona.role)
    : '—';
```

Find where the existing `StatCard` components are rendered. Add a "Last agent" card alongside them:

```tsx
<StatCard
  label="Last agent"
  value={lastAgentLabel}
/>
```

Place it after the existing stat cards (cost, state, etc.). If `StatCard` doesn't currently exist in this component, look at the component's structure and add a simpler inline row instead:

```tsx
<div className="rounded-lg border border-line bg-bg-elev px-4 py-3">
  <div className="text-[10.5px] uppercase tracking-wider text-fg-2 mb-1.5">Last agent</div>
  <div className="text-[13px] font-medium text-fg">{lastAgentLabel}</div>
</div>
```

- [ ] **Step 2: Update `RosterPage.tsx` — show codename instead of raw personaName**

In `PersonaCard` component inside `RosterPage.tsx`, change the display from `persona.personaName` to `persona.codename ?? persona.personaName`:

```tsx
<span className="text-[12.5px] font-medium text-fg truncate">
  {persona.codename ?? persona.personaName}
</span>
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Run full test suite**

```bash
pnpm test
pnpm build
```

Expected: all tests pass, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/detail/components/OverviewSection.tsx \
        apps/web/src/components/roster/components/RosterPage.tsx
git commit -m "feat(web): last agent in overview sidebar, codename on roster page"
```

---

## Self-Review Checklist

**Spec coverage:**

| Spec requirement | Task |
|-----------------|------|
| `personaNames` table | Task 1 |
| `personaId` on events | Task 1, 5, 6 |
| Goosey spy codenames (30 names, persistent) | Task 2, 3 |
| `selectPersona()` return type change | Task 3, 4 |
| Roster API returns codename | Task 7 |
| `lastPersonaId` on `WorkItemDto` | Task 8 |
| `usePersonaMap` hook | Task 9 |
| Timeline run header with persona label | Task 10 |
| Kanban initials chip | Task 11 |
| Issue detail "Last agent" | Task 12 |
| Roster page codename | Task 12 |

All spec requirements covered.

**Type consistency check:**
- `PersonaSelection` interface defined in Task 3, destructured in Task 4 — consistent
- `personaId` added to `AppendEventInput` in Task 5, used in Task 6 — consistent
- `codename: string | null` on `PersonaStat` / `PersonaStatDto` — consistent across Tasks 7, 9
- `lastPersonaId?: string | null` on `WorkItemDto` — defined Task 8, consumed Tasks 11, 12 — consistent
- `personaId: string | null` on run-group `RenderItem` — defined Task 10, consumed Task 10 — consistent
- `PersonaMap`, `formatPersonaLabel`, `getInitials` all defined in `usePersonaMap.ts` Task 9, consumed Tasks 10, 11, 12 — consistent
