import type { WorkItemDto } from '@/lib/types';
/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { IssueCard } from './IssueCard';

afterEach(cleanup);

const BASE_ITEM: WorkItemDto = {
  id: '1',
  externalId: '42',
  repoRef: 'shaunnez/goose-hub',
  title: 'Fix the login bug',
  body: '',
  type: 'bug',
  priority: 'high',
  mode: 'supervised',
  state: 'factory:in-progress',
  authorIsOwner: true,
  schedule: 'current',
  exec: 'serial',
  dependsOn: [],
  blocks: [],
  createdAt: new Date(Date.now() - 3600000).toISOString(),
};

function renderCard(item = BASE_ITEM) {
  render(
    <MemoryRouter>
      <IssueCard item={item} projectSlug="goose-hub-self" />
    </MemoryRouter>,
  );
}

describe('IssueCard', () => {
  it('renders the issue title', () => {
    renderCard();
    expect(screen.getByText('Fix the login bug')).toBeTruthy();
  });

  it('renders the issue number', () => {
    renderCard();
    expect(screen.getByText('#42')).toBeTruthy();
  });

  it('renders the state label', () => {
    renderCard();
    expect(screen.getByText('in-progress')).toBeTruthy();
  });

  it('renders the priority pill', () => {
    renderCard();
    // The Pill component renders "high" as text
    const pills = screen.getAllByText('high');
    expect(pills.length).toBeGreaterThan(0);
  });

  it('renders the cost placeholder', () => {
    renderCard();
    expect(screen.getByTestId('cost-placeholder').textContent).toBe('$—');
  });

  it('truncates long titles at 55 chars', () => {
    const longTitle = 'A'.repeat(60);
    renderCard({ ...BASE_ITEM, title: longTitle });
    const link = screen.getByRole('link');
    // Title text in the div should be truncated with ellipsis
    expect(link.textContent).toContain('…');
  });
});
