/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sidebar } from './Sidebar';

function createLocalStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
  } as Storage;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal('localStorage', createLocalStorage({ 'sidebar-collapsed': 'true' }));
});

function renderSidebar() {
  render(
    <MemoryRouter>
      <Sidebar activeSlug="goose-hub-self" />
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  it('shows the GOOSEHUB brand when expanded', () => {
    localStorage.setItem('sidebar-collapsed', 'false');

    renderSidebar();

    expect(screen.getByText('GOOSEHUB')).toBeTruthy();
  });

  it('hides the brand text when collapsed by default', () => {
    renderSidebar();

    expect(screen.queryByText('GOOSEHUB')).toBeNull();
  });
});
