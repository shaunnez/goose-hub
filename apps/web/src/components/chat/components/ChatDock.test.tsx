/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatDock } from './ChatDock';

vi.mock('./ChatPanel', () => ({
  ChatPanel: (props: { open: boolean; onClose: () => void; launcherResetToken: number }) => {
    return (
      <div data-testid="chat-panel-proxy">
        <button type="button" data-testid="panel-close-proxy" onClick={props.onClose}>
          panel close
        </button>
        <span data-testid="panel-open-state">{String(props.open)}</span>
        <span data-testid="panel-reset-token">{String(props.launcherResetToken)}</span>
      </div>
    );
  },
}));

vi.mock('./ChatLauncher', () => ({
  ChatLauncher: (props: { open: boolean; onToggle: () => void }) => {
    return (
      <button type="button" data-testid="chat-launcher" onClick={props.onToggle}>
        launcher {String(props.open)}
      </button>
    );
  },
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('ChatDock', () => {
  it('increments the launcher reset token only when the launcher closes an open panel', () => {
    render(<ChatDock />);

    expect(screen.getByTestId('panel-open-state').textContent).toBe('false');
    expect(screen.getByTestId('panel-reset-token').textContent).toBe('0');

    fireEvent.click(screen.getByTestId('chat-launcher'));
    expect(screen.getByTestId('panel-open-state').textContent).toBe('true');
    expect(screen.getByTestId('panel-reset-token').textContent).toBe('0');

    fireEvent.click(screen.getByTestId('chat-launcher'));
    expect(screen.getByTestId('panel-open-state').textContent).toBe('false');
    expect(screen.getByTestId('panel-reset-token').textContent).toBe('1');
  });

  it('does not increment the launcher reset token when ChatPanel closes itself', () => {
    render(<ChatDock />);

    fireEvent.click(screen.getByTestId('chat-launcher'));
    expect(screen.getByTestId('panel-open-state').textContent).toBe('true');
    expect(screen.getByTestId('panel-reset-token').textContent).toBe('0');

    fireEvent.click(screen.getByTestId('panel-close-proxy'));
    expect(screen.getByTestId('panel-open-state').textContent).toBe('false');
    expect(screen.getByTestId('panel-reset-token').textContent).toBe('0');
  });
});
