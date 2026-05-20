import { open } from '@goose-hub/core/interventions/reducer.js';
import { describe, expect, it } from 'vitest';
import { decideIntervention, listProjectInterventions } from './service.js';

function openIntervention(suffix: string) {
  const projectId = `proj-${suffix}`;
  const opened = open({
    projectId,
    workItemId: `github:owner/repo#${suffix}`,
    interventionType: 'needs_human',
    title: 'Needs human',
    reason: 'Workflow asked for help',
    rootCauseSignature: `needs-human|${suffix}`,
    actor: 'test',
  });
  if (!opened.ok) throw new Error(opened.error);
  return opened.intervention;
}

describe('decideIntervention', () => {
  it('requires callers to provide the observed CAS version', async () => {
    const intervention = openIntervention('missing-version');

    const result = await decideIntervention(intervention.id, {
      actionType: 'no_action',
      actionPayload: { reason: 'wait' },
    });

    expect(result).toEqual({
      ok: false,
      error: 'expectedVersion is required',
      status: 400,
    });
  });

  it('decides with an explicit matching version', async () => {
    const intervention = openIntervention('valid-version');

    const result = await decideIntervention(intervention.id, {
      actionType: 'no_action',
      actionPayload: { reason: 'wait' },
      expectedVersion: intervention.version,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.intervention.status).toBe('DECIDED');
    expect(result.data.intervention.decidedActionType).toBe('no_action');
    expect(result.data.events.map((event) => event.eventType)).toEqual(['open', 'decide']);
  });
});

describe('listProjectInterventions', () => {
  it('returns DTOs filtered by comma-separated statuses', async () => {
    const intervention = openIntervention('status-filter');

    const result = await listProjectInterventions(intervention.projectId, 'open,PROPOSED');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.interventions).toEqual([
      expect.objectContaining({
        id: intervention.id,
        projectId: intervention.projectId,
        workItemId: intervention.workItemId,
        status: 'OPEN',
        proposedOptions: [],
        version: intervention.version,
      }),
    ]);
  });

  it('rejects invalid status filters', async () => {
    const result = await listProjectInterventions('proj-invalid-status', 'OPEN,WAT');

    expect(result).toEqual({
      ok: false,
      error: 'invalid intervention status: WAT',
      status: 400,
    });
  });
});
