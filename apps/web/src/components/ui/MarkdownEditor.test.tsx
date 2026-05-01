/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/markdown', () => ({ renderMarkdownToHtml: (s: string) => s }));

import { MarkdownEditor } from './MarkdownEditor';

function renderEditor(overrides: Partial<Parameters<typeof MarkdownEditor>[0]> = {}) {
  const onChange = vi.fn();
  const onTabChange = vi.fn();
  render(
    <MarkdownEditor
      value=""
      onChange={onChange}
      tab="write"
      onTabChange={onTabChange}
      placeholder="Write something…"
      {...overrides}
    />,
  );
  return { onChange, onTabChange };
}

afterEach(cleanup);

describe('MarkdownEditor', () => {
  it('renders textarea in write tab', () => {
    renderEditor();
    expect(screen.getByPlaceholderText('Write something…')).toBeTruthy();
  });

  it('calls onTabChange when Preview is clicked', async () => {
    const user = userEvent.setup();
    const { onTabChange } = renderEditor();
    await user.click(screen.getByRole('button', { name: 'preview' }));
    expect(onTabChange).toHaveBeenCalledWith('preview');
  });

  it('shows preview panel when tab is "preview"', () => {
    renderEditor({ tab: 'preview', value: '**bold**' });
    expect(screen.getByTestId('markdown-preview')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows "Nothing to preview" for empty preview', () => {
    renderEditor({ tab: 'preview', value: '' });
    expect(screen.getByTestId('markdown-preview').innerHTML).toContain('Nothing to preview');
  });

  it('toolbar buttons are visible in write tab', () => {
    renderEditor({ tab: 'write' });
    expect(screen.getByTitle('Bold')).toBeTruthy();
    expect(screen.getByTitle('Italic')).toBeTruthy();
    expect(screen.getByTitle('Link')).toBeTruthy();
  });

  it('toolbar is hidden in preview tab', () => {
    renderEditor({ tab: 'preview' });
    expect(screen.queryByTitle('Bold')).toBeNull();
  });
});
