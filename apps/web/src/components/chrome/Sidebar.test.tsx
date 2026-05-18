/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

vi.mock('./slots/ProjectSwitcherSlot', () => ({
  ProjectSwitcherSlot: () => <div data-testid="project-switcher" />,
}));

afterEach(cleanup);
afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  });
  localStorage.setItem('sidebar-collapsed', 'false');
});

describe('Sidebar', () => {
  it('renders GooseHUB in the expanded header', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    expect(screen.getByText('GooseHUB')).toBeTruthy();
  });

  it('does not render the old Goose Hub spelling', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Goose Hub')).toBeNull();
  });
});
