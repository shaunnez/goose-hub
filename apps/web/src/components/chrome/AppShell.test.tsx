/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';

vi.mock('./Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));

vi.mock('./slots/ProjectSwitcherSlot', () => ({
  ProjectSwitcherSlot: () => null,
}));

function renderDetailRoute() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/goose-hub-self/items/64']}>
        <Routes>
          <Route
            path="/projects/:slug/items/:id"
            element={
              <AppShell breadcrumb={<span>Detail</span>}>
                <div data-testid="detail-content" />
              </AppShell>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AppShell', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps the shared header visible on detail routes', () => {
    renderDetailRoute();

    expect(screen.getByTestId('top-bar')).toBeTruthy();
    expect(screen.getByTestId('detail-content')).toBeTruthy();
  });
});
