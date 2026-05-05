/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

vi.mock('@/state/active-project', () => ({
  useActiveProject: () => ({
    projects: [],
    loading: false,
    error: null,
    activeSlug: null,
    setActiveSlug: vi.fn(),
  }),
}));

beforeEach(() => {
  // Return 'false' for sidebar-collapsed so the header text is visible (not collapsed)
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'sidebar-collapsed' ? 'false' : null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  });
});

describe('Sidebar header label', () => {
  it('displays "Agentic OS" not "Goose Hub"', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    expect(screen.getByText('Agentic OS')).toBeTruthy();
    expect(screen.queryByText('Goose Hub')).toBeNull();
  });
});
