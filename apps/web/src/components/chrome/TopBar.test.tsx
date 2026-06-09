/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';

afterEach(() => {
  cleanup();
});

vi.mock('@/components/ui/CaptureModal', () => ({
  CaptureModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="capture-modal">Capture open</div> : null,
}));

vi.mock('@/components/search/components/SearchModal', () => ({
  SearchModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="search-modal">Search open</div> : null,
}));

vi.mock('./ChangelogModal', () => ({
  ChangelogModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="changelog-modal">Changelog open</div> : null,
}));

describe('TopBar', () => {
  it('opens capture from the header Cmd+J shortcut', () => {
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'j', metaKey: true });

    expect(screen.getByTestId('capture-modal')).toBeTruthy();
    expect(screen.queryByTestId('search-modal')).toBeNull();
  });

  it('opens capture from the header Ctrl+J shortcut', () => {
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'j', ctrlKey: true });

    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('renders the capture shortcut label and matching tooltip', () => {
    render(<TopBar />);

    const captureButton = screen.getByTestId('capture-button');
    const searchButton = screen.getByTestId('search-button');

    expect(captureButton.getAttribute('title')).toBe('Capture an idea or task (⌘J)');
    expect(searchButton.getAttribute('title')).toBe('Search work items (⌘K)');
    expect(screen.getByText('⌘J')).toBeTruthy();
  });
});
