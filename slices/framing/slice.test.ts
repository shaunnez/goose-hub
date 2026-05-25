import type {
  AgentResult,
  AgentRuntime,
  AgentSpec,
} from '@goose-hub/core/agent-runtime/interface.js';
import { InMemoryLabelsSource } from '@goose-hub/core/state-source/in-memory-labels.js';
import type { StateSource } from '@goose-hub/core/state-source/interface.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import type { BudgetConfig, StackConfig, TargetRepoConfig } from '@goose-hub/core/types.js';
import { describe, expect, it, vi } from 'vitest';
import { runFramingWorkflow } from './workflow.js';

const REPO_REF = 'test-owner/test-repo';
const TEST_BUDGETS = {
  dailyTokens: 1_000_000,
  maxParallelAgents: 1,
  maxRetries: 1,
  perBashCommandMaxSeconds: 30,
  perWorkflowMaxUsd: 20,
  perAgentMaxUsd: 10,
  perAdvisorMaxUsd: 10,
} satisfies BudgetConfig;
const TEST_STACK = {
  runtime: 'node',
  packageManager: 'pnpm',
  testCommand: 'pnpm test',
  detectedAt: '2026-05-25T00:00:00Z',
} satisfies StackConfig;
const testTargetRepo = (localPath: string) =>
  ({
    cloneUrl: 'git@example.com:test-owner/test-repo.git',
    defaultBranch: 'main',
    localPath,
  }) satisfies TargetRepoConfig;

function uniqueProjectId(label: string): string {
  return `test-framing-${label}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeQueuedRuntime(outputs: unknown[]): AgentRuntime {
  let i = 0;
  return {
    run: vi.fn().mockImplementation(async () => {
      const output = outputs[i];
      i += 1;
      if (output == null) throw new Error(`makeQueuedRuntime: out of outputs at call ${i}`);
      return { output, decisionSummaries: [], events: [] } satisfies AgentResult;
    }),
  };
}

async function seedFramingIssue(source: InMemoryLabelsSource): Promise<WorkItem> {
  return source.seedIssue({
    title: 'Saved reports',
    body: 'Let users save report filters somehow.',
    type: 'feature',
    priority: 'medium',
    state: 'factory:framing',
  });
}

function fakeStateSource(projectId: string): StateSource {
  return {
    projectId,
    repoRef: REPO_REF,
    transitionState: vi.fn().mockResolvedValue(undefined),
    forceState: vi.fn().mockResolvedValue(undefined),
    comment: vi.fn().mockResolvedValue(undefined),
    listComments: vi.fn().mockResolvedValue([]),
  } as unknown as StateSource;
}

function featureFrameOutput(stillNeedsGrilling: boolean) {
  return {
    framedContent:
      '## Framed feature intent\nUsers need named saved report filters.\n\n## Proposed acceptance criteria\n- A user can save current filters with a readable name.',
    refinedIntent: 'Add named saved report filters.',
    proposedAcceptanceCriteria: ['A user can save current filters with a readable name.'],
    stillNeedsGrilling,
    decisionSummaries: [
      {
        kind: 'PLAN',
        summary: stillNeedsGrilling
          ? 'Framed the saved reports request but left audience and retention rules unresolved.'
          : 'Framed the saved reports request sufficiently for PRD drafting.',
        evidence: 'The work item names reports and filters.',
      },
    ],
  };
}

function validGrillQuestion() {
  return {
    questions: [
      {
        text: 'Who can see another user saved report?',
        recommendedAnswer: 'Saved reports are private to the creator for the first version.',
      },
    ],
    refinedIntent: 'Add named saved report filters.',
    readyForPRD: false,
    decisionSummaries: [
      {
        kind: 'PLAN',
        summary: 'Asked about saved report visibility before PRD drafting.',
        evidence: 'The framed content does not define sharing behavior.',
      },
    ],
  };
}

function validPrdOutput() {
  return {
    title: 'Saved report filters',
    problem: 'Users repeat report filter setup because saved filtered views do not exist.',
    proposedSolution: 'Allow users to save, reopen, and manage named report filter sets.',
    outOfScope: ['Sharing saved reports between users'],
    successCriteria: ['Users can reopen a saved report without rebuilding filters.'],
    acceptanceCriteria: [
      {
        id: 'AC-1',
        statement: 'A user can save current report filters with a readable name.',
        journeyId: 'J-1',
        stepIdx: 1,
      },
    ],
    journeys: [
      {
        id: 'J-1',
        persona: 'Operator',
        trigger: 'Needs to reuse a filtered report',
        steps: [
          {
            userAction: 'Saves current filters',
            systemResponse: 'Stores the named report',
            dataShown: 'Saved report name',
            stateChange: 'Saved report exists',
          },
        ],
        successState: 'The report can be reopened later.',
        errorStates: [{ error: 'Duplicate name', recovery: 'Ask for a different name.' }],
        edgeCases: ['Deleted filter values are ignored when reopening.'],
      },
    ],
    functionalSpec: {
      behaviors: [
        {
          when: 'saving filters',
          given: 'the report has active filters',
          // biome-ignore lint/suspicious/noThenProperty: schema mirrors when/given/then doctrine from #313
          then: 'Factory stores a named saved report for the user',
        },
      ],
      stateModel: [
        {
          state: 'editing-report-filters',
          entryCondition: 'User is on the reports page',
          behaviorsAvailable: ['save filters'],
          exitTransitions: ['saved-report-created'],
        },
      ],
      invalidTransitions: [
        { from: 'empty-name', to: 'saved-report-created', reason: 'Name is required.' },
      ],
      dataConstraints: [{ type: 'name', validation: 'Required and unique per user.' }],
    },
    verticalSlices: [
      {
        title: 'Saved report creation',
        goal: 'Store named filter sets from the reports page.',
        estimatedSize: 'M',
        journeyRefs: ['J-1'],
      },
    ],
    estimatedComplexity: 'medium',
    implementationDecisions: [
      {
        decision: 'Keep saved reports private in the first version.',
        rationale: 'Sharing is out of scope.',
      },
    ],
    testingDecisions: {
      approach: 'Cover save and reopen behavior through workflow-facing tests.',
      modulesToTest: ['slices/framing/slice.test.ts'],
    },
    decisionSummaries: [
      {
        kind: 'PLAN',
        summary: 'Drafted the PRD from the framed saved reports intent.',
        evidence: 'feature-frame returned stillNeedsGrilling false.',
      },
    ],
  };
}

describe('framing workflow', () => {
  it('routes framed work straight through the existing skip-grill PRD path when grilling is not needed', async () => {
    const projectId = uniqueProjectId('skip-grill');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await seedFramingIssue(source);
    const runtime = makeQueuedRuntime([featureFrameOutput(false), validPrdOutput()]);

    const result = await runFramingWorkflow({
      workItem: item,
      stateSource: source,
      projectId,
      deps: {
        runtime,
        projectConfig: { budgets: TEST_BUDGETS, stack: TEST_STACK, targetRepo: testTargetRepo('') },
        buildContext: async () => ({
          stackSummary: '',
          contextMd: '',
          adrSummaries: [],
          claudeMd: '',
        }),
      },
    });

    const specs = vi.mocked(runtime.run).mock.calls.map(([spec]) => spec as AgentSpec);
    expect(specs.map((spec) => spec.skill)).toEqual(['feature-frame', 'write-prd']);
    expect(specs[1]?.context.refinedIntent).toBe('Add named saved report filters.');
    expect((specs[1]?.context.workItem as { body: string }).body).toBe(
      `${item.body}\n\n${featureFrameOutput(false).framedContent}`,
    );
    expect(await source.getItem(item.externalId)).toMatchObject({
      state: 'factory:prd-review',
      body: item.body,
    });
    expect(result.phase).toBe('prd-review');
  });

  it('routes to grill-me with the augmented in-memory body when grilling is still needed', async () => {
    const projectId = uniqueProjectId('needs-grill');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await seedFramingIssue(source);
    const runtime = makeQueuedRuntime([featureFrameOutput(true), validGrillQuestion()]);

    const result = await runFramingWorkflow({
      workItem: item,
      stateSource: source,
      projectId,
      deps: {
        runtime,
        projectConfig: {
          budgets: TEST_BUDGETS,
          stack: TEST_STACK,
          targetRepo: testTargetRepo('/repo'),
        },
        buildContext: async () => ({
          stackSummary: '',
          contextMd: '',
          adrSummaries: [],
          claudeMd: '',
        }),
        createWorktreeImpl: () => '/mock/worktree',
        cleanupWorktreeImpl: () => undefined,
      },
    });

    const specs = vi.mocked(runtime.run).mock.calls.map(([spec]) => spec as AgentSpec);
    expect(specs.map((spec) => spec.skill)).toEqual(['feature-frame', 'grill-me']);
    expect(specs[0]?.workspaceDir).toBe('/repo');
    expect((specs[1]?.context.workItem as { body: string }).body).toBe(
      `${item.body}\n\n${featureFrameOutput(true).framedContent}`,
    );
    expect(await source.getItem(item.externalId)).toMatchObject({
      state: 'factory:gate-pending',
      body: item.body,
    });
    expect(result.phase).toBe('grilling');
  });

  it('preserves non-numeric external IDs in feature-frame workItem context', async () => {
    const projectId = uniqueProjectId('string-external-id');
    const item: WorkItem = {
      id: 'linear:test/feature#PROJ-123',
      externalId: 'PROJ-123',
      repoRef: REPO_REF,
      title: 'Saved reports',
      body: 'Let users save report filters somehow.',
      type: 'feature',
      priority: 'medium',
      mode: 'supervised',
      state: 'factory:framing',
      authorIsOwner: true,
      schedule: 'current',
      exec: 'serial',
      dependsOn: [],
      blocks: [],
      createdAt: new Date('2026-05-25T00:00:00Z'),
    };
    const runtime = makeQueuedRuntime([featureFrameOutput(false), validPrdOutput()]);

    await runFramingWorkflow({
      workItem: item,
      stateSource: fakeStateSource(projectId),
      projectId,
      deps: {
        runtime,
        projectConfig: {
          budgets: TEST_BUDGETS,
          stack: TEST_STACK,
          targetRepo: testTargetRepo('/repo'),
        },
        buildContext: async () => ({
          stackSummary: '',
          contextMd: '',
          adrSummaries: [],
          claudeMd: '',
        }),
      },
    });

    const firstSpec = vi.mocked(runtime.run).mock.calls[0]?.[0] as AgentSpec | undefined;
    expect((firstSpec?.context.workItem as { number: string }).number).toBe('PROJ-123');
  });
});
