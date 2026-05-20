/** @vitest-environment jsdom */

import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

vi.mock('./slots/ProjectSwitcherSlot', () => ({
  ProjectSwitcherSlot: () => <div data-testid="project-switcher">Project switcher</div>,
}));

describe('Sidebar brand label', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows GOOSEHUB when the sidebar starts expanded', () => {
    localStorage.setItem('sidebar-collapsed', 'false');

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Sidebar activeSlug="goose-hub-self" />
      </MemoryRouter>,
    );

    expect(html).toContain('GOOSEHUB');
    expect(html).not.toContain('Goose Hub');
  });

  it('hides the wordmark when the sidebar starts collapsed', () => {
    localStorage.setItem('sidebar-collapsed', 'true');

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Sidebar activeSlug="goose-hub-self" />
      </MemoryRouter>,
    );

    expect(html).not.toContain('GOOSEHUB');
    expect(html).not.toContain('Goose Hub');
  });
});
