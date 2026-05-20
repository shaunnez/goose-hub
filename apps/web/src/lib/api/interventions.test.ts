import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decideIntervention,
  fetchIssueInterventions,
  fetchLegalTargets,
  fetchProjectInterventions,
} from './interventions.js';

describe('intervention API client', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ interventions: [], from: 'factory:needs-human', legalTargets: [] }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches project and issue intervention queues with comma-separated status filters', async () => {
    await fetchProjectInterventions('proj', ['OPEN', 'PROPOSED']);
    await fetchIssueInterventions('proj', '42', ['OPEN', 'PROPOSED']);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/projects/proj/interventions?status=OPEN,PROPOSED',
      {
        headers: { Accept: 'application/json' },
        signal: undefined,
      },
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/projects/proj/issues/42/interventions?status=OPEN,PROPOSED',
      {
        headers: { Accept: 'application/json' },
        signal: undefined,
      },
    );
  });

  it('posts decisions and fetches legal targets', async () => {
    await decideIntervention('i1', {
      actionType: 'no_action',
      actionPayload: { reason: 'wait' },
      expectedVersion: 3,
    });
    await fetchLegalTargets('proj', '42');

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/interventions/i1/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        actionType: 'no_action',
        actionPayload: { reason: 'wait' },
        expectedVersion: 3,
      }),
    });
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/projects/proj/issues/42/legal-targets', {
      headers: { Accept: 'application/json' },
      signal: undefined,
    });
  });
});
