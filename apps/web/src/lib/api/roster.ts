import { getJson, postJson } from './client.js';
import type {
  CostSummaryDto,
  ImprovementCandidateDto,
  PersonaNameDto,
  PersonaRunDto,
  PersonaStatDto,
  QualityTrendPointDto,
} from '../types.js';

export async function fetchRoster(): Promise<PersonaStatDto[]> {
  const { personas } = await getJson<{ personas: PersonaStatDto[] }>('/roster');
  return personas;
}

export async function fetchPersonaNames(): Promise<PersonaNameDto[]> {
  const { names } = await getJson<{ names: PersonaNameDto[] }>('/roster/names');
  return names;
}

export async function fetchPersonaRuns(personaName: string): Promise<PersonaRunDto[]> {
  const { runs } = await getJson<{ runs: PersonaRunDto[] }>(
    `/roster/runs?persona=${encodeURIComponent(personaName)}`,
  );
  return runs;
}

export async function fetchPersonaCandidates(
  personaName: string,
): Promise<ImprovementCandidateDto[]> {
  const { candidates } = await getJson<{ candidates: ImprovementCandidateDto[] }>(
    `/roster/candidates?persona=${encodeURIComponent(personaName)}`,
  );
  return candidates;
}

export async function fetchQualityTrend(
  projectId: string,
  limit = 50,
): Promise<QualityTrendPointDto[]> {
  const { trend } = await getJson<{ trend: QualityTrendPointDto[] }>(
    `/roster/quality-trend?project=${encodeURIComponent(projectId)}&limit=${limit}`,
  );
  return trend;
}

export async function approveCandidateById(id: number): Promise<ImprovementCandidateDto> {
  const { candidate } = await postJson<{ candidate: ImprovementCandidateDto }>(
    `/roster/candidates/${id}/approve`,
    {},
  );
  return candidate;
}

export async function rejectCandidateById(id: number): Promise<ImprovementCandidateDto> {
  const { candidate } = await postJson<{ candidate: ImprovementCandidateDto }>(
    `/roster/candidates/${id}/reject`,
    {},
  );
  return candidate;
}

export async function fetchCostSummary(slug: string): Promise<CostSummaryDto> {
  return getJson<CostSummaryDto>(`/projects/${slug}/costs/summary`);
}
