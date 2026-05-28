import type { AgentResult } from '@goose-hub/core/agent-runtime/interface.js';
/**
 * Focused unit tests for the grill-and-prd sub-modules:
 *   - withManagedWorktree  (worktree-lifecycle.ts)
 *   - runGrillRound        (grill-round.ts)
 *   - runPrdDraft          (prd-draft.ts)
 *   - runAdvisorReview     (advisor-review.ts)
 *
 * invokeSkill is mocked at the module level so tests never hit disk or the
 * real skill loader. withManagedWorktree uses injected fake impls.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PRDOutput } from '../../../skills/write-prd/schema.js';
import type { Priority } from '../../state-source/interface.js';
import type { ProjectConfig, StackConfig, TargetRepoConfig } from '../../types.js';

// ---------------------------------------------------------------------------
// Module-level mock — must be hoisted before any imports that use invokeSkill
// ---------------------------------------------------------------------------

const { mockInvokeSkill } = vi.hoisted(() => {
  return { mockInvokeSkill: vi.fn() };
});

vi.mock('../../agent-runtime/invoke-skill.js', () => {
  class OutputValidationError extends Error {
    issues: Array<{ path: Array<string | number>; message: string }>;
    runTelemetry: { runId: string; skill: string };
    constructor(
      issues: Array<{ path: Array<string | number>; message: string }>,
      skillName: string,
      runId: string,
    ) {
      super(`invokeSkill: output validation failed for '${skillName}'`);
      this.name = 'OutputValidationError';
      this.issues = issues;
      this.runTelemetry = { runId, skill: skillName };
    }
  }
  class ContextValidationError extends Error {
    issues: Array<{ path: Array<string | number>; message: string }>;
    constructor(
      issues: Array<{ path: Array<string | number>; message: string }>,
      skillName: string,
    ) {
      super(`invokeSkill: context validation failed for '${skillName}'`);
      this.name = 'ContextValidationError';
      this.issues = issues;
    }
  }
  return { invokeSkill: mockInvokeSkill, OutputValidationError, ContextValidationError };
});

import { OutputValidationError } from '../../agent-runtime/invoke-skill.js';
import { runAdvisorReview } from './advisor-review.js';
import { runGrillRound } from './grill-round.js';
import { runPrdDraft } from './prd-draft.js';
// Import after mocks are established
import { withManagedWorktree } from './worktree-lifecycle.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgentResult(output: unknown): AgentResult {
  return { output, decisionSummaries: [], events: [] };
}

function minimalGrillOutput(
  overrides: Partial<{
    questions: Array<{ text: string; recommendedAnswer?: string }>;
    refinedIntent: string;
    readyForPRD: boolean;
    crystallizedDecision: string;
    decisionSummaries: Array<{ kind: string; summary: string }>;
  }> = {},
) {
  return {
    questions: [] as Array<{ text: string; recommendedAnswer?: string }>,
    refinedIntent: 'Do the thing.',
    readyForPRD: true as boolean,
    decisionSummaries: [{ kind: 'PLAN' as const, summary: 'Ready.' }],
    ...overrides,
  };
}

function minimalPrdOutput(): PRDOutput {
  return {
    title: 'Test PRD',
    problem: 'A problem exists.',
    proposedSolution: 'Fix it.',
    outOfScope: [],
    successCriteria: ['Criterion 1'],
    acceptanceCriteria: [{ id: 'AC-1', statement: 'It works.', crossCutting: true }],
    journeys: [
      {
        id: 'J-1',
        persona: 'User',
        trigger: 'Opens app',
        steps: [
          {
            userAction: 'Click',
            systemResponse: 'Response',
            dataShown: 'Data',
            stateChange: 'Changed',
          },
        ],
        successState: 'Done',
        errorStates: [],
        edgeCases: [],
      },
    ],
    functionalSpec: {
      // biome-ignore lint/suspicious/noThenProperty: mirrors schema field from #313
      behaviors: [{ when: 'X', given: 'Y', then: 'Z' }],
      stateModel: [
        {
          state: 'idle',
          entryCondition: 'Start',
          behaviorsAvailable: ['act'],
          exitTransitions: ['done'],
        },
      ],
      invalidTransitions: [],
      dataConstraints: [],
    },
    verticalSlices: [{ title: 'S1', goal: 'Do', estimatedSize: 'S', journeyRefs: ['J-1'] }],
    estimatedComplexity: 'low',
    implementationDecisions: [{ decision: 'Use existing utilities', rationale: 'Fast' }],
    testingDecisions: { approach: 'Unit tests', modulesToTest: ['src/'] },
    decisionSummaries: [{ kind: 'PLAN', summary: 'Simple.' }],
  };
}

function minimalAdvisorOutput(
  overrides: Partial<{
    verdict: 'approve' | 'revise';
    concerns: string[];
    revisedSections: Record<string, unknown>;
    decisionSummaries: Array<{ kind: string; summary: string }>;
  }> = {},
) {
  return {
    verdict: 'approve' as 'approve' | 'revise',
    concerns: [] as string[],
    revisedSections: {} as Record<string, unknown>,
    decisionSummaries: [{ kind: 'VERDICT' as const, summary: 'Looks good.' }],
    ...overrides,
  };
}

function testWorkItem(priority: Priority = 'high') {
  return { id: 'wi-1', title: 'Test item', body: 'Body.', externalId: '42', priority };
}

function uniqueId() {
  return `test-${Math.random().toString(36).slice(2, 10)}`;
}

function projectConfigWithBudget(
  perAdvisorMaxUsd: number,
): Pick<ProjectConfig, 'budgets' | 'stack' | 'targetRepo'> {
  return {
    budgets: {
      perAdvisorMaxUsd,
      perWorkflowMaxUsd: 50,
    } as ProjectConfig['budgets'],
    stack: {
      runtime: 'node',
      packageManager: 'pnpm',
      testCommand: 'pnpm test',
      detectedAt: '2026-01-01T00:00:00Z',
    } as StackConfig,
    targetRepo: {
      cloneUrl: 'https://github.com/test/repo',
      defaultBranch: 'main',
      localPath: '/tmp/test-repo',
    } as TargetRepoConfig,
  };
}

// ---------------------------------------------------------------------------
// 1. withManagedWorktree
// ---------------------------------------------------------------------------

describe('withManagedWorktree', () => {
  it('calls body with worktree path and cleans up on success', async () => {
    const created: string[] = [];
    const cleaned: string[] = [];
    const createImpl = vi.fn((_repo: string, runId: string) => {
      const p = `/wt/${runId}`;
      created.push(p);
      return p;
    });
    const cleanupImpl = vi.fn((runId: string) => {
      cleaned.push(runId);
    });

    const bodyCalls: string[] = [];
    const result = await withManagedWorktree(
      '/repo',
      'run-1',
      async (p) => {
        bodyCalls.push(p);
        return 'ok';
      },
      () => {},
      { createWorktreeImpl: createImpl, cleanupWorktreeImpl: cleanupImpl },
    );

    expect(result).toBe('ok');
    expect(bodyCalls).toEqual(['/wt/run-1']);
    expect(createImpl).toHaveBeenCalledWith('/repo', 'run-1');
    expect(cleanupImpl).toHaveBeenCalledWith('run-1');
    expect(cleaned).toEqual(['run-1']);
  });

  it('calls cleanup in finally even when body throws', async () => {
    const cleaned: string[] = [];
    const createImpl = vi.fn((_repo: string, runId: string) => `/wt/${runId}`);
    const cleanupImpl = vi.fn((runId: string) => {
      cleaned.push(runId);
    });

    await expect(
      withManagedWorktree(
        '/repo',
        'run-throw',
        async () => {
          throw new Error('body boom');
        },
        () => {},
        { createWorktreeImpl: createImpl, cleanupWorktreeImpl: cleanupImpl },
      ),
    ).rejects.toThrow('body boom');

    expect(cleaned).toEqual(['run-throw']);
  });

  it('calls onCleanupError when cleanup fails, does not rethrow cleanup error', async () => {
    const cleanupErrors: unknown[] = [];
    const createImpl = vi.fn((_repo: string, runId: string) => `/wt/${runId}`);
    const cleanupImpl = vi.fn(() => {
      throw new Error('cleanup boom');
    });

    const result = await withManagedWorktree(
      '/repo',
      'run-cleanup-fail',
      async () => 'done',
      (err) => {
        cleanupErrors.push(err);
      },
      { createWorktreeImpl: createImpl, cleanupWorktreeImpl: cleanupImpl },
    );

    expect(result).toBe('done');
    expect(cleanupErrors).toHaveLength(1);
    expect((cleanupErrors[0] as Error).message).toBe('cleanup boom');
  });

  it('rethrows create failure without calling cleanup or body', async () => {
    const createImpl = vi.fn(() => {
      throw new Error('create boom');
    });
    const cleanupImpl = vi.fn();
    const bodyFn = vi.fn(async () => 'never');

    await expect(
      withManagedWorktree('/repo', 'run-create-fail', bodyFn, () => {}, {
        createWorktreeImpl: createImpl,
        cleanupWorktreeImpl: cleanupImpl,
      }),
    ).rejects.toThrow('create boom');

    expect(bodyFn).not.toHaveBeenCalled();
    expect(cleanupImpl).not.toHaveBeenCalled();
  });

  it('expands tilde in repoPath', async () => {
    const receivedRepos: string[] = [];
    const createImpl = vi.fn((repo: string, runId: string) => {
      receivedRepos.push(repo);
      return `/wt/${runId}`;
    });
    const cleanupImpl = vi.fn();

    const home = process.env.HOME ?? '/root';
    await withManagedWorktree(
      '~/myrepo',
      'run-tilde',
      async () => 'ok',
      () => {},
      {
        createWorktreeImpl: createImpl,
        cleanupWorktreeImpl: cleanupImpl,
      },
    );

    expect(receivedRepos[0]).toBe(`${home}/myrepo`);
  });
});

// ---------------------------------------------------------------------------
// 2. runGrillRound
// ---------------------------------------------------------------------------

describe('runGrillRound', () => {
  beforeEach(() => {
    mockInvokeSkill.mockReset();
  });

  function baseInput() {
    return {
      workItem: testWorkItem(),
      projectId: uniqueId(),
      workItemId: 'wi-1',
      runId: 'run-grill-1',
      workflowRunId: 'wf-1',
      discoverSessionId: 'discover-session-1',
      worktreePath: '/wt/run-1',
      priorReplies: [] as Array<{ role: 'user' | 'agent'; content: string }>,
      projectContext: { stackSummary: '', contextMd: '', adrSummaries: [], claudeMd: '' },
    };
  }

  it('returns question outcome when readyForPRD is false and question is present', async () => {
    mockInvokeSkill.mockResolvedValueOnce(
      makeAgentResult(
        minimalGrillOutput({
          readyForPRD: false,
          questions: [{ text: 'What metric?', recommendedAnswer: 'Conversion rate.' }],
          refinedIntent: 'Improve something.',
        }),
      ),
    );

    const result = await runGrillRound(baseInput());

    expect(result.status).toBe('question');
    if (result.status === 'question') {
      expect(result.question).toBe('What metric?');
      expect(result.recommendedAnswer).toBe('Conversion rate.');
    }
  });

  it('returns ready outcome when readyForPRD is true', async () => {
    mockInvokeSkill.mockResolvedValueOnce(
      makeAgentResult(minimalGrillOutput({ readyForPRD: true, refinedIntent: 'Final intent.' })),
    );

    const result = await runGrillRound(baseInput());

    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.refinedIntent).toBe('Final intent.');
    }
  });

  it('passes feature grounding digest into grill-me context', async () => {
    mockInvokeSkill.mockResolvedValueOnce(
      makeAgentResult(minimalGrillOutput({ readyForPRD: true, refinedIntent: 'Final intent.' })),
    );

    await runGrillRound({
      ...baseInput(),
      codeGrounding: {
        groundingRunId: 'grounding-run',
        existingSurfaces: ['core/workflows/grill-and-prd.ts'],
      },
      scoutDigest: { reports: [{ scoutName: 'scout-code-path' }] },
    });

    expect(mockInvokeSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          codeGrounding: expect.objectContaining({ groundingRunId: 'grounding-run' }),
          scoutDigest: { reports: [{ scoutName: 'scout-code-path' }] },
        }),
      }),
    );
  });

  it('returns invalid when output has readyForPRD:false with no questions', async () => {
    mockInvokeSkill.mockResolvedValueOnce(
      makeAgentResult(minimalGrillOutput({ readyForPRD: false, questions: [] })),
    );

    const result = await runGrillRound(baseInput());

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.error).toContain('readyForPRD:false with no questions');
    }
  });

  it('forces ready at round 8 (roundNumber > 7)', async () => {
    const priorReplies = Array.from({ length: 14 }, (_, i) =>
      i % 2 === 0
        ? { role: 'agent' as const, content: `Round ${Math.floor(i / 2) + 1}` }
        : { role: 'user' as const, content: `Answer ${Math.floor(i / 2) + 1}` },
    );
    mockInvokeSkill.mockResolvedValueOnce(
      makeAgentResult(
        minimalGrillOutput({
          readyForPRD: false,
          questions: [{ text: 'Still asking?' }],
          refinedIntent: 'Partially refined.',
        }),
      ),
    );

    const result = await runGrillRound({ ...baseInput(), priorReplies });

    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.refinedIntent).toBe('Partially refined.');
    }
  });

  it('returns failed on runtime error', async () => {
    mockInvokeSkill.mockRejectedValueOnce(new Error('network failure'));

    const result = await runGrillRound(baseInput());

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error).toContain('network failure');
    }
  });

  it('returns invalid on OutputValidationError', async () => {
    mockInvokeSkill.mockRejectedValueOnce(
      new OutputValidationError(
        [{ path: ['questions'], message: 'Required' }],
        'grill-me',
        'run-1',
      ),
    );

    const result = await runGrillRound(baseInput());

    expect(result.status).toBe('invalid');
  });
});

// ---------------------------------------------------------------------------
// 3. runPrdDraft
// ---------------------------------------------------------------------------

describe('runPrdDraft', () => {
  beforeEach(() => {
    mockInvokeSkill.mockReset();
  });

  function baseInput() {
    return {
      workItem: testWorkItem(),
      projectId: uniqueId(),
      workItemId: 'wi-1',
      runId: 'run-prd-1',
      workflowRunId: 'wf-1',
      discoverSessionId: 'discover-session-1',
      refinedIntent: 'Do the thing.',
      fullProjectContext: { stackSummary: '', contextMd: '', adrSummaries: [], claudeMd: '' },
    };
  }

  it('returns ok with prdOutput on success', async () => {
    mockInvokeSkill.mockResolvedValueOnce(makeAgentResult(minimalPrdOutput()));

    const result = await runPrdDraft(baseInput());

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.prdOutput.title).toBe('Test PRD');
    }
  });

  it('passes feature grounding digest into write-prd context', async () => {
    mockInvokeSkill.mockResolvedValueOnce(makeAgentResult(minimalPrdOutput()));

    await runPrdDraft({
      ...baseInput(),
      codeGrounding: {
        groundingRunId: 'grounding-run',
        plannedFiles: ['apps/web/src/features/new-flow/view.tsx'],
      },
      scoutDigest: { reports: [{ scoutName: 'scout-pattern' }] },
    });

    expect(mockInvokeSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          codeGrounding: expect.objectContaining({ groundingRunId: 'grounding-run' }),
          scoutDigest: { reports: [{ scoutName: 'scout-pattern' }] },
        }),
      }),
    );
  });

  it('returns invalid when output parse fails', async () => {
    mockInvokeSkill.mockResolvedValueOnce(makeAgentResult({ title: 'incomplete' }));

    const result = await runPrdDraft(baseInput());

    expect(result.status).toBe('invalid');
  });

  it('preserves formatted output validation issues', async () => {
    mockInvokeSkill.mockRejectedValueOnce(
      new OutputValidationError(
        [
          {
            path: ['acceptanceCriteria', 0],
            message: 'acceptanceCriteria[0] has no journeyId and is not marked crossCutting:true',
          },
        ],
        'write-prd',
        'run-prd-1',
      ),
    );

    const result = await runPrdDraft(baseInput());

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.error).toBe("invokeSkill: output validation failed for 'write-prd'");
      expect(result.issues).toEqual([
        'acceptanceCriteria.0: acceptanceCriteria[0] has no journeyId and is not marked crossCutting:true',
      ]);
    }
  });

  it('returns failed on runtime error', async () => {
    mockInvokeSkill.mockRejectedValueOnce(new Error('timeout'));

    const result = await runPrdDraft(baseInput());

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error).toContain('timeout');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. runAdvisorReview
// ---------------------------------------------------------------------------

describe('runAdvisorReview', () => {
  beforeEach(() => {
    mockInvokeSkill.mockReset();
  });

  function baseInput(): Parameters<typeof runAdvisorReview>[0] {
    return {
      workItem: testWorkItem('high'),
      projectId: uniqueId(),
      workItemId: 'wi-1',
      runId: 'run-advisor-1',
      workflowRunId: 'wf-1',
      discoverSessionId: 'discover-session-1',
      prdOutput: minimalPrdOutput(),
      projectConfig: projectConfigWithBudget(10),
      totalSpendForSkill: vi.fn().mockReturnValue(0),
    };
  }

  it('returns skipped with reason priority for low-priority item', async () => {
    const result = await runAdvisorReview({ ...baseInput(), workItem: testWorkItem('low') });

    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reason).toBe('priority');
    }
    expect(mockInvokeSkill).not.toHaveBeenCalled();
  });

  it('returns skipped with reason budget when budget exceeded', async () => {
    // FALLBACK_ADVISOR_BUDGET.maxBudgetUsd = 1.0; totalSpend = 9.5; perAdvisorMaxUsd = 10
    // 9.5 + 1.0 = 10.5 > 10 → skip
    const result = await runAdvisorReview({
      ...baseInput(),
      projectConfig: projectConfigWithBudget(10),
      totalSpendForSkill: vi.fn().mockReturnValue(9.5),
    });

    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reason).toBe('budget');
    }
    expect(mockInvokeSkill).not.toHaveBeenCalled();
  });

  it('returns ok with merged revisedSections and concerns', async () => {
    mockInvokeSkill.mockResolvedValueOnce(
      makeAgentResult(
        minimalAdvisorOutput({
          verdict: 'revise',
          concerns: ['Needs more detail.'],
          revisedSections: { problem: 'Revised problem statement.' },
          decisionSummaries: [{ kind: 'VERDICT', summary: 'Revised.' }],
        }),
      ),
    );

    const result = await runAdvisorReview(baseInput());

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect((result.prdOutput as { problem: string }).problem).toBe('Revised problem statement.');
      expect(result.concerns).toEqual(['Needs more detail.']);
    }
  });

  it('returns ok with null concerns when advisor returns empty concerns', async () => {
    mockInvokeSkill.mockResolvedValueOnce(
      makeAgentResult(
        minimalAdvisorOutput({ verdict: 'approve', concerns: [], revisedSections: {} }),
      ),
    );

    const result = await runAdvisorReview(baseInput());

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.concerns).toBeNull();
    }
  });

  it('returns invalid on output parse failure', async () => {
    mockInvokeSkill.mockResolvedValueOnce(makeAgentResult({ verdict: 'unknown' }));

    const result = await runAdvisorReview(baseInput());

    expect(result.status).toBe('invalid');
  });

  it('returns failed on runtime error', async () => {
    mockInvokeSkill.mockRejectedValueOnce(new Error('advisor crash'));

    const result = await runAdvisorReview(baseInput());

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error).toContain('advisor crash');
    }
  });
});
