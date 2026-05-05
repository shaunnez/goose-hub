/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

vi.mock('./slots/ProjectSwitcherSlot', () => ({
  ProjectSwitcherSlot: () => <div data-testid="project-switcher-mock" />,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSidebar() {
  render(
    <MemoryRouter>
      <Sidebar activeSlug="goose-hub-self" />
    </MemoryRouter>,
  );
}

function stubStorage(value: string | null) {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn().mockReturnValue(value),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
}

describe('Sidebar logo', () => {
  describe('when collapsed (localStorage key absent)', () => {
    beforeEach(() => {
      stubStorage(null);
    });

    it('shows the G letter badge', () => {
      renderSidebar();
      expect(screen.getByTestId('logo-g-badge').textContent).toBe('G');
    });

    it('does not show full brand name', () => {
      renderSidebar();
      expect(screen.queryByText('Goose Hub')).toBeNull();
    });
  });

  describe('when expanded (sidebar-collapsed = "false")', () => {
    beforeEach(() => {
      stubStorage('false');
    });

    it('shows the full brand name', () => {
      renderSidebar();
      expect(screen.getByText('Goose Hub')).toBeTruthy();
    });

    it('does not show the G badge', () => {
      renderSidebar();
      expect(screen.queryByTestId('logo-g-badge')).toBeNull();
    });
  });
});
