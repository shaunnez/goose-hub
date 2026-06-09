/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';

vi.mock('@/components/search/components/SearchModal', () => ({
  SearchModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="search-modal">Search modal</div> : null,
}));

vi.mock('@/components/ui/CaptureModal', () => ({
  CaptureModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="capture-modal">Capture modal</div> : null,
}));

vi.mock('./ChangelogModal', () => ({
  ChangelogModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="changelog-modal">Changelog modal</div> : null,
}));

afterEach(() => {
  cleanup();
});

describe('TopBar', () => {
  it('shows the capture shortcut chip on the button', () => {
    render(<TopBar />);

    expect(screen.getByTestId('capture-button')).toBeTruthy();
    expect(screen.getByText('⌘J')).toBeTruthy();
  });

  it('opens the capture modal on Command+J', () => {
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'j', metaKey: true });

    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('does not open the capture modal without the shortcut modifier', () => {
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'j' });

    expect(screen.queryByTestId('capture-modal')).toBeNull();
  });
});
