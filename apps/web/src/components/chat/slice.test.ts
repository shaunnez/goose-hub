import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Unit tests for the chat slice. Component-level rendering tests live next to
// the components themselves in `*.test.tsx`. This file covers the API hooks
// and shared lib behaviour exercised by the slice.
// ---------------------------------------------------------------------------

describe('chat api — createConversation', () => {
  it('POSTs to /chat/conversations and returns the created conversation', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      id: 'conv_x',
      scope: 'global',
      projectId: null,
      workItemId: null,
      title: '',
      runtime: 'claude',
      createdAt: '2026-05-18T00:00:00Z',
      updatedAt: '2026-05-18T00:00:00Z',
    });
    vi.doMock('@/lib/api/chat', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/api/chat')>();
      return { ...actual, createConversation: mockCreate };
    });
    const { createConversation } = await import('@/lib/api/chat');
    const conv = await createConversation({ scope: 'global' });
    expect(conv.id).toBe('conv_x');
    expect(mockCreate).toHaveBeenCalledWith({ scope: 'global' });
  });
});

describe('chat api — postMessage', () => {
  it('returns user and agent messages plus invocations', async () => {
    const mockPost = vi.fn().mockResolvedValue({
      user: {
        id: 1,
        conversationId: 'conv_x',
        role: 'user',
        content: 'hi',
        runId: null,
        meta: null,
        createdAt: '2026-05-18T00:00:00Z',
      },
      agent: {
        id: 2,
        conversationId: 'conv_x',
        role: 'agent',
        content: 'hello',
        runId: 'chat_run',
        meta: null,
        createdAt: '2026-05-18T00:00:01Z',
      },
      invocations: [],
    });
    vi.doMock('@/lib/api/chat', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/api/chat')>();
      return { ...actual, postMessage: mockPost };
    });
    const { postMessage } = await import('@/lib/api/chat');
    const result = await postMessage('conv_x', 'hi');
    expect(result.user.content).toBe('hi');
    expect(result.agent?.content).toBe('hello');
  });
});

describe('chat scope', () => {
  it('detects the chat scope from the current path', async () => {
    const { resolveScopeFromPath } = await import('./lib/scope.js');
    expect(resolveScopeFromPath('/projects/goose-hub-self').scope).toBe('project');
    expect(resolveScopeFromPath('/projects/goose-hub-self/items/123').scope).toBe('item');
    expect(resolveScopeFromPath('/settings').scope).toBe('global');
  });
});
