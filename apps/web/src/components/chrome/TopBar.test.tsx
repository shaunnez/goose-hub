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
  it('shows the capture shortcut label on the header button', () => {
    render(<TopBar />);

    const button = screen.getByTestId('capture-button');
    expect(button.getAttribute('title')).toBe('Capture an idea or task (⌘J)');
    expect(button.textContent).toContain('Capture');
    expect(button.textContent).toContain('⌘J');
  });

  it('opens the capture modal when the capture button is clicked', () => {
    render(<TopBar />);

    const button = screen.getByTestId('capture-button');
    fireEvent.click(button);

    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('opens the capture modal on Cmd+J', () => {
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'j', metaKey: true });

    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('opens the capture modal on Ctrl+J', () => {
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'j', ctrlKey: true });

    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });
});
