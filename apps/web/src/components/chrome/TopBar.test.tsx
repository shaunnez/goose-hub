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
  it('capture button shows ⌘J kbd label', () => {
    render(<TopBar />);
    const captureBtn = screen.getByTestId('capture-button');
    expect(captureBtn.textContent).toContain('⌘J');
  });

  it('Cmd+J opens the capture modal', () => {
    render(<TopBar />);
    expect(screen.queryByTestId('capture-modal')).toBeNull();
    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('Ctrl+J opens the capture modal', () => {
    render(<TopBar />);
    expect(screen.queryByTestId('capture-modal')).toBeNull();
    fireEvent.keyDown(document, { key: 'j', ctrlKey: true });
    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('search button shows ⌘K kbd label', () => {
    render(<TopBar />);
    const searchBtn = screen.getByTestId('search-button');
    expect(searchBtn.textContent).toContain('⌘K');
  });
});
