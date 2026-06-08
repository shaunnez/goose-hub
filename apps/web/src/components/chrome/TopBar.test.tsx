/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';

afterEach(cleanup);

// Minimal mocks so TopBar renders without network or modal internals
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

function renderTopBar() {
  return render(<TopBar />);
}

describe('TopBar — Capture keyboard shortcut and kbd label', () => {
  it('AC-2: Capture button renders ⌘J kbd element', () => {
    renderTopBar();
    const captureButton = screen.getByTestId('capture-button');
    const kbd = captureButton.querySelector('kbd');
    expect(kbd).not.toBeNull();
    expect(kbd?.textContent).toContain('J');
  });

  it('AC-3: Capture button title includes keyboard shortcut', () => {
    renderTopBar();
    const captureButton = screen.getByTestId('capture-button');
    expect(captureButton.getAttribute('title')).toContain('⌘J');
  });

  it('AC-1: Cmd+J opens Capture modal', () => {
    renderTopBar();
    expect(screen.queryByTestId('capture-modal')).toBeNull();
    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('AC-1: Ctrl+J opens Capture modal', () => {
    renderTopBar();
    expect(screen.queryByTestId('capture-modal')).toBeNull();
    fireEvent.keyDown(document, { key: 'j', ctrlKey: true });
    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('AC-1: Cmd+J toggles Capture modal closed', () => {
    renderTopBar();
    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(screen.getByTestId('capture-modal')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'j', metaKey: true });
    expect(screen.queryByTestId('capture-modal')).toBeNull();
  });

  it('Cmd+K still opens Search modal', () => {
    renderTopBar();
    expect(screen.queryByTestId('search-modal')).toBeNull();
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(screen.getByTestId('search-modal')).toBeTruthy();
  });
});
