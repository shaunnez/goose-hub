import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockReplay, mockResolveWorkflowBase } = vi.hoisted(() => ({
  mockReplay: vi.fn(),
  mockResolveWorkflowBase: vi.fn(),
}));

vi.mock('../event-stream/store.js', () => ({
  eventStore: {
    replay: mockReplay,
  },
}));

vi.mock('./worktree.js', () => ({
  resolveWorkflowBase: (...args: unknown[]) => mockResolveWorkflowBase(...args),
}));

import { resolveWorkflowBaseForWorkItem } from './workflow-base.js';

describe('resolveWorkflowBaseForWorkItem', () => {
  beforeEach(() => {
    mockReplay.mockReset();
    mockResolveWorkflowBase.mockReset();
    mockResolveWorkflowBase.mockReturnValue({
      branch: 'main',
      ref: 'origin/main',
      source: 'configured-default',
    });
  });

  it('prefers the latest dogfood seed base ref for the work item', () => {
    mockReplay.mockReturnValue([
      {
        kind: 'dogfood.seed-applied',
        payload: {
          baseBranch: 'dogfood/run-1/logger-001-drop-meta',
          baseRef: 'seed-commit-sha',
        },
      },
    ]);

    expect(
      resolveWorkflowBaseForWorkItem('goose-hub-self', 'github:owner/repo#123', '/repo', 'main'),
    ).toEqual({
      branch: 'dogfood/run-1/logger-001-drop-meta',
      ref: 'seed-commit-sha',
      source: 'dogfood-seed',
    });
    expect(mockReplay).toHaveBeenCalledWith({
      projectId: 'goose-hub-self',
      workItemId: 'github:owner/repo#123',
      kind: 'dogfood.seed-applied',
      order: 'desc',
      limit: 1,
    });
    expect(mockResolveWorkflowBase).not.toHaveBeenCalled();
  });

  it('falls back to normal workflow base resolution for non-dogfood issues', () => {
    mockReplay.mockReturnValue([]);

    expect(
      resolveWorkflowBaseForWorkItem('proj', 'github:owner/repo#123', '/repo', 'develop'),
    ).toEqual({
      branch: 'main',
      ref: 'origin/main',
      source: 'configured-default',
    });
    expect(mockResolveWorkflowBase).toHaveBeenCalledWith('/repo', 'develop');
  });
});
