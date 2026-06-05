/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';

vi.mock('@/components/search/components/SearchModal', () => ({
  SearchModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="search-modal">search open</div> : null,
}));

vi.mock('@/components/ui/CaptureModal', () => ({
  CaptureModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="capture-modal">capture open</div> : null,
}));

vi.mock('./ChangelogModal', () => ({
  ChangelogModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="changelog-modal">changelog open</div> : null,
}));

afterEach(cleanup);

describe('TopBar', () => {
  it('shows the Capture shortcut hint and title text', () => {
    render(<TopBar />);

    const captureButton = screen.getByTestId('capture-button');

    expect(captureButton.getAttribute('title')).toBe('Capture an idea or task (⌘J)');
    expect(within(captureButton).getByText('⌘J')).toBeTruthy();
  });

  it('opens Capture with Meta+J without opening Search', () => {
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'j', metaKey: true });

    expect(screen.getByTestId('capture-modal')).toBeTruthy();
    expect(screen.queryByTestId('search-modal')).toBeNull();
  });

  it('opens Capture with Ctrl+J without opening Search', () => {
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'j', ctrlKey: true });

    expect(screen.getByTestId('capture-modal')).toBeTruthy();
    expect(screen.queryByTestId('search-modal')).toBeNull();
  });
});
