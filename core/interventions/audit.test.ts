import { describe, expect, it } from 'vitest';
import { db } from '../db/db.js';
import { agentRunCosts } from '../db/schema.js';
import { eventStore } from '../event-stream/store.js';
import { formatInterventionAuditReport, loadInterventionAuditReport } from './audit.js';
import { open, recordProposalFailure } from './reducer.js';

describe('intervention audit report', () => {
  it('reports active counts, terminal-state stale rows, repeated proposer failures, and proposer cost', () => {
    const projectId = 'audit-report-proj';
    const stale = open({
      projectId,
      workItemId: 'github:owner/repo#audit-stale',
      interventionType: 'needs_human',
      title: 'Needs human',
      reason: 'Workflow asked for help',
      rootCauseSignature: 'audit-report|stale',
      actor: 'test',
    });
    const failing = open({
      projectId,
      workItemId: 'github:owner/repo#audit-failing',
      interventionType: 'needs_human',
      title: 'Needs human',
      reason: 'Workflow asked for help',
      rootCauseSignature: 'audit-report|failing',
      actor: 'test',
    });
    expect(stale.ok).toBe(true);
    expect(failing.ok).toBe(true);
    if (!stale.ok || !failing.ok) return;

    eventStore.appendEvent({
      projectId,
      workItemId: stale.intervention.workItemId,
      kind: 'state.transitioned',
      payload: { from: 'factory:needs-human', to: 'factory:archived' },
    });

    const firstFailure = recordProposalFailure({
      id: failing.intervention.id,
      expectedVersion: failing.intervention.version,
      error: 'invalid output 1',
      evidence: { runId: 'audit-run-1' },
      actor: 'test',
      retryAt: '2026-05-20T00:01:00Z',
      failureCount: 1,
      maxFailures: 3,
    });
    expect(firstFailure.ok).toBe(true);
    if (!firstFailure.ok) return;
    const secondFailure = recordProposalFailure({
      id: failing.intervention.id,
      expectedVersion: firstFailure.intervention.version,
      error: 'invalid output 2',
      evidence: { runId: 'audit-run-2' },
      actor: 'test',
      retryAt: '2026-05-20T00:02:00Z',
      failureCount: 2,
      maxFailures: 3,
    });
    expect(secondFailure.ok).toBe(true);

    db.insert(agentRunCosts)
      .values([
        {
          runId: 'audit-run-1',
          projectId,
          workItemId: failing.intervention.workItemId,
          stage: 'intervention-proposer',
          skill: 'intervention-proposer',
          modelId: 'gpt-5.4-mini',
          costUsd: 0.01,
          costLabel: 'estimated',
        },
        {
          runId: 'audit-run-2',
          projectId,
          workItemId: failing.intervention.workItemId,
          stage: 'intervention-proposer',
          skill: 'intervention-proposer',
          modelId: 'gpt-5.4-mini',
          costUsd: 0.02,
          costLabel: 'estimated',
        },
      ])
      .run();

    const report = loadInterventionAuditReport({ projectId });
    expect(report.activeByProjectType).toEqual([
      { projectId, interventionType: 'needs_human', count: 2 },
    ]);
    expect(report.activeTerminalStateRows).toEqual([
      expect.objectContaining({
        interventionId: stale.intervention.id,
        latestState: 'factory:archived',
      }),
    ]);
    expect(report.repeatedProposalFailures).toEqual([
      expect.objectContaining({
        interventionId: failing.intervention.id,
        failureCount: 2,
        lastError: 'invalid output 2',
      }),
    ]);
    expect(report.proposerCosts).toEqual([
      expect.objectContaining({
        interventionId: failing.intervention.id,
        runIds: ['audit-run-1', 'audit-run-2'],
        estimatedCostUsd: 0.03,
      }),
    ]);
    expect(formatInterventionAuditReport(report)).toContain('Rows with repeated proposalFailed');
  });

  it('aggregates all matching interventions by default instead of silently capping rows', () => {
    const projectId = 'audit-report-no-default-cap';
    for (let index = 0; index < 1001; index += 1) {
      const opened = open({
        projectId,
        workItemId: `github:owner/repo#audit-cap-${index}`,
        interventionType: 'needs_human',
        title: 'Needs human',
        reason: 'Workflow asked for help',
        rootCauseSignature: `audit-report-no-default-cap|${index}`,
        actor: 'test',
      });
      expect(opened.ok).toBe(true);
    }

    const report = loadInterventionAuditReport({ projectId });

    expect(report.activeByProjectType).toEqual([
      { projectId, interventionType: 'needs_human', count: 1001 },
    ]);
  });
});
