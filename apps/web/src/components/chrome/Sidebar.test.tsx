/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

vi.mock('./slots/ProjectSwitcherSlot', () => ({
  ProjectSwitcherSlot: () => null,
}));

afterEach(cleanup);

describe('Sidebar header label', () => {
  it('displays "Agentic OS" after expanding sidebar', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    // Default is collapsed; click expand
    const expandBtn = screen.getByTitle('Expand sidebar');
    fireEvent.click(expandBtn);
    expect(screen.getByText('Agentic OS')).toBeTruthy();
  });

  it('does not display "Goose Hub" after expanding sidebar', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    const expandBtn = screen.getByTitle('Expand sidebar');
    fireEvent.click(expandBtn);
    expect(screen.queryByText('Goose Hub')).toBeNull();
  });
});
