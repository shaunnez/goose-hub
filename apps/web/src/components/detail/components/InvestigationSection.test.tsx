/** @vitest-environment jsdom */
import type { AgentEventDto } from '@/lib/types';
import { ActiveProjectProvider } from '@/state/active-project';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InvestigationSection } from './InvestigationSection';

vi.mock('react', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const { act } =
    await vi.importActual<typeof import('react-dom/test-utils')>('react-dom/test-utils');

  return {
    ...React,
    act: React.act ?? act,
  };
});

afterEach(cleanup);

vi.mock('@/lib/api', () => ({
  fetchEvents: vi.fn().mockResolvedValue([]),
  fetchComments: vi.fn().mockResolvedValue([]),
  fetchPersonaNames: vi.fn().mockResolvedValue([]),
  fetchProjects: vi.fn().mockResolvedValue([
    {
      id: 'test-proj',
      name: 'Test Project',
      slug: 'test-proj',
      color: '#888888',
      source: { kind: 'github', repo: 'owner/repo' },
      defaultBranch: 'main',
    },
  ]),
  addComment: vi.fn(),
  transitionState: vi.fn(),
  fetchEngineeringSpec: vi.fn().mockResolvedValue(null),
  fetchAcceptanceContract: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/markdown', () => ({
  renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

vi.mock('./PlaywrightCaptureSection', () => ({
  PlaywrightCaptureSection: () => (
    <div data-testid="playwright-capture-section">Playwright capture content</div>
  ),
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
      decisionSummaries: [{ kind: 'READ', summary: 'Reviewed auth logs' }],
    },
  },
  runId: 'run-1',
  createdAt: new Date().toISOString(),
};

function investigationEvent(partial: Partial<AgentEventDto> = {}): AgentEventDto {
  return {
    ...INVESTIGATION_EVENT,
    payload: {
      investigate: {
        ...(INVESTIGATION_EVENT.payload as { investigate: Record<string, unknown> }).investigate,
      },
    },
    ...partial,
  };
}

function toolCallEvent(partial: Partial<AgentEventDto> = {}): AgentEventDto {
  return {
    id: 100,
    projectId: 'goose-hub-self',
    workItemId: 'github:shaunnez/goose-hub#42',
    kind: 'agent.tool-call',
    payload: {},
    runId: 'run-1',
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

function renderSection({
  events = [],
  acceptanceContract = null,
  comments = [],
  itemState,
  itemType,
  spec = null,
}: {
  events?: AgentEventDto[];
  acceptanceContract?: Record<string, unknown> | null;
  comments?: Array<{ id: number; body: string; authorLogin: string; createdAt: string }>;
  itemState?: string;
  itemType?: string;
  spec?: Record<string, unknown> | null;
} = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['events', 'test-proj', '42'], events);
  qc.setQueryData(['comments', 'test-proj', '42'], comments);
  qc.setQueryData(['acceptance-contract', 'test-proj', '42'], acceptanceContract);
  qc.setQueryData(['spec', 'test-proj', '42'], spec);
  render(
    <QueryClientProvider client={qc}>
      <ActiveProjectProvider initialSlug="test-proj">
        <InvestigationSection
          projectSlug="test-proj"
          id="42"
          itemState={itemState}
          itemType={itemType}
        />
      </ActiveProjectProvider>
    </QueryClientProvider>,
  );
}

describe('InvestigationSection', () => {
  it('shows empty state when no investigation events exist', () => {
    renderSection();
    expect(screen.getByTestId('investigation-empty-state')).toBeTruthy();
    expect(screen.getByText('Investigation has not run yet.')).toBeTruthy();
  });

  it('renders findings when investigation event is present', () => {
    renderSection({ events: [INVESTIGATION_EVENT] });
    expect(screen.getByTestId('investigation-section')).toBeTruthy();
    expect(screen.getByTestId('findings-content')).toBeTruthy();
  });

  it('displays the correct confidence badge for high confidence', () => {
    renderSection({ events: [INVESTIGATION_EVENT] });
    const badge = screen.getByTestId('confidence-badge');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('high');
  });

  it('renders key files list', () => {
    renderSection({ events: [INVESTIGATION_EVENT] });
    const filesList = screen.getByTestId('key-files-list');
    expect(filesList).toBeTruthy();
    expect(screen.getByText('src/auth/login.ts')).toBeTruthy();
    expect(screen.getByText('src/auth/session.ts')).toBeTruthy();
  });

  it('renders open questions list', () => {
    renderSection({ events: [INVESTIGATION_EVENT] });
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
    renderSection({ events: [lowConfEvent] });
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
    renderSection({ events: [medConfEvent] });
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
    renderSection({ events: [noFilesEvent] });
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
    renderSection({ events: [noQuestionsEvent] });
    expect(screen.queryByTestId('open-questions-list')).toBeNull();
  });

  it('renders the newest investigation event regardless of event order', () => {
    const older = investigationEvent({
      id: 10,
      runId: 'old-run',
      payload: {
        investigate: {
          ...(INVESTIGATION_EVENT.payload as { investigate: Record<string, unknown> }).investigate,
          findings: 'Old finding',
        },
      },
    });
    const newer = investigationEvent({
      id: 20,
      runId: 'new-run',
      payload: {
        investigate: {
          ...(INVESTIGATION_EVENT.payload as { investigate: Record<string, unknown> }).investigate,
          findings: 'New finding',
        },
      },
    });

    renderSection({ events: [newer, older] });

    expect(screen.getByText('New finding')).toBeTruthy();
    expect(screen.queryByText('Old finding')).toBeNull();
  });

  it('counts tool calls only from the displayed investigation run', () => {
    const older = investigationEvent({ id: 10, runId: 'old-run' });
    const newer = investigationEvent({ id: 20, runId: 'new-run' });
    const oldRunRead = toolCallEvent({
      id: 11,
      runId: 'old-run',
      payload: { tool_name: 'Read', tool_input: { file_path: 'old.ts' } },
    });
    const newRunSearch = toolCallEvent({
      id: 21,
      runId: 'new-run',
      payload: {
        tool_name: 'Bash',
        tool_input: { command: 'rg -n "GOOSEHUB|Goose Hub" apps/web/src' },
      },
    });

    renderSection({ events: [newer, newRunSearch, older, oldRunRead] });

    expect(screen.getByText('0 file reads · 1 search')).toBeTruthy();
  });

  it('renders findings expanded and sibling sections collapsed until opened', () => {
    renderSection({
      events: [INVESTIGATION_EVENT],
      itemState: 'factory:dev-ready',
      itemType: 'bug',
      comments: [
        {
          id: 99,
          body: 'Human review notes:\n\nCheck the auth redirect.',
          authorLogin: 'reviewer',
          createdAt: new Date().toISOString(),
        },
      ],
      acceptanceContract: {
        source: 'engineering-spec',
        criteria: [
          {
            id: 'AC1',
            statement: 'Acceptance criteria start collapsed.',
            verifyCommand: 'pnpm vitest run InvestigationSection.test.tsx',
          },
        ],
      },
      spec: {
        pipelineRunId: 'run-1',
        objective: 'Ship consistent investigation accordions.',
        workPackages: [
          {
            id: 'WP1',
            filesOwned: ['apps/web/src/components/detail/components/InvestigationSection.tsx'],
            builderTier: 'standard',
          },
        ],
        acceptanceCriteria: [
          {
            id: 'AC1',
            statement: 'Engineering spec is collapsed by default.',
            verifyCommand: 'pnpm vitest run InvestigationSection.test.tsx',
          },
        ],
        acceptanceCriteriaCount: 1,
      },
    });

    expect(screen.getByTestId('findings-content')).toBeTruthy();
    expect(screen.queryByText('Acceptance criteria start collapsed.')).toBeNull();
    expect(screen.queryByText('Ship consistent investigation accordions.')).toBeNull();
    expect(screen.queryByTestId('open-questions-list')).toBeNull();
    expect(screen.queryByTestId('investigation-trail')).toBeNull();
    expect(screen.queryByText('Check the auth redirect.')).toBeNull();
    expect(screen.queryByTestId('playwright-capture-section')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /acceptance contract/i }));
    fireEvent.click(screen.getByRole('button', { name: /engineering spec/i }));
    fireEvent.click(screen.getByRole('button', { name: /open questions/i }));
    fireEvent.click(screen.getByRole('button', { name: /investigation trail/i }));
    fireEvent.click(screen.getByRole('button', { name: /human review notes/i }));
    fireEvent.click(screen.getByRole('button', { name: /playwright capture/i }));

    expect(screen.getByText('Acceptance criteria start collapsed.')).toBeTruthy();
    expect(screen.getByText('Ship consistent investigation accordions.')).toBeTruthy();
    expect(screen.getByTestId('open-questions-list')).toBeTruthy();
    expect(screen.getByTestId('investigation-trail')).toBeTruthy();
    expect(screen.getByText('Check the auth redirect.')).toBeTruthy();
    expect(screen.getByTestId('playwright-capture-section')).toBeTruthy();
  });

  it('does not render accordion shells for empty optional sections', () => {
    const minimalEvent = investigationEvent({
      payload: {
        investigate: {
          ...(INVESTIGATION_EVENT.payload as { investigate: Record<string, unknown> }).investigate,
          keyFiles: [],
          openQuestions: [],
          decisionSummaries: [],
        },
      },
    });

    renderSection({
      events: [minimalEvent],
      itemState: 'factory:investigation-complete',
      acceptanceContract: { source: 'engineering-spec', criteria: [] },
    });

    expect(screen.queryByRole('button', { name: /acceptance contract/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /open questions/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /investigation trail/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /human review notes/i })).toBeNull();
  });
});
