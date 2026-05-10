# Roster: run history + improvement candidate attribution

## Context

Two sections on the Roster page (`/projects/:slug/roster`) are always empty:

1. **Run History** — `getPersonaRuns()` in `apps/server/src/domains/roster/service.ts:45` is a stub returning `[]`. No table, no write path.
2. **Improvement Candidates** — wired correctly end-to-end, BUT candidates are stored under the *retrospector* persona ID instead of the agent persona whose work triggered the candidate. Clicking a developer or QA persona card always shows zero candidates.

---

## Fix 1 — Improvement candidate attribution

### Problem

`persistCandidates()` in `core/workflows/retrospective.ts:47` always uses:
```ts
personaName: provenance.personaId  // retrospector persona
```

Candidates should be stored under the persona whose work the candidate targets (e.g., a `skill-prompt` candidate about the developer skill → developer persona).

The retrospective workflow already computes `activePersonas` (all personas that ran on the work item) from the event store. The retro agent just doesn't use it to attribute candidates.

### Changes

**`core/retrospective/schemas.ts`**
- Add `sourcePersonaId: z.string().optional()` to `ImprovementCandidateSchema`

**`core/workflows/retrospective.ts`**
- Update `persistCandidates()` to use `c.sourcePersonaId ?? provenance.personaId`

**`skills/retrospective-light/skill.config.ts`**
- Add `'activePersonas'` to `contextAllowlist` (currently absent; the prompt references it but it's blocked from context)

**`skills/retrospective-light/prompt.md`**
- In Step 3, instruct: for each candidate, set `sourcePersonaId` to the persona from `<active_personas>` whose role best matches the candidate's `kind`. Role mapping:
  - `skill-prompt`, `skill-schema`, `skill-config` → role derived from `targetPath` (e.g., `skills/developer/` → developer persona)
  - `workflow` → developer persona (workflow issues usually surface from implementation)
  - `project-config` → developer persona
  - `persona` → the specific persona being described
  - When ambiguous, omit — orchestrator falls back to retrospector ID

**`skills/retrospective-deep/prompt.md`**
- Same instruction in Step 6 (deep already has `activePersonas` in context via `<active_personas>` block)

### No migration needed

`improvementCandidates.personaName` column already exists. Just changes which value is written.

---

## Fix 2 — Run history (getPersonaRuns)

### Three parts: table, write path, read path

### Part A — New DB table

**`core/db/schema.ts`** — add:
```ts
export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: text('run_id').notNull().unique(),
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
    personaIdx: index('agent_runs_persona_idx').on(t.personaId),
    projectIdx: index('agent_runs_project_idx').on(t.projectId),
  }),
);
```

**Add a Drizzle migration** for the new table.

### Part B — Write path

**`core/agent-runtime/interface.ts`**
- Add `workItemId?: string` to `AgentSpec` (currently callers pass it inside `context` — promote it to a first-class field so the runtime can write it without casting)

**`core/agent-runtime/claude-cli.ts`** — at run end, insert one row in both the success return and the `catch` handler:
```ts
import { db } from '../db/db.js';
import { agentRuns } from '../db/schema.js';

// derive projectId: personaId format is "<projectId>/<role>/<index>"
const projectId = spec.personaId?.split('/')[0] ?? 'unknown';

db.insert(agentRuns).values({
  runId: spec.runId,
  personaId: spec.personaId ?? 'unknown',
  workItemId: spec.workItemId ?? null,
  projectId,
  role: spec.role,
  skill: spec.skill,
  outcome: succeeded ? 'success' : 'failure',
}).run();
```

All workflow call sites already pass `workItemId` inside `context`. Update them to also set `spec.workItemId` from `workItem.id`.

### Part C — Read path

**`apps/server/src/domains/roster/repository.ts`** — add:
```ts
export function listRunsByPersona(personaId: string, limit = 50): AgentRunRow[] {
  return db.select().from(agentRuns)
    .where(eq(agentRuns.personaId, personaId))
    .orderBy(desc(agentRuns.createdAt))
    .limit(limit)
    .all();
}
```

**`apps/server/src/domains/roster/service.ts`** — replace stub in `getPersonaRuns()`:
```ts
export async function getPersonaRuns(personaName: string): Promise<Result<{ runs: PersonaRunDto[] }>> {
  const rows = listRunsByPersona(personaName);
  const runs: PersonaRunDto[] = rows.map((r) => ({
    runId: r.runId,
    workItemId: r.workItemId,
    outcome: r.outcome,
    qualityScore: null,   // future: join with runQualityScores on runId
    createdAt: r.createdAt,
  }));
  return { ok: true, data: { runs } };
}
```

**`apps/server/src/lib/api.ts` and `PersonaRunDto`** — update `qualityScore` to `number | null` since it won't be populated until quality scoring is wired.

---

## Sequencing

1. **Fix 1 first** — no migration, just schema + prompt + one-line workflow change. Low risk.
2. **Fix 2** — requires migration. File as separate issue or second commit.

## Tests to write

- Unit: `persistCandidates` uses `sourcePersonaId` when present, falls back to provenance ID when absent
- Unit: `listRunsByPersona` returns rows ordered by `createdAt` desc
- Integration: `ClaudeCliRuntime.run` (mocked) writes one `agentRuns` row on success and on failure
- Roster router test: `GET /api/roster/runs?persona=x` returns mapped rows (add alongside existing `router.test.ts`)
