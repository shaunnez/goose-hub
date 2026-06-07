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

afterEach(cleanup);

describe('TopBar', () => {
  it('shows ⌘J kbd label on Capture button', () => {
    render(<TopBar />);
    const captureBtn = screen.getByTestId('capture-button');
    expect(captureBtn.querySelector('kbd')).not.toBeNull();
    expect(captureBtn.querySelector('kbd')?.textContent).toContain('J');
  });

  it('opens Capture modal on ⌘J keydown', () => {
    render(<TopBar />);
    expect(screen.queryByTestId('capture-modal')).toBeNull();
    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('opens Capture modal on Ctrl+J keydown', () => {
    render(<TopBar />);
    expect(screen.queryByTestId('capture-modal')).toBeNull();
    fireEvent.keyDown(document, { key: 'j', ctrlKey: true });
    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('shows ⌘K kbd label on Search button', () => {
    render(<TopBar />);
    const searchBtn = screen.getByTestId('search-button');
    expect(searchBtn.querySelector('kbd')?.textContent).toContain('K');
  });
});
