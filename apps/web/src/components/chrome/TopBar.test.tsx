/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

afterEach(() => {
  cleanup();
});

describe('TopBar', () => {
  it('shows the Capture shortcut badge in the header button', () => {
    render(<TopBar breadcrumb="Inbox" />);

    const captureButton = screen.getByTestId('capture-button');
    expect(screen.getByTestId('capture-shortcut-badge')).toBeTruthy();
    expect(within(captureButton).getByText('⌘J')).toBeTruthy();
  });

  it('exposes capture keyboard shortcut metadata on the header button', () => {
    render(<TopBar breadcrumb="Inbox" />);

    expect(screen.getByTestId('capture-button').getAttribute('aria-keyshortcuts')).toBe(
      'Meta+J Control+J',
    );
  });

  it('opens capture when the Meta+J shortcut is pressed', () => {
    render(<TopBar breadcrumb="Inbox" />);

    fireEvent.keyDown(document, { key: 'j', metaKey: true });

    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('opens capture when the Ctrl+J shortcut is pressed', () => {
    render(<TopBar breadcrumb="Inbox" />);

    fireEvent.keyDown(document, { key: 'j', ctrlKey: true });

    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });
});
