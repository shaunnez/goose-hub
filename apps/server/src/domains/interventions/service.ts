import {
  decide,
  getIntervention,
  listInterventionEvents,
  listInterventions,
  validateInterventionAction,
} from '@goose-hub/core/interventions/index.js';
import type { WorkItemIntervention } from '@goose-hub/core/interventions/types.js';
import type { Result } from '#shared/middleware.js';

function normaliseStatus(status: string | undefined): string | undefined {
  if (status == null || status.length === 0) return undefined;
  return status.toUpperCase();
}

export async function listProjectInterventions(
  slug: string,
  status?: string,
): Promise<Result<{ interventions: WorkItemIntervention[] }>> {
  return {
    ok: true,
    data: {
      interventions: listInterventions({ projectId: slug, status: normaliseStatus(status) }),
    },
  };
}

export async function getInterventionDetail(id: string): Promise<
  Result<{
    intervention: WorkItemIntervention;
    events: ReturnType<typeof listInterventionEvents>;
  }>
> {
  const intervention = getIntervention(id);
  if (intervention == null) return { ok: false, error: 'intervention not found', status: 404 };
  return { ok: true, data: { intervention, events: listInterventionEvents(id) } };
}

export async function decideIntervention(
  id: string,
  body: {
    actionType?: unknown;
    actionPayload?: unknown;
    decidedBy?: unknown;
    reason?: unknown;
    expectedVersion?: unknown;
  },
): Promise<Result<{ intervention: WorkItemIntervention }>> {
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
  return { ok: true, data: { intervention: result.intervention } };
}
