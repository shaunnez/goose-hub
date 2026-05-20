import { describe, expect, it, vi } from 'vitest';
import { interventionKeys, invalidateInterventionDecision } from './query-keys.js';

describe('intervention query keys', () => {
  it('builds stable project, issue, detail, and legal-target keys', () => {
    expect(interventionKeys.project('proj', ['OPEN', 'PROPOSED'])).toEqual([
      'interventions',
      'project',
      'proj',
      'OPEN,PROPOSED',
    ]);
    expect(interventionKeys.issue('proj', '42', ['OPEN'])).toEqual([
      'interventions',
      'issue',
      'proj',
      '42',
      'OPEN',
    ]);
    expect(interventionKeys.detail('i1')).toEqual(['interventions', 'detail', 'i1']);
    expect(interventionKeys.timeline('proj', '42')).toEqual([
      'intervention-timeline',
      'proj',
      '42',
    ]);
    expect(interventionKeys.legalTargets('proj', '42')).toEqual(['legal-targets', 'proj', '42']);
  });

  it('invalidates issue, queue, detail, events, and legal-target data after decisions', async () => {
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    };

    await invalidateInterventionDecision(queryClient as never, {
      projectSlug: 'proj',
      issueId: '42',
      interventionId: 'i1',
    });

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['issue', 'proj', '42'],
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['issues', 'proj'] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['events', 'proj', '42'],
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['interventions', 'detail', 'i1'],
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['interventions', 'project', 'proj'],
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['interventions', 'issue', 'proj', '42'],
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['intervention-timeline', 'proj', '42'],
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['legal-targets', 'proj', '42'],
    });
  });
});
