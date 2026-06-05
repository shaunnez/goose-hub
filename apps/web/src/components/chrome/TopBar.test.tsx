/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';

vi.mock('@/components/ui/CaptureModal', () => ({
  CaptureModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="capture-modal">Capture modal</div> : null,
}));

vi.mock('@/components/search/components/SearchModal', () => ({
  SearchModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="search-modal">Search modal</div> : null,
}));

vi.mock('./ChangelogModal', () => ({
  ChangelogModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="changelog-modal">Changelog modal</div> : null,
}));

afterEach(cleanup);

describe('TopBar', () => {
  it('opens Capture on Meta+J and Ctrl+J', () => {
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(screen.getByTestId('capture-modal')).toBeTruthy();

    cleanup();
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'j', ctrlKey: true });
    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('keeps Search open on repeated Meta+K and Ctrl+K presses', () => {
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(screen.getByTestId('search-modal')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(screen.getByTestId('search-modal')).toBeTruthy();

    cleanup();
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.getByTestId('search-modal')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.getByTestId('search-modal')).toBeTruthy();
  });

  it('shows the Capture shortcut label and tooltip', () => {
    render(<TopBar />);

    const captureButton = screen.getByTestId('capture-button');

    expect(captureButton.getAttribute('title')).toBe('Capture an idea or task (⌘J)');
    expect(screen.getByText('⌘J')).toBeTruthy();
  });
});
