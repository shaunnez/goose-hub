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
    open ? <div data-testid="search-modal">Search</div> : null,
}));

vi.mock('./ChangelogModal', () => ({
  ChangelogModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="changelog-modal">Changelog</div> : null,
}));

afterEach(() => {
  cleanup();
});

describe('TopBar', () => {
  it('shows the Capture shortcut label beside the button text', () => {
    render(<TopBar />);

    const button = screen.getByTestId('capture-button');
    expect(button.textContent).toContain('Capture');
    expect(button.textContent).toContain('⌘J');
  });

  it('opens Capture with the Apple+J keyboard shortcut', () => {
    render(<TopBar />);

    expect(screen.queryByTestId('capture-modal')).toBeNull();

    fireEvent.keyDown(document, { key: 'j', metaKey: true });

    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });
});
