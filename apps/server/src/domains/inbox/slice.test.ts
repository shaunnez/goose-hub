import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRunBugEnhance,
  mockGetInboxItem,
  mockDeleteInboxItem,
  mockGetSourceForSlug,
  mockDispatchTriageBatch,
} = vi.hoisted(() => ({
  mockRunBugEnhance: vi.fn(),
  mockGetInboxItem: vi.fn(),
  mockDeleteInboxItem: vi.fn().mockResolvedValue(undefined),
  mockGetSourceForSlug: vi.fn(),
  mockDispatchTriageBatch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@goose-hub/core/db/db.js', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ all: () => [] }) }) }),
  },
}));

vi.mock('#shared/source.js', () => ({
  getSourceForSlug: mockGetSourceForSlug,
}));

vi.mock('#shared/dispatch.js', () => ({
  dispatchTriageBatch: mockDispatchTriageBatch,
}));

vi.mock('./repository.js', () => ({
  insertInboxItem: vi.fn(),
  listInboxItems: vi.fn().mockResolvedValue([]),
  getInboxItem: mockGetInboxItem,
  deleteInboxItem: mockDeleteInboxItem,
}));

vi.mock('./enhance.js', () => ({
  runBugEnhance: mockRunBugEnhance,
}));

import { inboxRouter } from './router.js';

function makeApp() {
  return new Hono().route('/inbox', inboxRouter);
}

const mockSource = {
  projectId: 'project-123',
  createIssue: vi.fn().mockResolvedValue(undefined),
};

describe('inbox promotion slice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSourceForSlug.mockResolvedValue(mockSource);
    mockRunBugEnhance.mockResolvedValue('**Expected**\nEnhanced output');
  });

  it.each(['bug', 'feature', 'chore', 'research'] as const)(
    'promotes %s inbox items through the enhancement path',
    async (type) => {
      mockGetInboxItem.mockResolvedValueOnce({
        id: 7,
        title: `${type} title`,
        body: `${type} body`,
        type,
        createdAt: '2026-05-01',
      });

      const response = await makeApp().request('/inbox/7/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectSlug: 'goose-hub-self', enhance: true }),
      });

      expect(response.status).toBe(200);
      expect(mockRunBugEnhance).toHaveBeenCalledWith(
        'project-123',
        7,
        `${type} title`,
        `${type} body`,
        type,
      );
      expect(mockSource.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          type,
          body: `${type} body\n\n---\n\n**Expected**\nEnhanced output`,
        }),
      );
    },
  );

  it('rejects invalid promotion types before enhancement starts', async () => {
    mockGetInboxItem.mockResolvedValueOnce({
      id: 8,
      title: 'Bad type',
      body: 'Original body',
      type: 'epic',
      createdAt: '2026-05-01',
    });

    const response = await makeApp().request('/inbox/8/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectSlug: 'goose-hub-self', enhance: true }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid promotion type' });
    expect(mockRunBugEnhance).not.toHaveBeenCalled();
    expect(mockSource.createIssue).not.toHaveBeenCalled();
  });

  it('bypasses enhancement entirely when enhance is false', async () => {
    mockGetInboxItem.mockResolvedValueOnce({
      id: 9,
      title: 'Keep original body',
      body: 'Original body',
      type: 'feature',
      createdAt: '2026-05-01',
    });

    const response = await makeApp().request('/inbox/9/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectSlug: 'goose-hub-self', enhance: false }),
    });

    expect(response.status).toBe(200);
    expect(mockRunBugEnhance).not.toHaveBeenCalled();
    expect(mockSource.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Original body', type: 'feature' }),
    );
  });
});
