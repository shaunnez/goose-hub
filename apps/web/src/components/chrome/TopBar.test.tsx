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

describe('TopBar', () => {
  it('Cmd+J opens the capture modal (AC-1)', () => {
    render(<TopBar />);
    expect(screen.queryByTestId('capture-modal')).toBeNull();
    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('Cmd+J toggles capture modal closed when already open (AC-1)', () => {
    render(<TopBar />);
    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(screen.getByTestId('capture-modal')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(screen.queryByTestId('capture-modal')).toBeNull();
  });

  it('Capture button shows ⌘J keyboard shortcut label (AC-2)', () => {
    render(<TopBar />);
    const captureBtn = screen.getByTestId('capture-button');
    expect(captureBtn.textContent).toContain('⌘J');
  });

  it('Cmd+K still opens the search modal', () => {
    render(<TopBar />);
    expect(screen.queryByTestId('search-modal')).toBeNull();
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(screen.getByTestId('search-modal')).toBeTruthy();
  });
});
