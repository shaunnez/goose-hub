/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

// Mock ProjectSwitcherSlot — it calls useActiveProject which needs a running server
vi.mock('./slots/ProjectSwitcherSlot', () => ({
  ProjectSwitcherSlot: () => <div data-testid="project-switcher-mock" />,
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Sidebar header label', () => {
  it('displays "Agentic OS" after expanding the sidebar', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    // Sidebar starts collapsed — expand it (toggle wraps localStorage in try-catch)
    fireEvent.click(screen.getByTitle('Expand sidebar'));
    expect(screen.getByText('Agentic OS')).toBeTruthy();
  });

  it('does NOT display "Goose Hub" after expanding the sidebar', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTitle('Expand sidebar'));
    expect(screen.queryByText('Goose Hub')).toBeNull();
  });
});
