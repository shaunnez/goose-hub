import { db } from '@goose-hub/core/db/db.js';
import { personaStats } from '@goose-hub/core/db/schema.js';
import { asc } from 'drizzle-orm';

export interface PersonaStat {
  id: number;
  personaName: string;
  role: string;
  runsTotal: number;
  runsSucceeded: number;
  runsFailed: number;
  avgQualityScore: number;
  lastRunAt: string;
}

export async function listPersonaStats(): Promise<PersonaStat[]> {
  return db
    .select()
    .from(personaStats)
    .orderBy(asc(personaStats.role), asc(personaStats.personaName));
}
