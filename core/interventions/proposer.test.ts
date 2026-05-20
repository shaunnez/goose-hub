import { describe, expect, it, vi } from 'vitest';
import type { InvokeSkillInput, InvokeSkillResult } from '../agent-runtime/invoke-skill.js';
import { eventStore } from '../event-stream/store.js';
import { runInterventionProposerWorkerOnce } from './proposer.js';
import { leaseForProposal, open } from './reducer.js';
import { getIntervention, listInterventionEvents } from './repository.js';

function openFixture(
  suffix: string,
  options: { projectId?: string; interventionType?: 'needs_human' | 'gate_pending' } = {},
) {
  const result = open({
    projectId: options.projectId ?? `proj-${suffix}`,
    workItemId: `github:owner/repo#${suffix}`,
    interventionType: options.interventionType ?? 'needs_human',
    title: 'Needs human',
    reason: 'Workflow asked for help',
    rootCauseSignature: `${options.interventionType ?? 'needs_human'}|${suffix}`,
    actor: 'test',
  });
  if (!result.ok) throw new Error(result.error);
  return result.intervention;
}

function skillResult(output: unknown): InvokeSkillResult {
  return {
    output,
    decisionSummaries: [],
    events: [],
    personaId: 'proj/intervention-proposer/0',
    role: 'intervention-proposer',
  };
}

describe('intervention proposer worker', () => {
  it('leases open interventions, invokes the proposer skill, and stores validated options', async () => {
    const intervention = openFixture('proposal-success');
    eventStore.appendEvent({
      projectId: intervention.projectId,
      workItemId: intervention.workItemId,
      kind: 'state.transitioned',
      payload: { from: 'factory:in-progress', to: 'factory:needs-human' },
    });
    const invokeSkill = vi.fn(async (_input: InvokeSkillInput) =>
      skillResult({
        summary: 'Choose next state',
        options: [
          {
            actionType: 'manual_transition',
            label: 'Return to triage',
            description: 'Send the issue back through triage.',
            payload: {
              from: 'factory:needs-human',
              to: 'factory:triaging',
              reason: 'operator selected triage',
            },
            risk: 'medium',
          },
        ],
        decisionSummaries: [{ kind: 'info', summary: 'Proposed legal manual transition' }],
      }),
    );

    const result = await runInterventionProposerWorkerOnce({
      projectId: intervention.projectId,
      limit: 10,
      leaseOwner: 'test-proposer',
      deps: {
        invokeSkill,
        now: () => new Date('2026-05-20T00:00:00Z'),
        runId: () => 'run-proposal-success',
      },
    });

    expect(result).toEqual({ processed: 1, proposed: 1, failed: 0, skipped: 0 });
    expect(invokeSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        skillName: 'intervention-proposer',
        projectId: intervention.projectId,
        workItemId: intervention.workItemId,
        runId: 'run-proposal-success',
      }),
    );
    const context = invokeSkill.mock.calls[0][0].context;
    expect(context).toEqual(
      expect.objectContaining({
        legalTargets: expect.arrayContaining(['factory:triaging']),
        intervention: expect.objectContaining({ id: intervention.id }),
      }),
    );
    const current = getIntervention(intervention.id);
    expect(current?.status).toBe('PROPOSED');
    expect(current?.leaseOwner).toBeNull();
    expect(current?.proposedOptions).toHaveLength(1);
    expect(listInterventionEvents(intervention.id).map((event) => event.eventType)).toEqual([
      'open',
      'leaseProposal',
      'propose',
    ]);
  });

  it('backs off after invalid proposer output instead of immediately retrying', async () => {
    const intervention = openFixture('proposal-invalid');
    const invokeSkill = vi.fn(async () =>
      skillResult({
        summary: 'Bad option',
        options: [
          {
            actionType: 'manual_transition',
            label: 'Illegal jump',
            description: 'This should be rejected by the registry.',
            payload: {
              from: 'factory:needs-human',
              to: 'factory:done',
            },
            risk: 'high',
          },
        ],
        decisionSummaries: [{ kind: 'risk', summary: 'Bad option' }],
      }),
    );
    const now = new Date('2026-05-20T00:00:00Z');

    const result = await runInterventionProposerWorkerOnce({
      projectId: intervention.projectId,
      limit: 10,
      leaseOwner: 'test-proposer',
      retryBaseMs: 2 * 60_000,
      deps: {
        invokeSkill,
        now: () => now,
        runId: () => 'run-proposal-invalid',
      },
    });

    expect(result).toEqual({ processed: 1, proposed: 0, failed: 1, skipped: 0 });
    const current = getIntervention(intervention.id);
    expect(current?.status).toBe('OPEN');
    expect(current?.leaseOwner).toBeNull();
    expect(current?.leaseExpiresAt).toBe('2026-05-20T00:02:00.000Z');
    expect(current?.proposedOptions).toEqual([]);
    const events = listInterventionEvents(intervention.id);
    expect(events.map((event) => event.eventType)).toEqual([
      'open',
      'leaseProposal',
      'proposalFailed',
    ]);
    expect(events.at(-1)?.payload).toEqual(
      expect.objectContaining({
        error: expect.stringContaining('illegal transition'),
        failureCount: 1,
        retryAt: '2026-05-20T00:02:00.000Z',
      }),
    );

    const immediateRetry = await runInterventionProposerWorkerOnce({
      projectId: intervention.projectId,
      limit: 10,
      leaseOwner: 'test-proposer',
      deps: {
        invokeSkill,
        now: () => now,
        runId: () => 'run-proposal-invalid-retry',
      },
    });
    expect(immediateRetry).toEqual({ processed: 0, proposed: 0, failed: 0, skipped: 0 });
    expect(invokeSkill).toHaveBeenCalledTimes(1);
  });

  it('aborts an intervention after the configured proposal failure cap', async () => {
    const intervention = openFixture('proposal-failure-cap');
    const invokeSkill = vi.fn(async () =>
      skillResult({
        summary: 'Bad option',
        options: [
          {
            actionType: 'manual_transition',
            label: 'Illegal jump',
            description: 'This should be rejected by the registry.',
            payload: {
              from: 'factory:needs-human',
              to: 'factory:done',
            },
            risk: 'high',
          },
        ],
      }),
    );

    const first = await runInterventionProposerWorkerOnce({
      projectId: intervention.projectId,
      limit: 10,
      leaseOwner: 'test-proposer',
      retryBaseMs: 1_000,
      maxProposalFailures: 2,
      deps: {
        invokeSkill,
        now: () => new Date('2026-05-20T00:00:00Z'),
        runId: () => 'run-proposal-failure-cap-1',
      },
    });
    const second = await runInterventionProposerWorkerOnce({
      projectId: intervention.projectId,
      limit: 10,
      leaseOwner: 'test-proposer',
      retryBaseMs: 1_000,
      maxProposalFailures: 2,
      deps: {
        invokeSkill,
        now: () => new Date('2026-05-20T00:00:02Z'),
        runId: () => 'run-proposal-failure-cap-2',
      },
    });

    expect(first).toEqual({ processed: 1, proposed: 0, failed: 1, skipped: 0 });
    expect(second).toEqual({ processed: 1, proposed: 0, failed: 1, skipped: 0 });
    expect(invokeSkill).toHaveBeenCalledTimes(2);
    const current = getIntervention(intervention.id);
    expect(current?.status).toBe('ABORTED');
    expect(current?.leaseOwner).toBeNull();
    expect(current?.leaseExpiresAt).toBeNull();
    const lastEvent = listInterventionEvents(intervention.id).at(-1);
    expect(lastEvent).toMatchObject({
      eventType: 'proposalFailed',
      fromStatus: 'OPEN',
      toStatus: 'ABORTED',
      payload: expect.objectContaining({
        failureCount: 2,
        maxFailures: 2,
        aborted: true,
        error: expect.stringContaining('illegal transition'),
      }),
    });
  });

  it('supersedes terminal-state stale rows without invoking the proposer skill', async () => {
    const intervention = openFixture('proposal-stale-terminal');
    eventStore.appendEvent({
      projectId: intervention.projectId,
      workItemId: intervention.workItemId,
      kind: 'state.transitioned',
      payload: { from: 'factory:needs-human', to: 'factory:archived' },
    });
    const invokeSkill = vi.fn(async () => skillResult({ options: [] }));

    const result = await runInterventionProposerWorkerOnce({
      projectId: intervention.projectId,
      limit: 10,
      leaseOwner: 'test-proposer',
      deps: {
        invokeSkill,
        now: () => new Date('2026-05-20T00:00:00Z'),
        runId: () => 'run-proposal-stale-terminal',
      },
    });

    expect(result).toEqual({ processed: 1, proposed: 0, failed: 0, skipped: 1 });
    expect(invokeSkill).not.toHaveBeenCalled();
    expect(getIntervention(intervention.id)?.status).toBe('SUPERSEDED');
    const supersedeEvent = listInterventionEvents(intervention.id).at(-1);
    expect(supersedeEvent).toMatchObject({
      eventType: 'supersede',
      actor: 'test-proposer',
      payload: expect.objectContaining({
        supersededBy: 'latest-state:factory:archived',
        evidence: expect.objectContaining({
          latestState: 'factory:archived',
          reason: 'latest state is terminal: factory:archived',
        }),
      }),
    });
  });

  it('supersedes stale intervention types whose latest state no longer matches', async () => {
    const intervention = openFixture('proposal-stale-gate', { interventionType: 'gate_pending' });
    eventStore.appendEvent({
      projectId: intervention.projectId,
      workItemId: intervention.workItemId,
      kind: 'state.transitioned',
      payload: { from: 'factory:gate-pending', to: 'factory:triaging' },
    });
    const invokeSkill = vi.fn(async () => skillResult({ options: [] }));

    const result = await runInterventionProposerWorkerOnce({
      projectId: intervention.projectId,
      limit: 10,
      leaseOwner: 'test-proposer',
      deps: {
        invokeSkill,
        now: () => new Date('2026-05-20T00:00:00Z'),
      },
    });

    expect(result).toEqual({ processed: 1, proposed: 0, failed: 0, skipped: 1 });
    expect(invokeSkill).not.toHaveBeenCalled();
    expect(getIntervention(intervention.id)?.status).toBe('SUPERSEDED');
  });

  it('keeps gate-awaiting-human needs_human rows applicable while latest state is gate-pending', async () => {
    const intervention = openFixture('proposal-gate-awaiting-human');
    eventStore.appendEvent({
      projectId: intervention.projectId,
      workItemId: intervention.workItemId,
      kind: 'state.transitioned',
      payload: { from: 'factory:accepted', to: 'factory:gate-pending' },
    });
    const invokeSkill = vi.fn(async () =>
      skillResult({
        summary: 'Wait',
        options: [
          {
            actionType: 'no_action',
            label: 'Wait',
            description: 'Leave it open.',
            payload: { reason: 'awaiting human gate input' },
            risk: 'low',
          },
        ],
      }),
    );

    const result = await runInterventionProposerWorkerOnce({
      projectId: intervention.projectId,
      limit: 10,
      leaseOwner: 'test-proposer',
      deps: {
        invokeSkill,
        now: () => new Date('2026-05-20T00:00:00Z'),
      },
    });

    expect(result).toEqual({ processed: 1, proposed: 1, failed: 0, skipped: 0 });
    expect(invokeSkill).toHaveBeenCalledTimes(1);
    expect(getIntervention(intervention.id)?.status).toBe('PROPOSED');
  });

  it('does not starve ready interventions behind newer active leases', async () => {
    const projectId = 'proj-proposal-starvation';
    const leasedUntil = '2026-05-20T01:00:00Z';
    const projectReady = open({
      projectId,
      workItemId: 'github:owner/repo#starvation-ready',
      interventionType: 'needs_human',
      title: 'Ready',
      reason: 'Ready row should be proposed.',
      rootCauseSignature: 'needs-human|starvation-ready',
      actor: 'test',
    });
    const projectLeased = open({
      projectId,
      workItemId: 'github:owner/repo#starvation-leased',
      interventionType: 'needs_human',
      title: 'Leased',
      reason: 'Leased row should be skipped.',
      rootCauseSignature: 'needs-human|starvation-leased',
      actor: 'test',
    });
    expect(projectReady.ok).toBe(true);
    expect(projectLeased.ok).toBe(true);
    if (!projectReady.ok || !projectLeased.ok) return;
    const lease = leaseForProposal({
      id: projectLeased.intervention.id,
      expectedVersion: projectLeased.intervention.version,
      leaseOwner: 'other-worker',
      leaseExpiresAt: leasedUntil,
    });
    expect(lease.ok).toBe(true);

    const invokeSkill = vi.fn(async () =>
      skillResult({
        summary: 'Wait',
        options: [
          {
            actionType: 'no_action',
            label: 'Wait',
            description: 'Leave it open.',
            payload: { reason: 'wait' },
            risk: 'low',
          },
        ],
      }),
    );

    const result = await runInterventionProposerWorkerOnce({
      projectId,
      limit: 1,
      leaseOwner: 'test-proposer',
      deps: {
        invokeSkill,
        now: () => new Date('2026-05-20T00:00:00Z'),
        runId: () => 'run-proposal-starvation',
      },
    });

    expect(result).toEqual({ processed: 1, proposed: 1, failed: 0, skipped: 0 });
    expect(invokeSkill).toHaveBeenCalledTimes(1);
    expect(getIntervention(projectReady.intervention.id)?.status).toBe('PROPOSED');
    expect(getIntervention(projectLeased.intervention.id)?.status).toBe('OPEN');
  });

  it('filters generated test projects from global worker runs but preserves project-specific repair', async () => {
    const generated = openFixture('generated-filtered', {
      projectId: 'test-generated-filtered',
    });
    const normal = openFixture('normal-filtered', { projectId: 'proj-normal-filtered' });
    const invokeSkill = vi.fn(async () =>
      skillResult({
        summary: 'Wait',
        options: [
          {
            actionType: 'no_action',
            label: 'Wait',
            description: 'Leave it open.',
            payload: { reason: 'wait' },
            risk: 'low',
          },
        ],
      }),
    );

    const globalResult = await runInterventionProposerWorkerOnce({
      limit: 10,
      leaseOwner: 'test-proposer',
      deps: {
        invokeSkill,
        now: () => new Date('2026-05-20T00:00:00Z'),
      },
    });

    expect(globalResult).toEqual({ processed: 1, proposed: 1, failed: 0, skipped: 0 });
    expect(getIntervention(normal.id)?.status).toBe('PROPOSED');
    expect(getIntervention(generated.id)?.status).toBe('OPEN');

    const projectSpecificResult = await runInterventionProposerWorkerOnce({
      projectId: generated.projectId,
      limit: 10,
      leaseOwner: 'test-proposer',
      deps: {
        invokeSkill,
        now: () => new Date('2026-05-20T00:01:00Z'),
      },
    });

    expect(projectSpecificResult).toEqual({ processed: 1, proposed: 1, failed: 0, skipped: 0 });
    expect(getIntervention(generated.id)?.status).toBe('PROPOSED');
  });

  it('does not let generated test projects starve global non-test candidates', async () => {
    const normal = openFixture('normal-starvation-filter', {
      projectId: 'proj-normal-starvation-filter',
    });
    for (let index = 0; index < 5; index += 1) {
      openFixture(`generated-starvation-filter-${index}`, {
        projectId: `test-generated-starvation-filter-${index}`,
      });
    }
    const invokeSkill = vi.fn(async () =>
      skillResult({
        summary: 'Wait',
        options: [
          {
            actionType: 'no_action',
            label: 'Wait',
            description: 'Leave it open.',
            payload: { reason: 'wait' },
            risk: 'low',
          },
        ],
      }),
    );

    const globalResult = await runInterventionProposerWorkerOnce({
      limit: 1,
      leaseOwner: 'test-proposer',
      deps: {
        invokeSkill,
        now: () => new Date('2026-05-20T00:00:00Z'),
      },
    });

    expect(globalResult).toEqual({ processed: 1, proposed: 1, failed: 0, skipped: 0 });
    expect(getIntervention(normal.id)?.status).toBe('PROPOSED');
  });
});
