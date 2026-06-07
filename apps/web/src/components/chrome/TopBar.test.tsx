/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';

vi.mock('@/components/ui/CaptureModal', () => ({
  CaptureModal: ({
    open,
  }: {
    open: boolean;
    onClose: () => void;
  }) => (open ? <div data-testid="capture-modal">Capture modal</div> : null),
}));

vi.mock('@/components/search/components/SearchModal', () => ({
  SearchModal: ({
    open,
  }: {
    open: boolean;
    onClose: () => void;
  }) => (open ? <div data-testid="search-modal">Search modal</div> : null),
}));

vi.mock('./ChangelogModal', () => ({
  ChangelogModal: ({
    open,
  }: {
    open: boolean;
    onClose: () => void;
  }) => (open ? <div data-testid="changelog-modal">Changelog modal</div> : null),
}));

afterEach(() => {
  cleanup();
});

describe('TopBar', () => {
  it('shows the Capture shortcut badge in the header', () => {
    render(<TopBar />);

    expect(screen.getByTestId('capture-button').textContent).toContain('Capture');
    expect(screen.getByText('⌘J')).toBeTruthy();
  });

  it('opens the capture modal on meta+j', () => {
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'j', metaKey: true });

    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('keeps the search shortcut wired on ctrl+k', () => {
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });

    expect(screen.getByTestId('search-modal')).toBeTruthy();
  });
});
