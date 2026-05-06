import { db } from '@goose-hub/core/db/db.js';
import { improvementCandidates, personaNames, personaStats } from '@goose-hub/core/db/schema.js';
import { and, asc, eq } from 'drizzle-orm';

export interface PersonaStat {
  id: number;
  personaName: string;
  codename: string | null;
  role: string;
  runsTotal: number;
  runsSucceeded: number;
  runsFailed: number;
  avgQualityScore: number;
  lastRunAt: string;
}

export interface ImprovementCandidateRow {
  id: number;
  projectId: string;
  personaName: string;
  sourceTaskId: string | null;
  suggestionText: string;
  suggestionType: string;
  status: string;
  githubIssueUrl: string | null;
  errorNote: string | null;
  proposedDiff: string | null;
  createdAt: string;
}

export interface PersonaNameRow {
  personaId: string;
  codename: string;
  role: string;
}

export async function listPersonaNames(): Promise<PersonaNameRow[]> {
  const rows = await db.select().from(personaNames);
  return rows.map((r) => ({
    personaId: `${r.projectId}/${r.role}/${r.slotIndex}`,
    codename: r.codename,
    role: r.role,
  }));
}

export async function listPersonaStats(): Promise<PersonaStat[]> {
  const stats = await db
    .select()
    .from(personaStats)
    .orderBy(asc(personaStats.role), asc(personaStats.personaName));

  const names = await db.select().from(personaNames);
  const codenameMap = new Map(
    names.map((n) => [`${n.projectId}/${n.role}/${n.slotIndex}`, n.codename]),
  );

  return stats.map((s) => ({
    ...s,
    codename: codenameMap.get(s.personaName) ?? null,
  }));
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

export async function getCandidateById(id: number): Promise<ImprovementCandidateRow | null> {
  const [row] = await db
    .select()
    .from(improvementCandidates)
    .where(eq(improvementCandidates.id, id));
  return row ?? null;
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

export async function updateCandidateGithubIssue(
  id: number,
  githubIssueUrl: string | null,
  errorNote: string | null,
): Promise<ImprovementCandidateRow | null> {
  await db
    .update(improvementCandidates)
    .set({ githubIssueUrl, errorNote })
    .where(eq(improvementCandidates.id, id));
  const [row] = await db
    .select()
    .from(improvementCandidates)
    .where(eq(improvementCandidates.id, id));
  return row ?? null;
}

export async function insertCandidate(data: {
  projectId: string;
  personaName: string;
  sourceTaskId: string | null;
  suggestionText: string;
  suggestionType: string;
}): Promise<ImprovementCandidateRow> {
  const [row] = await db.insert(improvementCandidates).values(data).returning();
  return row;
}
