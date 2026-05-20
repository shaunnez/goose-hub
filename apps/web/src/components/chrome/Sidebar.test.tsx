/** @vitest-environment jsdom */
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

vi.mock('./slots/ProjectSwitcherSlot', () => ({
  ProjectSwitcherSlot: () => null,
}));

afterEach(() => {
  localStorage.clear();
});

beforeEach(() => {
  localStorage.setItem('sidebar-collapsed', 'false');
});

function renderSidebar() {
  return renderToStaticMarkup(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  it('renders Agentic OS branding when expanded', () => {
    const html = renderSidebar();
    expect(html).toContain('Agentic OS');
    expect(html).not.toContain('Goose Hub');
  });

  it('hides the brand text when collapsed', () => {
    localStorage.setItem('sidebar-collapsed', 'true');

    const html = renderSidebar();
    expect(html).not.toContain('Agentic OS');
  });
});
