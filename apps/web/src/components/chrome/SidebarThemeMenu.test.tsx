/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

vi.mock('./slots/ProjectSwitcherSlot', () => ({
  ProjectSwitcherSlot: () => <div data-testid="project-switcher-slot">Project switcher</div>,
}));

function renderSidebar() {
  render(
    <MemoryRouter>
      <Sidebar activeSlug="goose-hub-self" />
    </MemoryRouter>,
  );
}

describe('Sidebar theme menu', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('sidebar-collapsed', 'false');
    document.documentElement.setAttribute('data-theme', 'dark');
  });

  afterEach(() => {
    cleanup();
  });

  it('opens a theme menu from the sidebar', () => {
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));

    expect(screen.getByRole('menu', { name: 'Theme' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: 'Light' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toBeTruthy();
  });

  it('switches to light mode and persists the choice', () => {
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Light' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('hydrates the active theme from localStorage', () => {
    localStorage.setItem('theme', 'light');

    // Rendering the sidebar directly should still sync the stored theme onto <html>.
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(screen.getByRole('menuitemradio', { name: 'Light' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });
});
