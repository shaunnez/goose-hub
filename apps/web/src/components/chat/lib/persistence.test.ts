/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearActiveConversationId,
  readActiveConversationId,
  readChatDockOpen,
  writeActiveConversationId,
  writeChatDockOpen,
} from './persistence';

beforeEach(() => {
  localStorage.clear();
});

describe('chat persistence', () => {
  it('defaults the dock closed and without an active conversation', () => {
    expect(readChatDockOpen(localStorage)).toBe(false);
    expect(readActiveConversationId(localStorage)).toBeNull();
  });

  it('persists the dock open state and active conversation id', () => {
    writeChatDockOpen(localStorage, true);
    writeActiveConversationId(localStorage, 'conv-1');

    expect(readChatDockOpen(localStorage)).toBe(true);
    expect(readActiveConversationId(localStorage)).toBe('conv-1');
  });

  it('clears the active conversation id without changing the dock open state', () => {
    writeChatDockOpen(localStorage, true);
    writeActiveConversationId(localStorage, 'conv-1');

    clearActiveConversationId(localStorage);

    expect(readChatDockOpen(localStorage)).toBe(true);
    expect(readActiveConversationId(localStorage)).toBeNull();
  });
});
