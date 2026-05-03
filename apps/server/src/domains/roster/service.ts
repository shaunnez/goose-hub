import type { Result } from '../../shared/middleware.js';
import type { ImprovementCandidateRow, PersonaStat } from './repository.js';
import { listCandidatesByPersona, listPersonaStats, updateCandidateStatus } from './repository.js';

export interface PersonaRunDto {
  runId: string;
  workItemId: string | null;
  outcome: string;
  qualityScore: number;
  createdAt: string;
}

export type { ImprovementCandidateRow as ImprovementCandidateDto };

export async function listPersonas(): Promise<Result<{ personas: PersonaStat[] }>> {
  const personas = await listPersonaStats();
  return { ok: true, data: { personas } };
}

export async function getPersonaRuns(
  _personaName: string,
): Promise<Result<{ runs: PersonaRunDto[] }>> {
  // Per-run history table is added in a future issue; return empty for now.
  return { ok: true, data: { runs: [] } };
}

export async function getPersonaCandidates(
  personaName: string,
): Promise<Result<{ candidates: ImprovementCandidateRow[] }>> {
  const candidates = await listCandidatesByPersona(personaName, 'pending');
  return { ok: true, data: { candidates } };
}

export async function approveCandidate(
  id: number,
): Promise<Result<{ candidate: ImprovementCandidateRow }>> {
  const candidate = await updateCandidateStatus(id, 'approved');
  if (!candidate) return { ok: false, error: 'candidate not found', status: 404 };
  return { ok: true, data: { candidate } };
}

export async function rejectCandidate(
  id: number,
): Promise<Result<{ candidate: ImprovementCandidateRow }>> {
  const candidate = await updateCandidateStatus(id, 'rejected');
  if (!candidate) return { ok: false, error: 'candidate not found', status: 404 };
  return { ok: true, data: { candidate } };
}
