/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';

vi.mock('@/components/search/components/SearchModal', () => ({
  SearchModal: ({ open }: { open: boolean }) => (
    <div data-testid="search-modal">{open ? 'open' : 'closed'}</div>
  ),
}));

vi.mock('@/components/ui/CaptureModal', () => ({
  CaptureModal: ({ open }: { open: boolean }) => (
    <div data-testid="capture-modal">{open ? 'open' : 'closed'}</div>
  ),
}));

vi.mock('./ChangelogModal', () => ({
  ChangelogModal: ({ open }: { open: boolean }) => (
    <div data-testid="changelog-modal">{open ? 'open' : 'closed'}</div>
  ),
}));

afterEach(cleanup);

describe('TopBar', () => {
  it('shows the Capture shortcut badge and title copy', () => {
    render(<TopBar />);

    const captureButton = screen.getByTestId('capture-button');

    expect(captureButton.getAttribute('title')).toBe('Capture an idea or task (⌘J)');
    expect(screen.getByText('⌘J')).toBeTruthy();
  });

  it('opens Capture with Meta+J but not plain J', () => {
    render(<TopBar />);

    expect(screen.getByTestId('capture-modal').textContent).toBe('closed');

    fireEvent.keyDown(document, { key: 'j' });
    expect(screen.getByTestId('capture-modal').textContent).toBe('closed');

    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(screen.getByTestId('capture-modal').textContent).toBe('open');
  });

  it('opens Capture with Ctrl+J', () => {
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'j', ctrlKey: true });

    expect(screen.getByTestId('capture-modal').textContent).toBe('open');
  });

  it('keeps the Search shortcut working', () => {
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'k', metaKey: true });

    expect(screen.getByTestId('search-modal').textContent).toBe('open');
  });
});
