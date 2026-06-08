/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';

// Stub child modals so we can test TopBar in isolation
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

describe('TopBar – Capture shortcut', () => {
  it('shows ⌘J kbd label on the Capture button', () => {
    render(<TopBar />);
    const btn = screen.getByTestId('capture-button');
    expect(btn.textContent).toContain('⌘J');
  });

  it('opens CaptureModal on ⌘J keydown', () => {
    render(<TopBar />);
    expect(screen.queryByTestId('capture-modal')).toBeNull();
    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('opens CaptureModal on Ctrl+J keydown', () => {
    render(<TopBar />);
    expect(screen.queryByTestId('capture-modal')).toBeNull();
    fireEvent.keyDown(document, { key: 'j', ctrlKey: true });
    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('does not open CaptureModal on other keys', () => {
    render(<TopBar />);
    fireEvent.keyDown(document, { key: 'j' });
    expect(screen.queryByTestId('capture-modal')).toBeNull();
  });
});

describe('TopBar – Search shortcut', () => {
  it('shows ⌘K kbd label on the Search button', () => {
    render(<TopBar />);
    const btn = screen.getByTestId('search-button');
    expect(btn.textContent).toContain('⌘K');
  });

  it('opens SearchModal on ⌘K keydown', () => {
    render(<TopBar />);
    expect(screen.queryByTestId('search-modal')).toBeNull();
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(screen.getByTestId('search-modal')).toBeTruthy();
  });
});
