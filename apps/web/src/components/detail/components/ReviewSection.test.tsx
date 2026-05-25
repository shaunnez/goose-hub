/** @vitest-environment jsdom */
import type { AgentEventDto } from '@/lib/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewSection } from './ReviewSection';

afterEach(cleanup);

vi.mock('@/lib/api', () => ({
  fetchEvents: vi.fn().mockResolvedValue([]),
}));

const REVIEW_APPROVED: AgentEventDto = {
  id: 10,
  projectId: 'test-proj',
  workItemId: 'github:test/repo#42',
  kind: 'review.completed',
  payload: {
    verdict: 'approved',
    confidence: 0.92,
    criteriaChecks: [
      { criterion: 'Lint clean (0 errors, 0 warnings)', status: 'met' },
      { criterion: 'Type check passes (tsc --strict)', status: 'met' },
      { criterion: 'All tests passing', status: 'unmet', notes: '1 flaky test' },
      { criterion: 'Bundle size within budget', status: 'unclear' },
    ],
    findings: [],
  },
  runId: 'run-1',
  createdAt: new Date().toISOString(),
};

const REVIEW_NEEDS_HUMAN: AgentEventDto = {
  ...REVIEW_APPROVED,
  id: 11,
  payload: {
    verdict: 'needs-human',
    confidence: 0.4,
    criteriaChecks: [],
    findings: [
      {
        severity: 'blocker',
        description: 'Schema migration not reversible',
        file: 'db/migrations/0042.sql',
        line: 12,
        suggestion: 'Add a down migration',
      },
    ],
    escalationReason: 'Reviewer needs human input on migration safety.',
  },
};

const PR_OPENED: AgentEventDto = {
  id: 9,
  projectId: 'test-proj',
  workItemId: 'github:test/repo#42',
  kind: 'pr.opened',
  payload: { prNumber: 123, prUrl: 'https://github.com/test/repo/pull/123' },
  runId: 'run-1',
  createdAt: new Date().toISOString(),
};

const REVIEW_UNKNOWN_VERDICT: AgentEventDto = {
  ...REVIEW_APPROVED,
  id: 12,
  payload: {
    verdict: 'mystery-verdict',
    confidence: 0.5,
    criteriaChecks: [],
    findings: [],
  },
};

function renderSection(events: AgentEventDto[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['events', 'test-proj', '42'], events);
  render(
    <QueryClientProvider client={qc}>
      <ReviewSection projectSlug="test-proj" id="42" />
    </QueryClientProvider>,
  );
}

describe('ReviewSection', () => {
  it('shows empty state when no review event exists', () => {
    renderSection([]);
    expect(screen.getByTestId('review-empty-state')).toBeTruthy();
  });

  it('renders pre-merge checklist with one row per criterion', () => {
    renderSection([REVIEW_APPROVED]);
    const rows = screen.getAllByTestId('review-checklist-row');
    expect(rows).toHaveLength(4);
    expect(rows[0].getAttribute('data-status')).toBe('met');
    expect(rows[2].getAttribute('data-status')).toBe('unmet');
    expect(rows[3].getAttribute('data-status')).toBe('unclear');
  });

  it('renders verdict pill with confidence percent', () => {
    renderSection([REVIEW_APPROVED]);
    const pill = screen.getByTestId('review-verdict-pill');
    expect(pill.textContent).toContain('Approved');
    expect(screen.getByText(/Confidence 92%/)).toBeTruthy();
  });

  it('hides Open PR button when no pr.opened event exists', () => {
    renderSection([REVIEW_APPROVED]);
    expect(screen.queryByTestId('review-open-pr')).toBeNull();
  });

  it('renders Open PR anchor with prUrl when pr.opened event exists', () => {
    renderSection([PR_OPENED, REVIEW_APPROVED]);
    const link = screen.getByTestId('review-open-pr') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://github.com/test/repo/pull/123');
    expect(link.textContent).toContain('Open PR #123');
  });

  it('shows escalation reason for needs-human verdict', () => {
    renderSection([REVIEW_NEEDS_HUMAN]);
    expect(screen.getByText(/Reviewer needs human input/)).toBeTruthy();
  });

  it('renders findings list with severity and file:line', () => {
    renderSection([REVIEW_NEEDS_HUMAN]);
    expect(screen.getByText('Schema migration not reversible')).toBeTruthy();
    expect(screen.getByText('db/migrations/0042.sql:12')).toBeTruthy();
  });

  it('renders disposition pill on findings (#468)', () => {
    const REVIEW_WITH_DISPOSITION: AgentEventDto = {
      ...REVIEW_APPROVED,
      id: 13,
      payload: {
        verdict: 'needs-fix',
        confidence: 0.7,
        criteriaChecks: [{ criterion: 'AC 1', status: 'unmet' }],
        findings: [
          {
            severity: 'blocker',
            description: 'Missing slice.test.ts',
            disposition: 'follow-up',
            dispositionRef: '#234',
          },
          {
            severity: 'blocker',
            description: 'Inline prompt found',
            disposition: 'fixed',
            dispositionRef: 'abc1234',
          },
          {
            severity: 'major',
            description: 'Drift in naming convention',
            disposition: 'out-of-scope',
            dispositionRef: 'cleanup tracked separately',
          },
        ],
      },
    };
    renderSection([REVIEW_WITH_DISPOSITION]);
    const pills = screen.getAllByTestId('review-finding-disposition');
    expect(pills).toHaveLength(3);
    expect(pills[0].textContent).toContain('follow-up #234');
    expect(pills[1].textContent).toContain('fixed');
    expect(pills[2].textContent).toContain('out-of-scope');
  });

  it('falls back to raw verdict string when verdict is not in label map', () => {
    renderSection([REVIEW_UNKNOWN_VERDICT]);
    const pill = screen.getByTestId('review-verdict-pill');
    expect(pill.textContent).toContain('mystery-verdict');
  });
});
