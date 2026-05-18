/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

vi.mock('./slots/ProjectSwitcherSlot', () => ({
  ProjectSwitcherSlot: () => <div data-testid="project-switcher" />,
}));

afterEach(cleanup);

beforeEach(() => {
  const localStorageMock = {
    getItem: vi.fn(() => 'false'),
    setItem: vi.fn(),
  };

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: localStorageMock,
  });
});

describe('Sidebar', () => {
  it('renders the GooseHUB brand in the expanded header', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    expect(screen.getByText('GooseHUB')).toBeTruthy();
  });

  it('does not render the old Goose Hub spacing in the expanded header', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Goose Hub')).toBeNull();
  });
});
