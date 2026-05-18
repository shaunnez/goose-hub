/** @vitest-environment jsdom */
import type { ChatMessageDto, ChatToolInvocationDto } from '@/lib/types';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ChatThread } from './ChatThread';

beforeAll(() => {
  // jsdom does not implement Element.scrollTo; the thread auto-scrolls.
  if (typeof Element.prototype.scrollTo !== 'function') {
    Element.prototype.scrollTo = () => {};
  }
});

afterEach(cleanup);

const noop = () => {};

const baseMessage: ChatMessageDto = {
  id: 1,
  conversationId: 'conv_x',
  role: 'user',
  content: 'hi',
  runId: null,
  meta: null,
  createdAt: '2026-05-18T00:00:00Z',
};

const completedInvocation: ChatToolInvocationDto = {
  id: 'tool_a',
  conversationId: 'conv_x',
  messageId: 1,
  toolName: 'list_projects',
  input: {},
  mutating: false,
  status: 'completed',
  result: null,
  errorMessage: null,
  runId: null,
  createdAt: '2026-05-18T00:00:00Z',
  updatedAt: '2026-05-18T00:00:00Z',
};

describe('ChatThread', () => {
  it('renders a thinking indicator when thinking is true', () => {
    render(
      <ChatThread
        messages={[baseMessage]}
        invocations={[]}
        pendingDecision={null}
        thinking
        onApprove={noop}
        onReject={noop}
      />,
    );
    expect(screen.getByTestId('chat-thinking-indicator')).toBeTruthy();
  });

  it('hides the thinking indicator when thinking is false', () => {
    render(
      <ChatThread
        messages={[baseMessage]}
        invocations={[]}
        pendingDecision={null}
        thinking={false}
        onApprove={noop}
        onReject={noop}
      />,
    );
    expect(screen.queryByTestId('chat-thinking-indicator')).toBeNull();
  });

  it('reflects the invocation status passed in via props (no internal fetch)', () => {
    render(
      <ChatThread
        messages={[baseMessage]}
        invocations={[completedInvocation]}
        pendingDecision={null}
        onApprove={noop}
        onReject={noop}
      />,
    );
    // ToolProposalCard renders the status badge text — completed flows
    // through verbatim from the prop, proving the thread does not fetch on
    // its own.
    expect(screen.getByText(/completed/i)).toBeTruthy();
  });
});
