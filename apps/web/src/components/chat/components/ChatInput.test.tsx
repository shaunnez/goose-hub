/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatInput } from './ChatInput';

afterEach(cleanup);

describe('ChatInput', () => {
  it('submits on Enter', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ChatInput disabled={false} onSubmit={onSubmit} />);
    const textarea = screen.getByPlaceholderText(/Ask Hub Chat/);
    await user.type(textarea, 'hello{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('hello');
  });

  it('does not submit on Shift+Enter', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ChatInput disabled={false} onSubmit={onSubmit} />);
    const textarea = screen.getByPlaceholderText(/Ask Hub Chat/);
    await user.type(textarea, 'line1{Shift>}{Enter}{/Shift}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables when busy', () => {
    render(<ChatInput disabled onSubmit={() => {}} />);
    const textarea = screen.getByPlaceholderText(
      /Waiting for the assistant/,
    ) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });
});
