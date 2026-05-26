/** @vitest-environment jsdom */
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatDock } from './ChatDock';
import { ChatLauncher } from './ChatLauncher';

vi.mock('./ChatPanel', () => ({
  ChatPanel: ({
    open,
    onClose,
    restoreLastConversationOnOpen,
  }: {
    open: boolean;
    onClose: () => void;
    restoreLastConversationOnOpen?: boolean;
  }) => (
    <div
      data-open={String(open)}
      data-restore-last-conversation-on-open={String(restoreLastConversationOnOpen)}
      data-testid="chat-panel"
    >
      <button data-testid="chat-panel-close" onClick={onClose} type="button">
        Close panel
      </button>
    </div>
  ),
}));

function renderIntoBody(element: ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(element);
  });

  return {
    container,
    rerender(next: ReactNode) {
      flushSync(() => {
        root.render(next);
      });
    },
    unmount() {
      flushSync(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function click(element: Element | null) {
  expect(element).not.toBeNull();
  if (element == null) {
    throw new Error('Expected clickable element');
  }
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

const mountedRoots: Array<{ unmount: () => void }> = [];

afterEach(() => {
  for (const mounted of mountedRoots.splice(0)) {
    mounted.unmount();
  }
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('ChatLauncher', () => {
  it('renders with aria-pressed reflecting open state', () => {
    const mounted = renderIntoBody(<ChatLauncher open={false} onToggle={() => {}} />);
    mountedRoots.push(mounted);

    const launcher = document.querySelector('[data-testid="chat-launcher"]');
    expect(launcher?.getAttribute('aria-pressed')).toBe('false');

    mounted.rerender(<ChatLauncher open onToggle={() => {}} />);
    expect(launcher?.getAttribute('aria-pressed')).toBe('true');
  });

  it('fires onToggle when clicked', () => {
    const onToggle = vi.fn();
    const mounted = renderIntoBody(<ChatLauncher open={false} onToggle={onToggle} />);
    mountedRoots.push(mounted);

    click(document.querySelector('[data-testid="chat-launcher"]'));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});

describe('ChatDock', () => {
  it('reopens from the launcher without restoring the last conversation', () => {
    const mounted = renderIntoBody(<ChatDock />);
    mountedRoots.push(mounted);

    const panel = () => document.querySelector('[data-testid="chat-panel"]');
    expect(panel()?.getAttribute('data-open')).toBe('false');
    expect(panel()?.getAttribute('data-restore-last-conversation-on-open')).toBe('false');

    click(document.querySelector('[data-testid="chat-launcher"]'));
    expect(panel()?.getAttribute('data-open')).toBe('true');

    click(document.querySelector('[data-testid="chat-panel-close"]'));
    expect(panel()?.getAttribute('data-open')).toBe('false');

    click(document.querySelector('[data-testid="chat-launcher"]'));
    expect(panel()?.getAttribute('data-open')).toBe('true');
    expect(panel()?.getAttribute('data-restore-last-conversation-on-open')).toBe('false');
  });
});
