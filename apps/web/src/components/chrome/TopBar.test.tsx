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
});

describe('TopBar', () => {
  it('shows the capture shortcut label and tooltip copy', () => {
    render(<TopBar />);

    const captureButton = screen.getByTestId('capture-button');
    expect(captureButton.getAttribute('title')).toBe('Capture an idea or task (⌘J)');
    expect(screen.getByText('⌘J')).toBeTruthy();
  });

  it('opens capture on Meta+J and Ctrl+J, but not on bare J', () => {
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(screen.getByTestId('capture-modal')).toBeTruthy();

    cleanup();
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'j' });
    expect(screen.queryByTestId('capture-modal')).toBeNull();

    fireEvent.keyDown(document, { key: 'j', ctrlKey: true });
    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('keeps capture open when the shortcut is pressed again', () => {
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(screen.getByTestId('capture-modal')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });
});
