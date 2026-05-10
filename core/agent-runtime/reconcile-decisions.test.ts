import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the event store and readRunDecisions before importing the module under test.
vi.mock('../event-stream/store.js', () => ({
  eventStore: { appendEvent: vi.fn().mockReturnValue({ id: 1 }) },
}));

vi.mock('../tool-layer/tools/record-decision.js', () => ({
  readRunDecisions: vi.fn().mockReturnValue([]),
}));

import { eventStore } from '../event-stream/store.js';
import { readRunDecisions } from '../tool-layer/tools/record-decision.js';
import { _clearEmittedIdsForTest, reconcileDecisionSummaries } from './reconcile-decisions.js';

const appendEvent = vi.mocked(eventStore.appendEvent);
const mockReadRunDecisions = vi.mocked(readRunDecisions);

beforeEach(() => {
  appendEvent.mockClear();
  mockReadRunDecisions.mockReset();
  mockReadRunDecisions.mockReturnValue([]);
  _clearEmittedIdsForTest();
});

describe('reconcileDecisionSummaries', () => {
  const runId = 'run-test-1';
  const projectId = 'proj-1';
  const workItemId = 'github:owner/repo#42';
  const skill = 'implement';

  describe('schema-field fallback (DB empty)', () => {
    it('emits schema-field summaries when no DB rows exist', () => {
      mockReadRunDecisions.mockReturnValue([]);
      const parsedSummaries = [
        {
          kind: 'IMPLEMENTATION_PLAN' as const,
          summary: 'Added auth check',
          evidence: 'src/api.ts:42',
        },
        { kind: 'REPO_SELECTION' as const, summary: 'Using payments-api' },
      ];

      reconcileDecisionSummaries(runId, projectId, workItemId, skill, parsedSummaries);

      expect(appendEvent).toHaveBeenCalledTimes(2);
      expect(appendEvent).toHaveBeenCalledWith({
        projectId,
        workItemId,
        runId,
        kind: 'agent.decision-summary',
        payload: { skill, ...parsedSummaries[0] },
      });
      expect(appendEvent).toHaveBeenCalledWith({
        projectId,
        workItemId,
        runId,
        kind: 'agent.decision-summary',
        payload: { skill, ...parsedSummaries[1] },
      });
    });

    it('emits nothing when DB empty and parsedSummaries empty', () => {
      mockReadRunDecisions.mockReturnValue([]);
      reconcileDecisionSummaries(runId, projectId, workItemId, skill, []);
      expect(appendEvent).not.toHaveBeenCalled();
    });
  });

  describe('DB-preferred when rows exist', () => {
    it('uses DB rows when present, ignoring parsedSummaries', () => {
      const dbRows = [
        {
          id: 'row-1',
          kind: 'IMPLEMENTATION_PLAN' as const,
          summary: 'from DB',
          evidence: 'hook-captured',
        },
      ];
      mockReadRunDecisions.mockReturnValue(dbRows);
      const parsedSummaries = [{ kind: 'REPO_SELECTION' as const, summary: 'from schema field' }];

      reconcileDecisionSummaries(runId, projectId, workItemId, skill, parsedSummaries);

      expect(appendEvent).toHaveBeenCalledTimes(1);
      const emitted = appendEvent.mock.calls[0][0];
      expect(emitted.payload).toMatchObject({ skill, summary: 'from DB' });
    });

    it('does NOT emit schema-field summaries when DB rows exist (no double-emission)', () => {
      const dbRows = [{ id: 'row-1', kind: 'IMPLEMENTATION_PLAN' as const, summary: 'DB row' }];
      mockReadRunDecisions.mockReturnValue(dbRows);
      const parsedSummaries = [
        { kind: 'REPO_SELECTION' as const, summary: 'schema-field summary' },
        { kind: 'IMPLEMENTATION_PLAN' as const, summary: 'another schema-field' },
      ];

      reconcileDecisionSummaries(runId, projectId, workItemId, skill, parsedSummaries);

      // Only the 1 DB row emitted, not the 2 parsed summaries.
      expect(appendEvent).toHaveBeenCalledTimes(1);
      const emitted = appendEvent.mock.calls[0][0];
      expect(emitted.payload.summary).toBe('DB row');
    });

    it('does not re-emit DB rows already emitted in a prior reconcile call for the same runId', () => {
      // Simulates grill-and-prd.ts: shared runId, 3 sequential reconcile calls.
      // First call (skill='grill-me'): rows r1, r2.
      const grillRows = [
        { id: 'r1', kind: 'IMPLEMENTATION_PLAN' as const, summary: 'grill decision 1' },
        { id: 'r2', kind: 'REPO_SELECTION' as const, summary: 'grill decision 2' },
      ];
      mockReadRunDecisions.mockReturnValue(grillRows);
      reconcileDecisionSummaries(runId, projectId, workItemId, 'grill-me', []);

      expect(appendEvent).toHaveBeenCalledTimes(2);
      appendEvent.mockClear();

      // Second call (skill='write-prd'): rows r1, r2, r3 (r1+r2 already emitted).
      const prdRows = [
        { id: 'r1', kind: 'IMPLEMENTATION_PLAN' as const, summary: 'grill decision 1' },
        { id: 'r2', kind: 'REPO_SELECTION' as const, summary: 'grill decision 2' },
        { id: 'r3', kind: 'INSIGHT' as const, summary: 'prd decision' },
      ];
      mockReadRunDecisions.mockReturnValue(prdRows);
      reconcileDecisionSummaries(runId, projectId, workItemId, 'write-prd', []);

      // Only r3 is new — r1 and r2 must not be re-emitted.
      expect(appendEvent).toHaveBeenCalledTimes(1);
      const emitted = appendEvent.mock.calls[0][0];
      expect(emitted.payload.summary).toBe('prd decision');
      expect(emitted.payload.skill).toBe('write-prd');
    });
  });

  describe('event shape', () => {
    it('includes skill in payload', () => {
      mockReadRunDecisions.mockReturnValue([]);
      reconcileDecisionSummaries(runId, projectId, workItemId, 'qa', [
        { kind: 'FUNCTIONAL_CHECK' as const, summary: 'all tests pass' },
      ]);
      const emitted = appendEvent.mock.calls[0][0];
      expect(emitted.payload.skill).toBe('qa');
    });

    it('sets kind=agent.decision-summary on the event', () => {
      mockReadRunDecisions.mockReturnValue([]);
      reconcileDecisionSummaries(runId, projectId, null, skill, [
        { kind: 'IMPLEMENTATION_PLAN' as const, summary: 'test' },
      ]);
      const emitted = appendEvent.mock.calls[0][0];
      expect(emitted.kind).toBe('agent.decision-summary');
    });

    it('accepts null workItemId', () => {
      mockReadRunDecisions.mockReturnValue([]);
      expect(() =>
        reconcileDecisionSummaries(runId, projectId, null, skill, [
          { kind: 'IMPLEMENTATION_PLAN' as const, summary: 'test' },
        ]),
      ).not.toThrow();
      expect(appendEvent.mock.calls[0][0].workItemId).toBeNull();
    });
  });
});
