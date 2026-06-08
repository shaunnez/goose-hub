/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';

vi.mock('@/components/search/components/SearchModal', () => ({
  SearchModal: ({ open }: { open: boolean; onClose: () => void }) => (
    <div data-testid="search-modal" data-open={String(open)} />
  ),
}));

vi.mock('@/components/ui/CaptureModal', () => ({
  CaptureModal: ({ open }: { open: boolean; onClose: () => void }) => (
    <div data-testid="capture-modal" data-open={String(open)} />
  ),
}));

vi.mock('./ChangelogModal', () => ({
  ChangelogModal: ({ open }: { open: boolean; onClose: () => void }) => (
    <div data-testid="changelog-modal" data-open={String(open)} />
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TopBar', () => {
  it('AC-2: Capture button shows ⌘J kbd label', () => {
    render(<TopBar />);
    const captureBtn = screen.getByTestId('capture-button');
    const kbd = captureBtn.querySelector('kbd');
    expect(kbd).not.toBeNull();
    expect(kbd?.textContent).toContain('⌘J');
  });

  it('AC-1: ⌘J keyboard shortcut opens the Capture modal', () => {
    render(<TopBar />);
    const modal = screen.getByTestId('capture-modal');
    expect(modal.getAttribute('data-open')).toBe('false');

    fireEvent.keyDown(document, { key: 'j', metaKey: true });

    expect(modal.getAttribute('data-open')).toBe('true');
  });

  it('⌘J toggles Capture modal closed when already open', () => {
    render(<TopBar />);
    const modal = screen.getByTestId('capture-modal');

    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(modal.getAttribute('data-open')).toBe('true');

    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(modal.getAttribute('data-open')).toBe('false');
  });
});
