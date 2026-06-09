/** @vitest-environment jsdom */
import type { ProjectSummary } from '@/lib/types';
import { useActiveProject } from '@/state/active-project';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectSwitcherSlot } from './ProjectSwitcherSlot';

vi.mock('@/state/active-project', () => ({
  useActiveProject: vi.fn(),
}));

const setActiveSlug = vi.fn();

function makeProject(overrides: Partial<ProjectSummary>): ProjectSummary {
  return {
    id: overrides.slug ?? 'goose-hub-self',
    name: overrides.name ?? 'Goose Hub (self)',
    slug: overrides.slug ?? 'goose-hub-self',
    color: overrides.color ?? '#7c3aed',
    source: overrides.source ?? { kind: 'github', repo: 'shaunnez/goose-hub' },
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

function renderSwitcher({
  activeSlug,
  route,
}: {
  activeSlug?: string;
  route: string;
}) {
  // Keep the test data small so route-derived selection state is easy to verify.
  vi.mocked(useActiveProject).mockReturnValue({
    projects: [
      makeProject({}),
      makeProject({ id: 'other-project', name: 'Other Project', slug: 'other-project' }),
    ],
    loading: false,
    error: null,
    activeSlug: activeSlug ?? null,
    setActiveSlug,
  });

  render(
    <MemoryRouter initialEntries={[route]}>
      <ProjectSwitcherSlot activeSlug={activeSlug} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('ProjectSwitcherSlot', () => {
  afterEach(() => {
    cleanup();
    setActiveSlug.mockReset();
  });

  it('shows All Projects as selected on /projects/all', () => {
    renderSwitcher({ route: '/projects/all' });

    expect(screen.getByLabelText('Active project')).toHaveProperty('value', 'all');
    expect(screen.getByRole('option', { name: 'All Projects' })).toHaveProperty('selected', true);
  });

  it('navigates to the all-projects route when selecting All Projects', () => {
    renderSwitcher({ activeSlug: 'goose-hub-self', route: '/projects/goose-hub-self' });

    fireEvent.change(screen.getByLabelText('Active project'), {
      target: { value: 'all' },
    });

    expect(setActiveSlug).toHaveBeenCalledWith('all');
    expect(screen.getByTestId('location-probe').textContent).toBe('/projects/all');
  });

  it('keeps project routes selected on specific project pages', () => {
    renderSwitcher({ activeSlug: 'goose-hub-self', route: '/projects/goose-hub-self' });

    expect(screen.getByLabelText('Active project')).toHaveProperty('value', 'goose-hub-self');
    expect(screen.getByRole('option', { name: 'Goose Hub (self)' })).toHaveProperty(
      'selected',
      true,
    );
  });
});
