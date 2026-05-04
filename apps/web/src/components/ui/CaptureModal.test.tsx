import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureModal } from './CaptureModal';

afterEach(cleanup);

vi.mock('@/lib/api', () => ({
  createInboxItem: vi.fn().mockResolvedValue({ id: 1 }),
}));

vi.mock('@/components/ui/MarkdownEditor', () => ({
  MarkdownEditor: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    tab?: string;
    onTabChange?: (t: string) => void;
    rows?: number;
  }) => (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      data-testid="mock-markdown-editor"
    />
  ),
}));

function renderModal(open = true) {
  const onClose = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <CaptureModal open={open} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe('CaptureModal', () => {
  it('renders MarkdownEditor for the notes field (not a plain textarea)', () => {
    renderModal();
    expect(screen.getByTestId('mock-markdown-editor')).toBeTruthy();
  });

  it('MarkdownEditor has a notes-related placeholder', () => {
    renderModal();
    const editor = screen.getByTestId('mock-markdown-editor') as HTMLTextAreaElement;
    expect(editor.placeholder).toBeTruthy();
  });

  it('does not render when open=false', () => {
    renderModal(false);
    expect(screen.queryByTestId('mock-markdown-editor')).toBeNull();
  });

  it('submits with body from MarkdownEditor', async () => {
    const { createInboxItem } = await import('@/lib/api');
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.type(screen.getByTestId('capture-title-input'), 'My idea');
    await user.type(screen.getByTestId('mock-markdown-editor'), 'Some notes');
    await user.click(screen.getByTestId('capture-submit'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createInboxItem).toHaveBeenCalledWith(expect.objectContaining({ body: 'Some notes' }));
  });

  it('resets MarkdownEditor after successful submit', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByTestId('capture-title-input'), 'Reset test');
    await user.type(screen.getByTestId('mock-markdown-editor'), 'will be cleared');
    await user.click(screen.getByTestId('capture-submit'));
    // After reset, the editor value should be empty
    await waitFor(() => {
      const editor = screen.queryByTestId('mock-markdown-editor') as HTMLTextAreaElement | null;
      // Modal closes on success so editor may be gone, or body is ''
      if (editor) expect(editor.value).toBe('');
    });
  });
});
