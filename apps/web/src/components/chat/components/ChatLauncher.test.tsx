/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatDock } from './ChatDock';
import { ChatLauncher } from './ChatLauncher';

const { chatPanelMock } = vi.hoisted(() => ({
  chatPanelMock: vi.fn(
    ({
      open,
      resetOnOpenKey,
    }: {
      open: boolean;
      resetOnOpenKey?: number;
    }) => (
      <div
        data-testid="chat-panel"
        data-open={String(open)}
        data-reset-on-open-key={String(resetOnOpenKey ?? 'missing')}
      />
    ),
  ),
}));

vi.mock('./ChatPanel', () => ({
  ChatPanel: chatPanelMock,
}));

afterEach(cleanup);
afterEach(() => {
  localStorage.clear();
  chatPanelMock.mockClear();
});

describe('ChatLauncher', () => {
  it('renders with aria-pressed reflecting open state', () => {
    const { rerender } = render(<ChatLauncher open={false} onToggle={() => {}} />);
    expect(screen.getByTestId('chat-launcher').getAttribute('aria-pressed')).toBe('false');
    rerender(<ChatLauncher open onToggle={() => {}} />);
    expect(screen.getByTestId('chat-launcher').getAttribute('aria-pressed')).toBe('true');
  });

  it('fires onToggle when clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<ChatLauncher open={false} onToggle={onToggle} />);
    await user.click(screen.getByTestId('chat-launcher'));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});

describe('ChatDock', () => {
  it('increments resetOnOpenKey only when the launcher reopens the panel', async () => {
    const user = userEvent.setup();
    render(<ChatDock />);

    expect(screen.getByTestId('chat-panel').getAttribute('data-open')).toBe('false');
    expect(screen.getByTestId('chat-panel').getAttribute('data-reset-on-open-key')).toBe('0');

    await user.click(screen.getByTestId('chat-launcher'));
    expect(screen.getByTestId('chat-panel').getAttribute('data-open')).toBe('true');
    expect(screen.getByTestId('chat-panel').getAttribute('data-reset-on-open-key')).toBe('1');

    await user.click(screen.getByTestId('chat-launcher'));
    expect(screen.getByTestId('chat-panel').getAttribute('data-open')).toBe('false');
    expect(screen.getByTestId('chat-panel').getAttribute('data-reset-on-open-key')).toBe('1');

    await user.click(screen.getByTestId('chat-launcher'));
    expect(screen.getByTestId('chat-panel').getAttribute('data-open')).toBe('true');
    expect(screen.getByTestId('chat-panel').getAttribute('data-reset-on-open-key')).toBe('2');
  });

  it('persists hub-chat-open without clearing it during launcher toggles', async () => {
    const user = userEvent.setup();
    render(<ChatDock />);

    expect(localStorage.getItem('hub-chat-open')).toBe('false');

    await user.click(screen.getByTestId('chat-launcher'));
    expect(localStorage.getItem('hub-chat-open')).toBe('true');

    await user.click(screen.getByTestId('chat-launcher'));
    expect(localStorage.getItem('hub-chat-open')).toBe('false');
  });
});
