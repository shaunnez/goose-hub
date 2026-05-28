import type {
  AgentResult,
  AgentRuntime,
  AgentSpec,
} from '@goose-hub/core/agent-runtime/interface.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
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

describe('framing workflow', () => {
  it('persists framed context and routes through grounding when grilling is not needed', async () => {
    const projectId = uniqueProjectId('skip-grill');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await seedFramingIssue(source);
    const runtime = makeQueuedRuntime([featureFrameOutput(false)]);

    const result = await runFramingWorkflow({
      workItem: item,
      stateSource: source,
      projectId,
      deps: {
        runtime,
        projectConfig: { budgets: TEST_BUDGETS, stack: TEST_STACK, targetRepo: testTargetRepo('') },
      },
    });

    const specs = vi.mocked(runtime.run).mock.calls.map(([spec]) => spec as AgentSpec);
    expect(specs.map((spec) => spec.skill)).toEqual(['feature-frame']);
    const [framedEvent] = eventStore.replay({
      projectId,
      workItemId: item.id,
      kind: 'feature.framed',
      order: 'desc',
      limit: 1,
    });
    expect(framedEvent?.payload).toMatchObject({
      refinedIntent: 'Add named saved report filters.',
      stillNeedsGrilling: false,
      framedBody: `${item.body}\n\n${featureFrameOutput(false).framedContent}`,
    });
    expect(await source.getItem(item.externalId)).toMatchObject({
      state: 'factory:grounding',
      body: item.body,
    });
    expect(result.phase).toBe('prd-review');
  });

  it('routes framed work to grounding before grill-me when grilling is still needed', async () => {
    const projectId = uniqueProjectId('needs-grill');
    const source = new InMemoryLabelsSource(projectId, REPO_REF);
    const item = await seedFramingIssue(source);
    const runtime = makeQueuedRuntime([featureFrameOutput(true)]);

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
      },
    });

    const specs = vi.mocked(runtime.run).mock.calls.map(([spec]) => spec as AgentSpec);
    expect(specs.map((spec) => spec.skill)).toEqual(['feature-frame']);
    expect(specs[0]?.workspaceDir).toBe('/repo');
    const [framedEvent] = eventStore.replay({
      projectId,
      workItemId: item.id,
      kind: 'feature.framed',
      order: 'desc',
      limit: 1,
    });
    expect(framedEvent?.payload).toMatchObject({
      stillNeedsGrilling: true,
      framedBody: `${item.body}\n\n${featureFrameOutput(true).framedContent}`,
    });
    expect(await source.getItem(item.externalId)).toMatchObject({
      state: 'factory:grounding',
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
    const runtime = makeQueuedRuntime([featureFrameOutput(false)]);

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
      },
    });

    const firstSpec = vi.mocked(runtime.run).mock.calls[0]?.[0] as AgentSpec | undefined;
    expect((firstSpec?.context.workItem as { number: string }).number).toBe('PROJ-123');
  });
});
