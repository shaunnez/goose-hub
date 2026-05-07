import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunReviewWorkflow } = vi.hoisted(() => ({ mockRunReviewWorkflow: vi.fn() }));
const { mockGetSourceForSlug } = vi.hoisted(() => ({ mockGetSourceForSlug: vi.fn() }));

vi.mock('#shared/source.js', () => ({ getSourceForSlug: mockGetSourceForSlug }));

vi.mock(new URL('../../../../../slices/review/workflow.js', import.meta.url).href, () => ({
  runReviewWorkflow: mockRunReviewWorkflow,
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
    state: 'factory:needs-review',
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
    getPrDiff: vi.fn().mockResolvedValue(''),
    watchForUpdates: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runReviewBatch', () => {
  it('throws "Project not found" when no source can be resolved', async () => {
    mockGetSourceForSlug.mockResolvedValue(null);
    const { runReviewBatch } = await import('./review-batch.js');
    await expect(runReviewBatch('missing-slug')).rejects.toThrow(/Project not found: missing-slug/);
    expect(mockRunReviewWorkflow).not.toHaveBeenCalled();
  });

  it('uses the explicit source argument when provided', async () => {
    const source = makeMockSource([]);
    const { runReviewBatch } = await import('./review-batch.js');
    await runReviewBatch('any-slug', source);
    expect(mockGetSourceForSlug).not.toHaveBeenCalled();
  });

  it('only runs the workflow on items in factory:needs-review state', async () => {
    const items = [
      makeWorkItem({ externalId: '1', state: 'factory:needs-review' }),
      makeWorkItem({ externalId: '2', state: 'factory:needs-qa' }),
      makeWorkItem({ externalId: '3', state: 'factory:needs-review' }),
    ];
    const source = makeMockSource(items);
    const { runReviewBatch } = await import('./review-batch.js');
    await runReviewBatch('goose-hub-self', source);
    expect(mockRunReviewWorkflow).toHaveBeenCalledTimes(2);
  });

  it('falls back to slug when item.repoRef is missing', async () => {
    const item = makeWorkItem({ repoRef: undefined });
    const source = makeMockSource([item]);
    const { runReviewBatch } = await import('./review-batch.js');
    await runReviewBatch('fallback-slug', source);
    expect(mockRunReviewWorkflow).toHaveBeenCalledWith(
      item,
      source,
      source.projectId,
      'fallback-slug',
    );
  });
});
