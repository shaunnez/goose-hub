import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── sprint-review mock ────────────────────────────────────────────────────────

const mockRunSprintReviewWorkflow = vi.fn();
vi.mock('@goose-hub/core/workflows/sprint-review.js', () => ({
  runSprintReviewWorkflow: mockRunSprintReviewWorkflow,
}));

vi.mock('@goose-hub/core/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:shaunnez/goose-hub#42',
    externalId: '42',
    repoRef: 'shaunnez/goose-hub',
    title: 'Test item',
    body: '',
    type: 'feature',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:done',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date(),
    milestoneId: '13',
    milestoneTitle: 'M13: Subagents',
    ...overrides,
  };
}

function makeStateSource(milestoneItems: WorkItem[]): StateSource {
  return {
    projectId: 'goose-hub-self',
    repoRef: 'shaunnez/goose-hub',
    listOpenWork: vi.fn().mockResolvedValue([]),
    listClosedWorkByMilestone: vi.fn().mockResolvedValue([]),
    listWorkByMilestone: vi.fn().mockResolvedValue(milestoneItems),
    getItem: vi.fn(),
    listMilestones: vi.fn().mockResolvedValue([]),
    getActiveMilestone: vi.fn().mockResolvedValue(null),
    transitionState: vi.fn().mockResolvedValue(undefined),
    forceState: vi.fn().mockResolvedValue(undefined),
    comment: vi.fn().mockResolvedValue(undefined),
    listComments: vi.fn().mockResolvedValue([]),
    setMilestone: vi.fn().mockResolvedValue(undefined),
    setLabelInGroup: vi.fn().mockResolvedValue(undefined),
    attach: vi.fn().mockResolvedValue(undefined),
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

const SLUG = 'goose-hub-self';
const MILESTONE_NUMBER = 13;
const MILESTONE_TITLE = 'M13: Subagents';

beforeEach(() => {
  vi.clearAllMocks();
  mockRunSprintReviewWorkflow.mockResolvedValue({ issueNumber: 200 });
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('maybeFireSprintReview', () => {
  it('triggers sprint-review when the last schedule:current item reaches factory:done', async () => {
    const doneItem = makeWorkItem({ state: 'factory:done' });
    const source = makeStateSource([doneItem]);

    const { maybeFireSprintReview } = await import('./sprint-review-trigger.js');
    await maybeFireSprintReview(SLUG, MILESTONE_NUMBER, MILESTONE_TITLE, source);

    expect(mockRunSprintReviewWorkflow).toHaveBeenCalledOnce();
    expect(mockRunSprintReviewWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: SLUG,
        milestoneTitle: MILESTONE_TITLE,
        milestoneNumber: MILESTONE_NUMBER,
      }),
    );
  });

  it('triggers sprint-review when the last schedule:current item reaches factory:archived', async () => {
    const archivedItem = makeWorkItem({ state: 'factory:archived' });
    const source = makeStateSource([archivedItem]);

    const { maybeFireSprintReview } = await import('./sprint-review-trigger.js');
    await maybeFireSprintReview(SLUG, MILESTONE_NUMBER, MILESTONE_TITLE, source);

    expect(mockRunSprintReviewWorkflow).toHaveBeenCalledOnce();
  });

  it('triggers sprint-review when the last schedule:current item reaches factory:rejected', async () => {
    const rejectedItem = makeWorkItem({ state: 'factory:rejected' });
    const source = makeStateSource([rejectedItem]);

    const { maybeFireSprintReview } = await import('./sprint-review-trigger.js');
    await maybeFireSprintReview(SLUG, MILESTONE_NUMBER, MILESTONE_TITLE, source);

    expect(mockRunSprintReviewWorkflow).toHaveBeenCalledOnce();
  });

  it('triggers sprint-review when items are a mix of done/archived/rejected (all terminal)', async () => {
    const doneItem = makeWorkItem({ externalId: '42', state: 'factory:done' });
    const archivedItem = makeWorkItem({ externalId: '43', state: 'factory:archived' });
    const rejectedItem = makeWorkItem({ externalId: '44', state: 'factory:rejected' });
    const source = makeStateSource([doneItem, archivedItem, rejectedItem]);

    const { maybeFireSprintReview } = await import('./sprint-review-trigger.js');
    await maybeFireSprintReview(SLUG, MILESTONE_NUMBER, MILESTONE_TITLE, source);

    expect(mockRunSprintReviewWorkflow).toHaveBeenCalledOnce();
  });

  it('does NOT trigger sprint-review when some schedule:current items are still open', async () => {
    const doneItem = makeWorkItem({ externalId: '42', state: 'factory:done' });
    const pendingItem = makeWorkItem({ externalId: '43', state: 'factory:needs-qa' });
    const source = makeStateSource([doneItem, pendingItem]);

    const { maybeFireSprintReview } = await import('./sprint-review-trigger.js');
    await maybeFireSprintReview(SLUG, MILESTONE_NUMBER, MILESTONE_TITLE, source);

    expect(mockRunSprintReviewWorkflow).not.toHaveBeenCalled();
  });

  it('does NOT trigger sprint-review when no schedule:current items exist (empty milestone)', async () => {
    const backlogItem = makeWorkItem({ state: 'factory:done', schedule: 'later' });
    const source = makeStateSource([backlogItem]);

    const { maybeFireSprintReview } = await import('./sprint-review-trigger.js');
    await maybeFireSprintReview(SLUG, MILESTONE_NUMBER, MILESTONE_TITLE, source);

    expect(mockRunSprintReviewWorkflow).not.toHaveBeenCalled();
  });

  it('does NOT trigger sprint-review when sprint-review issue already exists (dedup / idempotent)', async () => {
    const doneItem = makeWorkItem({ state: 'factory:done' });
    const sprintReviewIssue = makeWorkItem({
      externalId: '200',
      title: `Sprint Review: ${MILESTONE_TITLE}`,
      state: 'factory:done',
    });
    const source = makeStateSource([doneItem, sprintReviewIssue]);

    const { maybeFireSprintReview } = await import('./sprint-review-trigger.js');
    await maybeFireSprintReview(SLUG, MILESTONE_NUMBER, MILESTONE_TITLE, source);

    expect(mockRunSprintReviewWorkflow).not.toHaveBeenCalled();
  });

  it('is idempotent — calling twice does not produce two sprint-review issues', async () => {
    const doneItem = makeWorkItem({ state: 'factory:done' });

    // First call: no existing sprint-review issue.
    const sourceFirstCall = makeStateSource([doneItem]);
    const { maybeFireSprintReview } = await import('./sprint-review-trigger.js');
    await maybeFireSprintReview(SLUG, MILESTONE_NUMBER, MILESTONE_TITLE, sourceFirstCall);
    expect(mockRunSprintReviewWorkflow).toHaveBeenCalledTimes(1);

    // Second call: simulate that the sprint-review issue now exists.
    const sprintReviewIssue = makeWorkItem({
      externalId: '200',
      title: `Sprint Review: ${MILESTONE_TITLE}`,
      state: 'factory:accepted',
    });
    const sourceSecondCall = makeStateSource([doneItem, sprintReviewIssue]);
    await maybeFireSprintReview(SLUG, MILESTONE_NUMBER, MILESTONE_TITLE, sourceSecondCall);

    // Must not fire a second time.
    expect(mockRunSprintReviewWorkflow).toHaveBeenCalledTimes(1);
  });

  it('logs error but does not throw when runSprintReviewWorkflow fails', async () => {
    const doneItem = makeWorkItem({ state: 'factory:done' });
    const source = makeStateSource([doneItem]);
    mockRunSprintReviewWorkflow.mockRejectedValueOnce(new Error('sprint-review exploded'));

    const { maybeFireSprintReview } = await import('./sprint-review-trigger.js');
    await expect(
      maybeFireSprintReview(SLUG, MILESTONE_NUMBER, MILESTONE_TITLE, source),
    ).resolves.not.toThrow();
  });
});
