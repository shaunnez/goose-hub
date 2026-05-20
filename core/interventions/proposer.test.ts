import { describe, expect, it, vi } from 'vitest';
import type { InvokeSkillInput, InvokeSkillResult } from '../agent-runtime/invoke-skill.js';
import { eventStore } from '../event-stream/store.js';
import { runInterventionProposerWorkerOnce } from './proposer.js';
import { open } from './reducer.js';
import { getIntervention, listInterventionEvents } from './repository.js';

function openFixture(suffix: string) {
  const result = open({
    projectId: `proj-${suffix}`,
    workItemId: `github:owner/repo#${suffix}`,
    interventionType: 'needs_human',
    title: 'Needs human',
    reason: 'Workflow asked for help',
    rootCauseSignature: `needs-human|${suffix}`,
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

  it('keeps interventions open and audits proposer output with invalid actions', async () => {
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

    const result = await runInterventionProposerWorkerOnce({
      projectId: intervention.projectId,
      limit: 10,
      leaseOwner: 'test-proposer',
      deps: {
        invokeSkill,
        now: () => new Date('2026-05-20T00:00:00Z'),
        runId: () => 'run-proposal-invalid',
      },
    });

    expect(result).toEqual({ processed: 1, proposed: 0, failed: 1, skipped: 0 });
    const current = getIntervention(intervention.id);
    expect(current?.status).toBe('OPEN');
    expect(current?.leaseOwner).toBeNull();
    expect(current?.proposedOptions).toEqual([]);
    const events = listInterventionEvents(intervention.id);
    expect(events.map((event) => event.eventType)).toEqual([
      'open',
      'leaseProposal',
      'proposalFailed',
    ]);
    expect(events.at(-1)?.payload).toEqual(
      expect.objectContaining({ error: expect.stringContaining('illegal transition') }),
    );
  });
});
