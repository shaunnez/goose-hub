/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';

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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TopBar — Capture keyboard shortcut', () => {
  it('opens capture modal on ⌘J', () => {
    render(<TopBar />);
    expect(screen.queryByTestId('capture-modal')).toBeNull();
    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('capture button shows ⌘J kbd label', () => {
    render(<TopBar />);
    const btn = screen.getByTestId('capture-button');
    expect(btn.textContent).toContain('⌘J');
  });
});
