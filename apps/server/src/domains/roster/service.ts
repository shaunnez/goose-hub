import type { Result } from '../../shared/middleware.js';
import type { PersonaStat } from './repository.js';
import { listPersonaStats } from './repository.js';

export interface PersonaRunDto {
  runId: string;
  workItemId: string | null;
  outcome: string;
  qualityScore: number;
  createdAt: string;
}

export interface ImprovementCandidateDto {
  id: number;
  personaName: string;
  sourceTaskId: string | null;
  suggestionText: string;
  suggestionType: string;
  status: string;
  createdAt: string;
}

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
  _personaName: string,
): Promise<Result<{ candidates: ImprovementCandidateDto[] }>> {
  // improvement_candidates table is created in #264; return empty for now.
  return { ok: true, data: { candidates: [] } };
}
