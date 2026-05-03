import { db } from '@goose-hub/core/db/db.js';
import { improvementCandidates, personaStats } from '@goose-hub/core/db/schema.js';
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
}

export interface ImprovementCandidateRow {
  id: number;
  personaName: string;
  sourceTaskId: string | null;
  suggestionText: string;
  suggestionType: string;
  status: string;
  createdAt: string;
}

export async function listPersonaStats(): Promise<PersonaStat[]> {
  return db
    .select()
    .from(personaStats)
    .orderBy(asc(personaStats.role), asc(personaStats.personaName));
}

export async function listCandidatesByPersona(
  personaName: string,
  status = 'pending',
): Promise<ImprovementCandidateRow[]> {
  return db
    .select()
    .from(improvementCandidates)
    .where(
      and(
        eq(improvementCandidates.personaName, personaName),
        eq(improvementCandidates.status, status),
      ),
    )
    .orderBy(asc(improvementCandidates.createdAt));
}

export async function updateCandidateStatus(
  id: number,
  status: 'approved' | 'rejected',
): Promise<ImprovementCandidateRow | null> {
  await db.update(improvementCandidates).set({ status }).where(eq(improvementCandidates.id, id));
  const [row] = await db
    .select()
    .from(improvementCandidates)
    .where(eq(improvementCandidates.id, id));
  return row ?? null;
}

export async function insertCandidate(data: {
  personaName: string;
  sourceTaskId: string | null;
  suggestionText: string;
  suggestionType: string;
}): Promise<ImprovementCandidateRow> {
  const [row] = await db.insert(improvementCandidates).values(data).returning();
  return row;
}
