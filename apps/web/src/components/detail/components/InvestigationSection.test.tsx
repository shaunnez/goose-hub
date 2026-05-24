/** @vitest-environment jsdom */
import type { AgentEventDto, EngineeringSpecDto } from '@/lib/types';
import { ActiveProjectProvider } from '@/state/active-project';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  PlaywrightCaptureSection: () => <div data-testid="playwright-capture-content">capture</div>,
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

const HUMAN_NOTE = {
  id: 7,
  body: 'Human review notes:\n\nPlease verify the mobile session flow.',
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
  spec,
  contract,
  comments = [],
  itemType,
  itemState,
}: {
  events?: AgentEventDto[];
  spec?: EngineeringSpecDto | null;
  contract?: typeof ACCEPTANCE_CONTRACT | null;
  comments?: Array<{ id: number; body: string; createdAt: string }>;
  itemType?: string;
  itemState?: string;
} = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['events', 'test-proj', '42'], events);
  if (spec !== undefined) qc.setQueryData(['spec', 'test-proj', '42'], spec);
  if (contract !== undefined) qc.setQueryData(['acceptance-contract', 'test-proj', '42'], contract);
  qc.setQueryData(['comments', 'test-proj', '42'], comments);
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

describe('InvestigationSection', () => {
  it('shows empty state when no investigation events exist', () => {
    renderSection();
    expect(screen.getByTestId('investigation-empty-state')).toBeTruthy();
    expect(screen.getByText('Investigation has not run yet.')).toBeTruthy();
  });

  it('renders findings expanded by default and keeps acceptance/spec collapsed', () => {
    renderSection({
      events: [INVESTIGATION_EVENT],
      spec: ENGINEERING_SPEC,
      contract: ACCEPTANCE_CONTRACT,
    });
    expect(screen.getByTestId('investigation-section')).toBeTruthy();
    expect(screen.getByRole('button', { name: /findings/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByTestId('findings-content')).toBeTruthy();
    expect(screen.getByTestId('key-files-list')).toBeTruthy();
    expect(screen.getByRole('button', { name: /acceptance contract/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', { name: /engineering spec/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText('Users can log in.')).toBeNull();
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

  it('toggles investigation accordions independently while preserving content and controls', async () => {
    const user = userEvent.setup();
    renderSection({
      events: [INVESTIGATION_EVENT],
      spec: ENGINEERING_SPEC,
      contract: ACCEPTANCE_CONTRACT,
      comments: [HUMAN_NOTE],
      itemType: 'bug',
      itemState: 'factory:gate-pending',
    });

    const findingsToggle = screen.getByRole('button', { name: /findings/i });
    const questionsToggle = screen.getByRole('button', { name: /open questions/i });
    const trailToggle = screen.getByRole('button', { name: /investigation trail/i });
    const notesToggle = screen.getByRole('button', { name: /human review notes/i });
    const captureToggle = screen.getByRole('button', { name: /playwright capture/i });
    const gateToggle = screen.getByRole('button', { name: /human review required/i });

    expect(screen.getByText('Does this affect the mobile app?')).toBeTruthy();
    expect(screen.getByTestId('investigation-trail')).toBeTruthy();
    expect(screen.getByTestId('playwright-capture-content')).toBeTruthy();
    expect(screen.getByTestId('investigation-proceed-button')).toBeTruthy();

    await user.click(findingsToggle);
    expect(findingsToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('findings-content')).toBeNull();
    expect(screen.queryByTestId('key-files-list')).toBeNull();
    expect(screen.getByText('Does this affect the mobile app?')).toBeTruthy();

    await user.click(questionsToggle);
    expect(questionsToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Does this affect the mobile app?')).toBeNull();
    expect(screen.getByTestId('investigation-trail')).toBeTruthy();

    await user.click(trailToggle);
    expect(trailToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('investigation-trail')).toBeNull();
    expect(screen.getByText('Please verify the mobile session flow.')).toBeTruthy();

    await user.click(notesToggle);
    expect(notesToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Please verify the mobile session flow.')).toBeNull();
    expect(screen.getByTestId('playwright-capture-content')).toBeTruthy();

    await user.click(captureToggle);
    expect(captureToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('playwright-capture-content')).toBeNull();
    expect(screen.getByTestId('investigation-proceed-button')).toBeTruthy();

    await user.click(gateToggle);
    expect(gateToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('investigation-proceed-button')).toBeNull();
  });
});
