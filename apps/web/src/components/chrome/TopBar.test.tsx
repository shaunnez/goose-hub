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

describe('TopBar capture shortcut', () => {
  it('shows ⌘J kbd badge on the Capture button', () => {
    render(<TopBar />);
    const badge = screen.getByTestId('capture-button').querySelector('kbd');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe('⌘J');
  });

  it('opens CaptureModal on ⌘J keydown', () => {
    render(<TopBar />);
    expect(screen.queryByTestId('capture-modal')).toBeNull();
    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('opens CaptureModal on ctrl+J keydown', () => {
    render(<TopBar />);
    expect(screen.queryByTestId('capture-modal')).toBeNull();
    fireEvent.keyDown(document, { key: 'j', ctrlKey: true });
    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('search shortcut ⌘K still works', () => {
    render(<TopBar />);
    expect(screen.queryByTestId('search-modal')).toBeNull();
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(screen.getByTestId('search-modal')).toBeTruthy();
  });
});
