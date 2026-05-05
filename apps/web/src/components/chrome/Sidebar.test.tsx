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
    activeSlug: 'test-project',
    setActiveSlug: vi.fn(),
  }),
}));

// Provide a working localStorage so Sidebar reads sidebar-collapsed = 'false' (expanded)
const localStorageMap = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => localStorageMap.get(key) ?? null,
  setItem: (key: string, value: string) => {
    localStorageMap.set(key, value);
  },
  removeItem: (key: string) => {
    localStorageMap.delete(key);
  },
  clear: () => {
    localStorageMap.clear();
  },
  get length() {
    return localStorageMap.size;
  },
  key: (index: number) => [...localStorageMap.keys()][index] ?? null,
};

beforeEach(() => {
  localStorageMap.clear();
  localStorageMap.set('sidebar-collapsed', 'false');
  vi.stubGlobal('localStorage', localStorageMock);
});

describe('Sidebar', () => {
  it('displays "Agentic OS" as the header label', () => {
    render(
      <MemoryRouter>
        <Sidebar activeSlug="test-project" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Agentic OS')).toBeTruthy();
  });

  it('does not display "Goose Hub" as the header label', () => {
    render(
      <MemoryRouter>
        <Sidebar activeSlug="test-project" />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Goose Hub')).toBeNull();
  });
});
