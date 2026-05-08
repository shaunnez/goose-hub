import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunQaWorkflow } = vi.hoisted(() => ({ mockRunQaWorkflow: vi.fn() }));
const { mockGetSourceForSlug } = vi.hoisted(() => ({ mockGetSourceForSlug: vi.fn() }));

vi.mock('#shared/source.js', () => ({ getSourceForSlug: mockGetSourceForSlug }));

// Cross-package import via URL — intercept the dynamic import.
vi.mock(new URL('../../../../../slices/qa/workflow.js', import.meta.url).href, () => ({
  runQaWorkflow: mockRunQaWorkflow,
}));

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:org/repo#1',
    externalId: '1',
    repoRef: 'org/repo',
    title: 'Test',
    body: '',
    type: 'bug',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:needs-qa',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date(),
    ...overrides,
  };
}

function makeMockSource(items: WorkItem[]): StateSource {
  return {
    projectId: 'goose-hub-self',
    repoRef: 'shaunnez/goose-hub',
    listOpenWork: vi.fn().mockResolvedValue(items),
    listClosedWorkByMilestone: vi.fn().mockResolvedValue([]),
    listWorkByMilestone: vi.fn().mockResolvedValue([]),
    getItem: vi.fn(),
    listMilestones: vi.fn().mockResolvedValue([]),
    getActiveMilestone: vi.fn().mockResolvedValue(null),
    transitionState: vi.fn(),
    forceState: vi.fn(),
    comment: vi.fn(),
    listComments: vi.fn().mockResolvedValue([]),
    setMilestone: vi.fn(),
    setLabelInGroup: vi.fn(),
    attach: vi.fn(),
    createIssue: vi.fn(),
    createMilestone: vi.fn(),
    updateMilestone: vi.fn(),
    deleteMilestone: vi.fn(),
    getPrDiff: vi.fn().mockResolvedValue(''),
    addLabels: vi.fn(),
    removeLabel: vi.fn(),
    listLabels: vi.fn().mockResolvedValue([]),
    watchForUpdates: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runQaBatch', () => {
  it('throws "Project not found" when no source can be resolved', async () => {
    mockGetSourceForSlug.mockResolvedValue(null);
    const { runQaBatch } = await import('./qa-batch.js');
    await expect(runQaBatch('missing-slug')).rejects.toThrow(/Project not found: missing-slug/);
    expect(mockRunQaWorkflow).not.toHaveBeenCalled();
  });

  it('uses the explicit source argument when provided (skips getSourceForSlug)', async () => {
    const source = makeMockSource([]);
    const { runQaBatch } = await import('./qa-batch.js');
    await runQaBatch('any-slug', source);
    expect(mockGetSourceForSlug).not.toHaveBeenCalled();
  });

  it('only runs the workflow on items in factory:needs-qa state', async () => {
    const items = [
      makeWorkItem({ externalId: '1', state: 'factory:needs-qa' }),
      makeWorkItem({ externalId: '2', state: 'factory:in-progress' }),
      makeWorkItem({ externalId: '3', state: 'factory:needs-qa' }),
    ];
    const source = makeMockSource(items);
    const { runQaBatch } = await import('./qa-batch.js');
    await runQaBatch('goose-hub-self', source);
    expect(mockRunQaWorkflow).toHaveBeenCalledTimes(2);
  });

  it('falls back to slug when item.repoRef is missing', async () => {
    const item = makeWorkItem({ repoRef: undefined });
    const source = makeMockSource([item]);
    const { runQaBatch } = await import('./qa-batch.js');
    await runQaBatch('fallback-slug', source);
    expect(mockRunQaWorkflow).toHaveBeenCalledWith(item, source, source.projectId, 'fallback-slug');
  });
});
