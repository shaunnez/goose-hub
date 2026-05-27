/** @vitest-environment jsdom */
import type { AgentEventDto, EngineeringSpecDto } from '@/lib/types';
import { ActiveProjectProvider } from '@/state/active-project';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InvestigationSection } from './InvestigationSection';

afterEach(cleanup);

vi.mock('@/lib/api', () => ({
  fetchEvents: vi.fn().mockResolvedValue([]),
  fetchComments: vi.fn().mockResolvedValue([]),
  fetchEngineeringSpec: vi.fn().mockResolvedValue(null),
  fetchAcceptanceContract: vi.fn().mockResolvedValue(null),
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
}));

vi.mock('@/lib/markdown', () => ({
  renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

vi.mock('./PlaywrightCaptureSection', () => ({
  PlaywrightCaptureSection: () => (
    <div data-testid="playwright-capture-content">Bug repro capture</div>
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

const ENGINEERING_SPEC: EngineeringSpecDto = {
  pipelineRunId: 'pipe-test-123',
  updatedAt: '2026-05-22T10:00:00Z',
  objective: 'Build the authentication flow with token refresh.',
  workPackages: [
    {
      id: 'WP1',
      filesOwned: ['src/auth/login.ts'],
      changes: 'Update login refresh flow.',
      dependsOn: [],
      builderTier: 'sonnet',
    },
  ],
  executionOrder: [{ batch: 0, wpIds: ['WP1'] }],
  verificationTooling: [],
  acceptanceCriteria: [{ id: 'AC-1', statement: 'Users can log in.' }],
  acceptanceCriteriaCount: 1,
  interfaceContracts: [],
  constraints: [],
  riskRegister: [],
};

const ACCEPTANCE_CONTRACT = {
  source: 'engineering-spec' as const,
  criteria: [{ id: 'AC-1', statement: 'Users can log in.' }],
};

const HUMAN_NOTES = [
  {
    id: 'note-1',
    body: 'Human review notes:\n\nNeeds follow-up.',
    createdAt: '2026-05-22T10:00:00Z',
  },
];

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
  spec,
  acceptanceContract,
  comments,
  itemType,
  itemState,
}: {
  events?: AgentEventDto[];
  spec?: EngineeringSpecDto | null;
  acceptanceContract?: typeof ACCEPTANCE_CONTRACT | null;
  comments?: typeof HUMAN_NOTES;
  itemType?: string;
  itemState?: string;
} = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['events', 'test-proj', '42'], events);
  if (spec !== undefined) qc.setQueryData(['spec', 'test-proj', '42'], spec);
  if (acceptanceContract !== undefined) {
    qc.setQueryData(['acceptance-contract', 'test-proj', '42'], acceptanceContract);
  }
  if (comments !== undefined) qc.setQueryData(['comments', 'test-proj', '42'], comments);
  render(
    <QueryClientProvider client={qc}>
      <ActiveProjectProvider initialSlug="test-proj">
        <InvestigationSection
          projectSlug="test-proj"
          id="42"
          itemType={itemType}
          itemState={itemState}
        />
      </ActiveProjectProvider>
    </QueryClientProvider>,
  );
}

function getAccordionButton(title: string) {
  const match = screen
    .getAllByRole('button')
    .find((button) => within(button).queryByText(new RegExp(`^${title}$`, 'i')) != null);

  if (match == null) {
    throw new Error(`Accordion button not found for title: ${title}`);
  }

  return match;
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

  it('renders the Engineering Spec panel when a spec exists', () => {
    renderSection({ events: [INVESTIGATION_EVENT], spec: ENGINEERING_SPEC });
    expect(screen.getByText('Engineering Spec')).toBeTruthy();
    expect(screen.getByText('1 work package · 1 AC')).toBeTruthy();
  });

  it('displays the correct confidence badge for high confidence', () => {
    renderSection({ events: [INVESTIGATION_EVENT] });
    const badge = screen.getByTestId('confidence-badge');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('high');
  });

  it('renders key files list after expanding the accordion', () => {
    renderSection({ events: [INVESTIGATION_EVENT] });
    fireEvent.click(getAccordionButton('Key Files'));
    const filesList = screen.getByTestId('key-files-list');
    expect(filesList).toBeTruthy();
    expect(screen.getByText('src/auth/login.ts')).toBeTruthy();
    expect(screen.getByText('src/auth/session.ts')).toBeTruthy();
  });

  it('renders open questions list after expanding the accordion', () => {
    renderSection({ events: [INVESTIGATION_EVENT] });
    fireEvent.click(getAccordionButton('Open Questions'));
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
    expect(screen.queryByRole('button', { name: /key files/i })).toBeNull();
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
    expect(screen.queryByRole('button', { name: /open questions/i })).toBeNull();
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

  it('shows findings expanded by default and keeps other sections collapsed initially', () => {
    renderSection({
      events: [INVESTIGATION_EVENT],
      spec: ENGINEERING_SPEC,
      acceptanceContract: ACCEPTANCE_CONTRACT,
      comments: HUMAN_NOTES,
      itemType: 'bug',
    });

    expect(getAccordionButton('Findings').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('findings-content')).toBeTruthy();

    expect(getAccordionButton('Acceptance Criteria').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('acceptance-contract-content')).toBeNull();

    expect(getAccordionButton('Engineering Spec').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Build the authentication flow with token refresh.')).toBeNull();

    expect(getAccordionButton('Key Files').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('key-files-list')).toBeNull();

    expect(getAccordionButton('Open Questions').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('open-questions-list')).toBeNull();

    expect(getAccordionButton('Investigation Trail').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('investigation-trail')).toBeNull();

    expect(getAccordionButton('Human Review Notes').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('investigation-human-notes')).toBeNull();

    expect(getAccordionButton('Bug Repro Capture').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('playwright-capture-content')).toBeNull();
  });

  it('reveals collapsed investigation accordions when their headers are clicked', () => {
    renderSection({
      events: [INVESTIGATION_EVENT],
      spec: ENGINEERING_SPEC,
      acceptanceContract: ACCEPTANCE_CONTRACT,
      comments: HUMAN_NOTES,
      itemType: 'bug',
    });

    fireEvent.click(getAccordionButton('Acceptance Criteria'));
    expect(screen.getByTestId('acceptance-contract-content')).toBeTruthy();
    expect(screen.getByText('Users can log in.')).toBeTruthy();

    fireEvent.click(getAccordionButton('Engineering Spec'));
    expect(screen.getByText('Build the authentication flow with token refresh.')).toBeTruthy();

    fireEvent.click(getAccordionButton('Open Questions'));
    expect(screen.getByTestId('open-questions-list')).toBeTruthy();

    fireEvent.click(getAccordionButton('Investigation Trail'));
    expect(screen.getByTestId('investigation-trail')).toBeTruthy();

    fireEvent.click(getAccordionButton('Human Review Notes'));
    expect(screen.getByTestId('investigation-human-notes')).toBeTruthy();

    fireEvent.click(getAccordionButton('Bug Repro Capture'));
    expect(screen.getByTestId('playwright-capture-content')).toBeTruthy();
  });
});
