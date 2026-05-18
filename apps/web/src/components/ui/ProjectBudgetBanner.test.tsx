/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectBudgetBanner } from './ProjectBudgetBanner';

afterEach(cleanup);

const blockedStatus = {
  projectId: 'goose-hub-self',
  dailyTokensUsed: 62_492_147,
  dailyTokensLimit: 50_000_000,
  dailyCostUsd: 77.901771,
  dailyBudgetExceeded: true,
  resetsAtUtc: '2026-05-15T00:00:00.000Z',
  lastExceededAt: '2026-05-14T07:14:37Z',
};

describe('ProjectBudgetBanner', () => {
  it('renders the daily token limit block clearly', () => {
    render(
      <MemoryRouter>
        <ProjectBudgetBanner status={blockedStatus} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('project-budget-banner').textContent).toContain(
      'Daily token budget reached',
    );
    expect(screen.getByTestId('project-budget-banner').textContent).toContain('62.5M / 50.0M');
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
  });

  it('renders nothing when the project is under budget', () => {
    const { container } = render(
      <MemoryRouter>
        <ProjectBudgetBanner status={{ ...blockedStatus, dailyBudgetExceeded: false }} />
      </MemoryRouter>,
    );

    expect(container.querySelector('[data-testid="project-budget-banner"]')).toBeNull();
  });
});
