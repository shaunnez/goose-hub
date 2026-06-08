/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';

vi.mock('@/components/ui/CaptureModal', () => ({
  CaptureModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="capture-modal">Capture idea</div> : null,
}));

vi.mock('@/components/search/components/SearchModal', () => ({
  SearchModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="search-modal">Search work items</div> : null,
}));

vi.mock('./ChangelogModal', () => ({
  ChangelogModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="changelog-modal">Last 7 days</div> : null,
}));

afterEach(() => {
  cleanup();
});

describe('TopBar', () => {
  it('shows the capture shortcut badge and tooltip copy', () => {
    render(<TopBar />);

    const captureButton = screen.getByTestId('capture-button');
    expect(captureButton.getAttribute('title')).toBe('Capture an idea or task (⌘J)');
    expect(screen.getByText('⌘J')).toBeTruthy();
  });

  it('opens the capture modal when the capture button is clicked', () => {
    render(<TopBar />);

    fireEvent.click(screen.getByTestId('capture-button'));

    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('opens capture on Cmd+J and keeps the search shortcut on Cmd+K', () => {
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'j', metaKey: true });

    expect(screen.getByTestId('capture-modal')).toBeTruthy();
    expect(screen.queryByTestId('search-modal')).toBeNull();

    fireEvent.keyDown(document, { key: 'k', metaKey: true });

    expect(screen.getByTestId('search-modal')).toBeTruthy();
  });

  it('opens capture on Ctrl+J', () => {
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'J', ctrlKey: true });

    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });
});
