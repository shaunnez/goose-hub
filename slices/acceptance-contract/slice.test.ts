import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runAcceptanceContractWorkflow } from './workflow.js';

const { appendEvent, replay, runtimeRun } = vi.hoisted(() => ({
  appendEvent: vi.fn((event) => ({ ...event, id: 1, createdAt: '2026-05-21T00:00:00Z' })),
  replay: vi.fn(),
  runtimeRun: vi.fn(),
}));

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: { replay, appendEvent },
}));

vi.mock('@goose-hub/core/agent-runtime/resolve-runtime-for-project.js', () => ({
  resolveProjectAgentExecution: () => ({
    runtime: { run: runtimeRun },
    resolvedBudget: { budgets: { maxTurns: 5, maxBudgetUsd: 1, timeoutMs: 1000 } },
  }),
}));

vi.mock('@goose-hub/core/agent-runtime/select-persona.js', () => ({
  selectPersona: () => ({ personaId: 'goose/developer/0' }),
}));

vi.mock('@goose-hub/core/projects/loader.js', () => ({
  getProjectBySlug: () => null,
}));

vi.mock('@goose-hub/core/agent-runtime/read-prompt.js', () => ({
  readPromptWithContext: () => 'prompt',
}));

vi.mock('@goose-hub/core/agent-runtime/reconcile-decisions.js', () => ({
  reconcileDecisionSummaries: vi.fn(),
}));

const workItem: WorkItem = {
  id: 'github:o/r#1',
  externalId: '1',
  repoRef: 'o/r',
  title: 'Fix ordering',
  body: 'Expected newest first',
  type: 'bug',
  priority: 'medium',
  mode: 'supervised',
  state: 'factory:investigation-complete',
  authorIsOwner: true,
  schedule: 'current',
  exec: 'serial',
  dependsOn: [],
  blocks: [],
  createdAt: new Date(),
};

describe('acceptance-contract workflow', () => {
  beforeEach(() => {
    replay.mockReturnValue([
      {
        payload: {
          investigate: {
            findings: 'The sort comparator is reversed',
            keyFiles: [{ path: 'apps/web/src/lib/lanes.config.ts' }],
            openQuestions: [],
            confidence: 'high',
          },
        },
      },
    ]);
    appendEvent.mockClear();
    runtimeRun.mockReset();
  });

  it('invokes the skill and emits acceptance.contract-authored when no checkbox ACs exist', async () => {
    runtimeRun.mockResolvedValue({
      output: {
        criteria: [{ id: 'AC-1', statement: 'Cards sort newest first' }],
        issueBodyPatchRecommended: true,
        decisionSummaries: [{ kind: 'PLAN', summary: 'Authored contract' }],
      },
    });

    const contract = await runAcceptanceContractWorkflow(workItem, {} as never, 'goose', 'repo');

    expect(runtimeRun).toHaveBeenCalledWith(
      expect.objectContaining({ skill: 'acceptance-contract' }),
    );
    expect(contract.criteria[0].statement).toBe('Cards sort newest first');
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'acceptance.contract-authored',
        payload: expect.objectContaining({ criteriaCount: 1 }),
      }),
    );
  });

  it('mirrors existing checkbox ACs without spawning the skill', async () => {
    const itemWithAcs = {
      ...workItem,
      body: '- [ ] Cards sort newest first\n      Verify: pnpm test\n      Expected: pass\n      Tolerance: exact',
    };

    const contract = await runAcceptanceContractWorkflow(itemWithAcs, {} as never, 'goose', 'repo');

    expect(runtimeRun).not.toHaveBeenCalled();
    expect(contract.criteria[0]).toMatchObject({
      statement: 'Cards sort newest first',
      executableChecks: [{ command: 'pnpm test' }],
    });
  });

  it('normalizes nullable optional fields returned by Codex response schemas', async () => {
    runtimeRun.mockResolvedValue({
      output: {
        criteria: [
          {
            id: 'AC-1',
            statement: 'Cards sort newest first',
          },
        ],
        issueBodyPatchRecommended: true,
        decisionSummaries: [{ kind: 'PLAN', summary: 'Authored contract' }],
      },
    });

    const contract = await runAcceptanceContractWorkflow(workItem, {} as never, 'goose', 'repo');

    expect(contract.criteria[0]).toEqual({
      id: 'AC-1',
      statement: 'Cards sort newest first',
      sourceRef: 'acceptance-contract',
    });
  });
});
