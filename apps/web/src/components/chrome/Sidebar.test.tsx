/** @vitest-environment jsdom */
import { ActiveProjectProvider } from '@/state/active-project';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(),
    setItem: vi.fn(),
  });
});

function renderSidebar() {
  render(
    <MemoryRouter>
      <ActiveProjectProvider initialSlug="goose-hub-self">
        <Sidebar />
      </ActiveProjectProvider>
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  it('shows the GooseHUB wordmark when expanded', () => {
    vi.mocked(localStorage.getItem).mockReturnValue('false');
    renderSidebar();

    expect(screen.getByText('GooseHUB')).toBeTruthy();
  });

  it('does not show the wordmark when collapsed by default', () => {
    vi.mocked(localStorage.getItem).mockReturnValue(null);
    renderSidebar();

    expect(screen.queryByText('GooseHUB')).toBeNull();
  });
});
