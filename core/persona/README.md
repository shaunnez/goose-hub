# core/persona

Persona stats accumulation. Updates `persona_stats` after every agent run.

## Schema

`persona_stats` table (defined in `core/db/schema.ts`):

| Column | Type | Description |
|---|---|---|
| `id` | `INTEGER PK` | Auto-increment |
| `persona_name` | `TEXT NOT NULL` | Persona identifier (e.g. `alice`) |
| `role` | `TEXT NOT NULL` | Agent role (e.g. `developer`, `qa`) |
| `runs_total` | `INTEGER` | Total runs across all outcomes |
| `runs_succeeded` | `INTEGER` | Runs with `outcome: 'success'` |
| `runs_failed` | `INTEGER` | Runs with `outcome: 'failure'` or `'partial'` |
| `avg_quality_score` | `REAL` | Running average of quality scores (0.0–1.0) |
| `last_run_at` | `TEXT` | ISO timestamp of the last run |

Unique index on `(persona_name, role)`.

## Accumulation

`accumulatePersonaStats(input)` — called at the end of every agent run.

**Input:**
```ts
{
  personaName: string;
  role: string;
  outcome: 'success' | 'failure' | 'partial';
  qualityScore?: number; // from retrospective output; estimated if absent
}
```

**Quality score estimation (when retrospective has not run yet):**
- `success` → `1.0`
- `partial` → `0.5`
- `failure` → `0.0`

**Running average:** `newAvg = (oldAvg × oldTotal + newScore) / newTotal`

## When to call

Call `accumulatePersonaStats` at the end of every agent workflow step that produces an outcome. The retrospective workflow (M9.02) will supply a real `qualityScore` once it has run; until then the estimated value fills in.

## Querying

Query by `personaName` and `role` using Drizzle:

```ts
import { eq, and } from 'drizzle-orm';
import { db } from '@goose-hub/core/db/db.js';
import { personaStats } from '@goose-hub/core/db/schema.js';

const rows = db.select().from(personaStats)
  .where(and(eq(personaStats.personaName, 'alice'), eq(personaStats.role, 'developer')))
  .all();
```
