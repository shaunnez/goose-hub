import type {
  InterventionDto,
  InterventionEventDto,
  InterventionStatus,
  LegalTargetsDto,
} from '../types.js';
import { getJson, postJson } from './client.js';

export interface DecideInterventionInput {
  actionType: string;
  actionPayload: unknown;
  expectedVersion: number;
  decidedBy?: string;
  reason?: string;
}

export interface InterventionDetailDto {
  intervention: InterventionDto;
  events: InterventionEventDto[];
}

function statusQuery(status?: InterventionStatus[]): string {
  if (status == null || status.length === 0) return '';
  return `?status=${status.join(',')}`;
}

export async function fetchProjectInterventions(
  slug: string,
  status?: InterventionStatus[],
): Promise<InterventionDto[]> {
  const { interventions } = await getJson<{ interventions: InterventionDto[] }>(
    `/projects/${slug}/interventions${statusQuery(status)}`,
  );
  return interventions;
}

export async function fetchIssueInterventions(
  slug: string,
  id: string,
  status?: InterventionStatus[],
): Promise<InterventionDto[]> {
  const { interventions } = await getJson<{ interventions: InterventionDto[] }>(
    `/projects/${slug}/issues/${id}/interventions${statusQuery(status)}`,
  );
  return interventions;
}

export async function fetchIntervention(id: string): Promise<InterventionDetailDto> {
  return getJson<InterventionDetailDto>(`/interventions/${id}`);
}

export async function decideIntervention(
  id: string,
  input: DecideInterventionInput,
): Promise<InterventionDetailDto> {
  return postJson<InterventionDetailDto>(`/interventions/${id}/decide`, input);
}

export async function fetchLegalTargets(slug: string, id: string): Promise<LegalTargetsDto> {
  return getJson<LegalTargetsDto>(`/projects/${slug}/issues/${id}/legal-targets`);
}
