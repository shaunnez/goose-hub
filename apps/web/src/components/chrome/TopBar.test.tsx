/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

import { TopBar } from './TopBar';

const defaultNavigatorPlatform = window.navigator.platform;

function setNavigatorPlatform(platform: string) {
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: platform,
  });
}

afterEach(() => {
  setNavigatorPlatform(defaultNavigatorPlatform);
  cleanup();
});

describe('TopBar', () => {
  it('shows the macOS Capture shortcut hint beside the button label', () => {
    setNavigatorPlatform('MacIntel');

    render(<TopBar />);

    const captureButton = screen.getByTestId('capture-button');
    expect(captureButton.textContent).toContain('Capture');
    expect(screen.getByText('⌘J')).toBeTruthy();
  });

  it('shows the Ctrl-platform Capture shortcut hint beside the button label', () => {
    setNavigatorPlatform('Win32');

    render(<TopBar />);

    const captureButton = screen.getByTestId('capture-button');
    expect(captureButton.textContent).toContain('Capture');
    expect(screen.getByText('Ctrl+J')).toBeTruthy();
  });

  it('opens Capture when Cmd+J is pressed', () => {
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'j', metaKey: true });

    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });

  it('opens Capture when Ctrl+J is pressed', () => {
    render(<TopBar />);

    fireEvent.keyDown(document, { key: 'j', ctrlKey: true });

    expect(screen.getByTestId('capture-modal')).toBeTruthy();
  });
});
