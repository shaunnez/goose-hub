import {
  InterventionStatusSchema,
  decide,
  getIntervention,
  listInterventionEvents,
  listInterventions,
  validateInterventionAction,
} from '@goose-hub/core/interventions/index.js';
import type { Result } from '#shared/middleware.js';
import { getSourceForSlug } from '#shared/source.js';
import type { InterventionDetailDto, InterventionsListDto } from './dto.js';
import { toInterventionDto, toInterventionEventDto } from './dto.js';

interface RawDecideInterventionRequest {
  actionType?: unknown;
  actionPayload?: unknown;
  decidedBy?: unknown;
  reason?: unknown;
  expectedVersion?: unknown;
}

function parseStatusFilter(
  status: string | undefined,
): { ok: true; statuses: string[] | undefined } | { ok: false; error: string } {
  if (status == null || status.length === 0) return { ok: true, statuses: undefined };
  const statuses = status
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  if (statuses.length === 0) return { ok: true, statuses: undefined };
  for (const candidate of statuses) {
    const parsed = InterventionStatusSchema.safeParse(candidate);
    if (!parsed.success) return { ok: false, error: `invalid intervention status: ${candidate}` };
  }
  return { ok: true, statuses };
}

function toDetailDto(id: string): InterventionDetailDto {
  const intervention = getIntervention(id);
  if (intervention == null) throw new Error(`intervention disappeared: ${id}`);
  return {
    intervention: toInterventionDto(intervention),
    events: listInterventionEvents(id).map(toInterventionEventDto),
  };
}

export async function listProjectInterventions(
  slug: string,
  status?: string,
): Promise<Result<InterventionsListDto>> {
  const parsedStatus = parseStatusFilter(status);
  if (!parsedStatus.ok) return { ok: false, error: parsedStatus.error, status: 400 };
  return {
    ok: true,
    data: {
      interventions: listInterventions({
        projectId: slug,
        status: parsedStatus.statuses,
      }).map(toInterventionDto),
    },
  };
}

export async function listIssueInterventions(
  slug: string,
  id: string,
  status?: string,
): Promise<Result<InterventionsListDto>> {
  const parsedStatus = parseStatusFilter(status);
  if (!parsedStatus.ok) return { ok: false, error: parsedStatus.error, status: 400 };

  const source = await getSourceForSlug(slug);
  if (source == null) return { ok: false, error: 'project not found', status: 404 };
  const item = await source.getItem(id);
  const workItemId = (item as { id: string }).id;

  return {
    ok: true,
    data: {
      interventions: listInterventions({
        projectId: slug,
        workItemId,
        status: parsedStatus.statuses,
      }).map(toInterventionDto),
    },
  };
}

export async function getInterventionDetail(id: string): Promise<Result<InterventionDetailDto>> {
  const intervention = getIntervention(id);
  if (intervention == null) return { ok: false, error: 'intervention not found', status: 404 };
  return { ok: true, data: toDetailDto(id) };
}

export async function decideIntervention(
  id: string,
  body: RawDecideInterventionRequest,
): Promise<Result<InterventionDetailDto>> {
  const intervention = getIntervention(id);
  if (intervention == null) return { ok: false, error: 'intervention not found', status: 404 };
  if (typeof body.actionType !== 'string') {
    return { ok: false, error: 'actionType is required', status: 400 };
  }
  const validation = validateInterventionAction(body.actionType, body.actionPayload);
  if (!validation.ok) return { ok: false, error: validation.error, status: 422 };

  if (typeof body.expectedVersion !== 'number' || !Number.isInteger(body.expectedVersion)) {
    return { ok: false, error: 'expectedVersion is required', status: 400 };
  }
  const result = decide({
    id,
    expectedVersion: body.expectedVersion,
    actionType: body.actionType,
    actionPayload: validation.data,
    decidedBy: typeof body.decidedBy === 'string' ? body.decidedBy : 'operator',
    reason: typeof body.reason === 'string' ? body.reason : undefined,
  });
  if (!result.ok) return { ok: false, error: result.error, status: result.status };
  return { ok: true, data: toDetailDto(result.intervention.id) };
}
