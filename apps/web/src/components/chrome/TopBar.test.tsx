/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/search/components/SearchModal', () => ({
  SearchModal: ({ open }: { open: boolean }) => (open ? <div data-testid="search-modal" /> : null),
}));

vi.mock('@/components/ui/CaptureModal', () => ({
  CaptureModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="capture-modal" /> : null,
}));

vi.mock('./ChangelogModal', () => ({
  ChangelogModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="changelog-modal" /> : null,
}));

import { TopBar } from './TopBar';

afterEach(() => {
  cleanup();
});

describe('TopBar — capture shortcut', () => {
  it('capture button shows ⌘J keyboard shortcut label', () => {
    render(<TopBar />);
    const btn = screen.getByTestId('capture-button');
    expect(btn.textContent).toContain('⌘J');
  });

  it('pressing ⌘J opens the capture modal', () => {
    render(<TopBar />);
    expect(screen.queryByTestId('capture-modal')).toBeNull();
    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('pressing ⌘K still opens the search modal', () => {
    render(<TopBar />);
    expect(screen.queryByTestId('search-modal')).toBeNull();
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(screen.getByTestId('search-modal')).toBeTruthy();
  });
});
