import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../event-stream/store.js';
import { buildPathDriftReport, formatPathDriftReport } from './path-drift-report.js';

function event(
  id: number,
  kind: AgentEvent['kind'],
  payload: unknown,
  createdAt = '2026-05-20T00:00:00Z',
): AgentEvent {
  return {
    id,
    projectId: 'goose-hub-self',
    workItemId: 'github:shaunnez/goose-hub#1',
    kind,
    payload,
    runId: 'run-1',
    personaId: null,
    createdAt,
  };
}

describe('path-drift-report', () => {
  it('groups repairs and mismatches by skill and field', () => {
    const report = buildPathDriftReport(
      [
        event(1, 'agent.path-normalized', {
          skill: 'implement',
          fields: [
            {
              field: 'filesWritten[0].path',
              rawValue: 'src/Foo.tsx',
              normalizedValue: 'apps/web/src/Foo.tsx',
            },
          ],
        }),
        event(2, 'agent.output-fact-mismatch', {
          skill: 'implement',
          mismatches: {
            observedNotDeclared: { count: 1, paths: ['apps/web/src/Foo.tsx'] },
          },
        }),
        event(3, 'agent.contract-gate-blocked', {
          skill: 'spec-author',
          fields: [
            {
              field: 'workPackages[0].filesOwned[0]',
              from: 'src/Foo.tsx',
              to: 'apps/web/src/Foo.tsx',
            },
          ],
        }),
      ],
      'goose-hub-self',
    );

    expect(report.projectId).toBe('goose-hub-self');
    expect(report.driftEvents).toBe(3);
    expect(report.buckets).toContainEqual({
      skill: 'implement',
      field: 'filesWritten[0].path',
      repaired: 1,
      mismatches: 0,
      blocked: 0,
    });
    expect(report.buckets).toContainEqual({
      skill: 'implement',
      field: 'mismatches.observedNotDeclared',
      repaired: 0,
      mismatches: 1,
      blocked: 0,
    });
    expect(report.buckets).toContainEqual({
      skill: 'spec-author',
      field: 'workPackages[0].filesOwned[0]',
      repaired: 0,
      mismatches: 0,
      blocked: 1,
    });
    expect(formatPathDriftReport(report)).toContain(
      'implement filesWritten[0].path: repaired=1 mismatches=0 blocked=0',
    );
  });

  it('computes trend from event time windows instead of list halves', () => {
    const report = buildPathDriftReport([
      event(1, 'agent.output-repaired', { skill: 'implement' }, '2026-05-20T00:00:00Z'),
      event(2, 'agent.run-completed', {}, '2026-05-20T00:10:00Z'),
      event(3, 'agent.output-fact-mismatch', { skill: 'implement' }, '2026-05-20T01:00:00Z'),
      event(4, 'agent.contract-gate-blocked', { skill: 'implement' }, '2026-05-20T01:10:00Z'),
    ]);

    expect(report.trend.previousWindowDriftEvents).toBe(1);
    expect(report.trend.currentWindowDriftEvents).toBe(2);
    expect(report.trend.direction).toBe('increasing');
    expect(formatPathDriftReport(report)).toContain('trend: increasing (1 -> 2)');
  });
});
