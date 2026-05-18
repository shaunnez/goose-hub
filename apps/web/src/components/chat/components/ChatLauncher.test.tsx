/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatLauncher } from './ChatLauncher';

afterEach(cleanup);

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
