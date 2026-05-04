/** @vitest-environment jsdom */
import type { AgentEventDto } from '@/lib/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InvestigationSection } from './InvestigationSection';

afterEach(cleanup);

vi.mock('@/lib/api', () => ({
  fetchEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/markdown', () => ({
  renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

const INVESTIGATION_EVENT: AgentEventDto = {
  id: 1,
  projectId: 'goose-hub-self',
  workItemId: 'github:shaunnez/goose-hub#42',
  kind: 'agent.investigation-complete',
  payload: {
    investigate: {
      findings: 'Root cause found in auth module.',
      keyFiles: [
        { path: 'src/auth/login.ts', reason: 'Entry point for authentication flow' },
        { path: 'src/auth/session.ts', reason: 'Session management' },
      ],
      confidence: 'high',
      openQuestions: ['Does this affect the mobile app?'],
      decisionSummaries: [{ step: 'initial', summary: 'Reviewed auth logs' }],
    },
  },
  runId: 'run-1',
  createdAt: new Date().toISOString(),
};

function renderSection(events: AgentEventDto[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['events', 'test-proj', '42'], events);
  render(
    <QueryClientProvider client={qc}>
      <InvestigationSection projectSlug="test-proj" id="42" />
    </QueryClientProvider>,
  );
}

describe('InvestigationSection', () => {
  it('shows empty state when no investigation events exist', () => {
    renderSection([]);
    expect(screen.getByTestId('investigation-empty-state')).toBeTruthy();
  });

  it('shows step label in empty state', () => {
    renderSection([]);
    expect(screen.getByText('03. Investigation')).toBeTruthy();
  });

  it('shows section title in empty state', () => {
    renderSection([]);
    expect(screen.getByText('Findings & confidence')).toBeTruthy();
  });

  it('shows "No investigation yet" heading in empty state', () => {
    renderSection([]);
    expect(screen.getByText('No investigation yet')).toBeTruthy();
  });

  it('shows descriptive sub-copy in empty state', () => {
    renderSection([]);
    expect(screen.getByTestId('investigation-empty-description')).toBeTruthy();
  });

  it('renders findings when investigation event is present', () => {
    renderSection([INVESTIGATION_EVENT]);
    expect(screen.getByTestId('investigation-section')).toBeTruthy();
    expect(screen.getByTestId('findings-content')).toBeTruthy();
  });

  it('displays the correct confidence badge for high confidence', () => {
    renderSection([INVESTIGATION_EVENT]);
    const badge = screen.getByTestId('confidence-badge');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('high');
  });

  it('renders key files list', () => {
    renderSection([INVESTIGATION_EVENT]);
    const filesList = screen.getByTestId('key-files-list');
    expect(filesList).toBeTruthy();
    expect(screen.getByText('src/auth/login.ts')).toBeTruthy();
    expect(screen.getByText('src/auth/session.ts')).toBeTruthy();
  });

  it('renders open questions list', () => {
    renderSection([INVESTIGATION_EVENT]);
    const questionsList = screen.getByTestId('open-questions-list');
    expect(questionsList).toBeTruthy();
    expect(screen.getByText('Does this affect the mobile app?')).toBeTruthy();
  });

  it('shows low confidence badge with appropriate styling', () => {
    const lowConfEvent: AgentEventDto = {
      ...INVESTIGATION_EVENT,
      payload: {
        investigate: {
          ...(INVESTIGATION_EVENT.payload as { investigate: Record<string, unknown> }).investigate,
          confidence: 'low',
        },
      },
    };
    renderSection([lowConfEvent]);
    const badge = screen.getByTestId('confidence-badge');
    expect(badge.textContent).toContain('low');
    expect(badge.className).toContain('text-red-400');
  });

  it('shows medium confidence badge', () => {
    const medConfEvent: AgentEventDto = {
      ...INVESTIGATION_EVENT,
      payload: {
        investigate: {
          ...(INVESTIGATION_EVENT.payload as { investigate: Record<string, unknown> }).investigate,
          confidence: 'medium',
        },
      },
    };
    renderSection([medConfEvent]);
    const badge = screen.getByTestId('confidence-badge');
    expect(badge.textContent).toContain('medium');
    expect(badge.className).toContain('text-yellow-400');
  });

  it('does not render key files section when list is empty', () => {
    const noFilesEvent: AgentEventDto = {
      ...INVESTIGATION_EVENT,
      payload: {
        investigate: {
          ...(INVESTIGATION_EVENT.payload as { investigate: Record<string, unknown> }).investigate,
          keyFiles: [],
        },
      },
    };
    renderSection([noFilesEvent]);
    expect(screen.queryByTestId('key-files-list')).toBeNull();
  });

  it('does not render open questions when list is empty', () => {
    const noQuestionsEvent: AgentEventDto = {
      ...INVESTIGATION_EVENT,
      payload: {
        investigate: {
          ...(INVESTIGATION_EVENT.payload as { investigate: Record<string, unknown> }).investigate,
          openQuestions: [],
        },
      },
    };
    renderSection([noQuestionsEvent]);
    expect(screen.queryByTestId('open-questions-list')).toBeNull();
  });
});
