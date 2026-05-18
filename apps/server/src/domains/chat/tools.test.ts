import { describe, expect, it, vi } from 'vitest';

// Mock all upstream dependencies before importing tools.ts so the module-time
// imports resolve cleanly.
const mockListOpenWork = vi.fn();
const mockGetItem = vi.fn();
const mockListMilestones = vi.fn();
const mockTransitionState = vi.fn();
const mockComment = vi.fn();

vi.mock('#shared/source.js', () => ({
  isValidSlug: (slug: string) => /^[a-z0-9-]+$/.test(slug),
  getSourceForSlug: vi.fn(async (slug: string) => {
    if (slug === 'unknown') return null;
    return {
      projectId: slug,
      listOpenWork: mockListOpenWork,
      getItem: mockGetItem,
      listMilestones: mockListMilestones,
      transitionState: mockTransitionState,
      comment: mockComment,
    };
  }),
}));

vi.mock('#shared/inbox-bridge.js', () => ({
  addInboxNote: vi.fn(async (_input: { title: string }) => ({ id: 42 })),
}));

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    replay: vi.fn(() => []),
    appendEvent: vi.fn(),
  },
}));

vi.mock('@goose-hub/core/projects/loader.js', () => ({
  loadProjects: vi.fn(async () => [
    {
      slug: 'goose-hub-self',
      name: 'Goose Hub (self)',
      mode: 'supervised',
      activeMilestone: 'M20',
      source: { kind: 'github', repo: 'shaunnez/goose-hub' },
    },
  ]),
}));

import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { CHAT_TOOL_IMPLEMENTATIONS, ToolExecutionError } from './tools.js';

const ctx = { conversationId: 'conv_test', projectId: null, workItemId: null };

function workItem(
  overrides: Partial<{ id: string; externalId: string; title: string; state: string }>,
) {
  return {
    id: 'github:shaunnez/goose-hub#1',
    externalId: '1',
    repoRef: 'shaunnez/goose-hub',
    title: 'Item 1',
    body: '',
    type: 'feature',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:in-progress',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date(),
    ...overrides,
  };
}

describe('chat-tools — list_projects', () => {
  it('returns slug/name/mode/activeMilestone tuples', async () => {
    const result = (await CHAT_TOOL_IMPLEMENTATIONS.list_projects({}, ctx)) as {
      projects: Array<{ slug: string; name: string; mode: string; activeMilestone: string | null }>;
    };
    expect(result.projects[0]).toMatchObject({
      slug: 'goose-hub-self',
      name: 'Goose Hub (self)',
      mode: 'supervised',
    });
  });
});

describe('chat-tools — list_open_issues', () => {
  it('returns mapped items with an in-app path', async () => {
    mockListOpenWork.mockResolvedValueOnce([workItem({ externalId: '7', title: 'Seven' })]);
    const result = (await CHAT_TOOL_IMPLEMENTATIONS.list_open_issues(
      { projectSlug: 'goose-hub-self' },
      ctx,
    )) as { items: Array<{ path: string; number: string }> };
    expect(result.items[0].number).toBe('7');
    expect(result.items[0].path).toBe('/projects/goose-hub-self/items/7');
  });

  it('honours the state filter', async () => {
    mockListOpenWork.mockResolvedValueOnce([
      workItem({ externalId: '1', state: 'factory:in-progress' }),
      workItem({ externalId: '2', state: 'factory:needs-human' }),
      workItem({ externalId: '3', state: 'factory:gate-pending' }),
    ]);
    const result = (await CHAT_TOOL_IMPLEMENTATIONS.list_open_issues(
      { projectSlug: 'goose-hub-self', state: 'needs-human' },
      ctx,
    )) as { items: Array<{ number: string }>; appliedStateFilter: string };
    expect(result.items.map((i) => i.number)).toEqual(['2']);
    expect(result.appliedStateFilter).toBe('needs-human');
  });

  it('rejects an unknown project with a 404 ToolExecutionError', async () => {
    await expect(
      CHAT_TOOL_IMPLEMENTATIONS.list_open_issues({ projectSlug: 'unknown' }, ctx),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });
});

describe('chat-tools — get_issue', () => {
  it('returns body and path', async () => {
    mockGetItem.mockResolvedValueOnce(workItem({ externalId: '42', title: 'Hello' }));
    const result = (await CHAT_TOOL_IMPLEMENTATIONS.get_issue(
      { projectSlug: 'goose-hub-self', issueNumber: 42 },
      ctx,
    )) as { number: string; path: string };
    expect(result.number).toBe('42');
    expect(result.path).toBe('/projects/goose-hub-self/items/42');
  });
});

describe('chat-tools — transition_issue', () => {
  it('calls source.transitionState with the resolved from-state', async () => {
    mockGetItem.mockResolvedValueOnce(workItem({ externalId: '5', state: 'factory:in-progress' }));
    mockTransitionState.mockResolvedValueOnce(undefined);
    const result = (await CHAT_TOOL_IMPLEMENTATIONS.transition_issue(
      {
        projectSlug: 'goose-hub-self',
        issueNumber: 5,
        toState: 'factory:done',
        rationale: 'finished',
      },
      ctx,
    )) as { ok: boolean; from: string; to: string };
    expect(mockTransitionState).toHaveBeenCalledWith('5', 'factory:in-progress', 'factory:done');
    expect(result).toEqual({ ok: true, from: 'factory:in-progress', to: 'factory:done' });
  });
});

describe('chat-tools — comment_on_issue', () => {
  it('posts the comment via source.comment', async () => {
    mockComment.mockResolvedValueOnce(undefined);
    const result = (await CHAT_TOOL_IMPLEMENTATIONS.comment_on_issue(
      { projectSlug: 'goose-hub-self', issueNumber: 9, body: 'hello' },
      ctx,
    )) as { ok: boolean };
    expect(mockComment).toHaveBeenCalledWith('9', 'hello');
    expect(result.ok).toBe(true);
  });
});

describe('chat-tools — find_pr', () => {
  it('scopes the event-stream replay to the requested project', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([]);
    await CHAT_TOOL_IMPLEMENTATIONS.find_pr({ query: '123', projectSlug: 'goose-hub-self' }, ctx);
    expect(eventStore.replay).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: 'goose-hub-self' }),
    );
  });
});

describe('chat-tools — create_inbox_note', () => {
  it('delegates to the shared inbox-bridge', async () => {
    const result = (await CHAT_TOOL_IMPLEMENTATIONS.create_inbox_note(
      { title: 'follow up on retro' },
      ctx,
    )) as { ok: boolean; id: number };
    expect(result.id).toBe(42);
  });
});

describe('chat-tools — open_url', () => {
  it('echoes the path so the UI can navigate', async () => {
    const result = (await CHAT_TOOL_IMPLEMENTATIONS.open_url(
      { path: '/projects/goose-hub-self', rationale: 'show kanban' },
      ctx,
    )) as { ok: boolean; path: string };
    expect(result).toEqual({ ok: true, path: '/projects/goose-hub-self' });
  });
});
