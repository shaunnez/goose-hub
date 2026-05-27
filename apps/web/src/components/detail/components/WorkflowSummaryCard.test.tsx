/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { OverviewWorkflowCard } from '../lib/overview-workflow-summary';
import { WorkflowSummaryCard } from './WorkflowSummaryCard';

afterEach(cleanup);

const CARD: OverviewWorkflowCard = {
  key: 'review',
  title: 'Review',
  status: 'Approved',
  statusTone: 'success',
  metrics: [
    { label: 'Confidence', value: '92%' },
    { label: 'Criteria', value: '5/6 met' },
    { label: 'Blockers', value: '0' },
    { label: 'PR', value: '#123 open' },
  ],
  footer: { tokens: 1234, usd: 0.12, label: 'estimated' },
  hrefSection: 'review',
};

describe('WorkflowSummaryCard', () => {
  it('renders compact metrics, status, and cost footer', () => {
    renderCard();

    expect(screen.getByText('Review')).toBeTruthy();
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(screen.getByText('Confidence')).toBeTruthy();
    expect(screen.getByText('92%')).toBeTruthy();
    expect(screen.getByTestId('cost-badge').textContent).toContain('1.2k');
    expect(screen.getByTestId('cost-badge').textContent).toContain('~$0.12');
  });

  it('renders a usable section link when hrefSection exists', () => {
    renderCard();

    const link = screen.getByRole('link', { name: /open review section/i });
    expect(link.getAttribute('href')).toBe('/projects/proj/items/42/review');
  });

  it('renders a readable static card when hrefSection is missing', () => {
    renderCard({ ...CARD, hrefSection: undefined });

    expect(screen.queryByRole('link', { name: /open review section/i })).toBeNull();
    expect(screen.getByText('Review')).toBeTruthy();
    expect(screen.getByText('Approved')).toBeTruthy();
  });

  it('maps snapshot-only section keys onto detail routes', () => {
    renderCard({ ...CARD, key: 'triage', title: 'Triage', hrefSection: 'triage' });

    const link = screen.getByRole('link', { name: /open triage section/i });
    expect(link.getAttribute('href')).toBe('/projects/proj/items/42/repo');
  });
});

function renderCard(card: OverviewWorkflowCard = CARD) {
  return render(
    <MemoryRouter initialEntries={['/projects/proj/items/42']}>
      <Routes>
        <Route path="/projects/:slug/items/:id" element={<WorkflowSummaryCard card={card} />} />
      </Routes>
    </MemoryRouter>,
  );
}
