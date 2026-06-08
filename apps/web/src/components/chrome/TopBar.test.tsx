/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';

afterEach(cleanup);

vi.mock('lucide-react', () => ({
  Plus: () => <span data-testid="icon-plus" />,
  ScrollText: () => <span data-testid="icon-scroll-text" />,
  Search: () => <span data-testid="icon-search" />,
}));

vi.mock('@/components/ui/CaptureModal', () => ({
  CaptureModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="capture-modal">Capture idea</div> : null,
}));

vi.mock('@/components/search/components/SearchModal', () => ({
  SearchModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="search-modal">Search</div> : null,
}));

vi.mock('./ChangelogModal', () => ({
  ChangelogModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="changelog-modal">Changelog</div> : null,
}));

describe('TopBar', () => {
  it('opens Capture with Meta/Ctrl+J', () => {
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'j', metaKey: true });

    expect(screen.getByTestId('capture-modal')).toBeTruthy();
    expect(screen.queryByTestId('search-modal')).toBeNull();
  });

  it('opens Search with Meta/Ctrl+K without opening Capture', () => {
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'k', metaKey: true });

    expect(screen.getByTestId('search-modal')).toBeTruthy();
    expect(screen.queryByTestId('capture-modal')).toBeNull();
  });

  it('shows the Capture shortcut label in the button', () => {
    render(<TopBar />);

    const captureButton = screen.getByTestId('capture-button');
    expect(captureButton.textContent).toContain('Capture');
    expect(captureButton.textContent).toContain('⌘J');
  });
});
