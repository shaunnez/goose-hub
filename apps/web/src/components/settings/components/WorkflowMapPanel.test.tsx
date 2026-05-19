/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkflowMapPanel } from './WorkflowMapPanel';

vi.mock('@/lib/api', () => ({
  fetchDevReviewSettings: vi.fn().mockResolvedValue({
    projectId: 'goose-hub-self',
    config: {
      enabled: true,
      triggerOn: 'priority:high+',
      maxRevisionTurns: 1,
      perCycleMaxUsd: 2,
      timeoutMs: 180000,
    },
    dbOverride: null,
  }),
  fetchPipelineSettings: vi.fn().mockResolvedValue({
    projectId: 'goose-hub-self',
    useMultiAgentPipeline: true,
    useInvestigationSwarm: true,
    configDefaults: { useInvestigationSwarm: true },
  }),
  fetchProjectSettings: vi.fn().mockResolvedValue({
    projectId: 'goose-hub-self',
    configBudgets: { maxParallelAgents: 3, maxScoutAgents: 4 },
    dbGlobalOverrides: null,
    dbPipelineFlags: {
      qaE2eMode: null,
      playwrightReproEnabled: 1,
      evidencePostEnabled: 1,
    },
    dbSkillOverrides: {},
    registeredSkills: ['triage', 'qa', 'dev-review'],
    skillMetadata: {
      triage: {
        description: 'Classifies incoming work.',
        dependencies: ['workItem'],
        callers: ['triage-batch workflow'],
      },
      qa: {
        description: 'Holdout QA check.',
        dependencies: ['prDiff'],
        callers: ['post-implementation QA gate'],
      },
      'dev-review': {
        description: 'Codex pre-QA diff review.',
        dependencies: ['prDiff'],
        callers: ['developer pre-QA advisor'],
      },
    },
    skillDefaults: {
      triage: {
        maxTurns: 25,
        maxBudgetUsd: 1,
        timeoutMs: 120000,
        modelTier: 'haiku',
        modelProvider: 'claude',
        effort: null,
      },
      qa: {
        maxTurns: 100,
        maxBudgetUsd: 3,
        timeoutMs: 600000,
        modelTier: 'sonnet',
        modelProvider: 'claude',
        effort: null,
      },
      'dev-review': {
        maxTurns: 20,
        maxBudgetUsd: 2,
        timeoutMs: 180000,
        modelTier: 'sonnet',
        modelProvider: 'codex',
        effort: null,
      },
    },
    resolvedSkillRuntimes: {
      triage: {
        source: 'skill-default',
        effectiveTier: 'haiku',
        effectiveProvider: 'claude',
        effectiveEffort: null,
        resolvedPrimary: { tier: 'haiku', provider: 'claude', modelId: 'claude-haiku' },
        resolvedFallback: null,
        resolvedAdvisor: null,
        selectionReason: 'tier skill-default, provider fallback',
        resolutionTrace: {
          tier: { value: 'haiku', source: 'skill-default', reason: 'SKILL_BUDGETS default tier' },
          provider: { value: 'claude', source: 'fallback', reason: 'resolver fallback provider' },
        },
      },
      qa: {
        source: 'skill-default',
        effectiveTier: 'sonnet',
        effectiveProvider: 'claude',
        effectiveEffort: null,
        resolvedPrimary: { tier: 'sonnet', provider: 'claude', modelId: 'claude-sonnet' },
        resolvedFallback: null,
        resolvedAdvisor: null,
        selectionReason: 'tier skill-default, provider fallback',
        resolutionTrace: {
          tier: { value: 'sonnet', source: 'skill-default', reason: 'SKILL_BUDGETS default tier' },
          provider: { value: 'claude', source: 'fallback', reason: 'resolver fallback provider' },
        },
      },
      'dev-review': {
        source: 'skill-default',
        effectiveTier: 'sonnet',
        effectiveProvider: 'codex',
        effectiveEffort: null,
        resolvedPrimary: { tier: 'sonnet', provider: 'codex', modelId: 'gpt-5.4' },
        resolvedFallback: null,
        resolvedAdvisor: null,
        selectionReason: 'tier skill-default, provider skill-default',
        resolutionTrace: {
          tier: { value: 'sonnet', source: 'skill-default', reason: 'SKILL_BUDGETS default tier' },
          provider: {
            value: 'codex',
            source: 'skill-default',
            reason: 'skill runtime provider hint',
          },
        },
      },
    },
  }),
  fetchReviewSettings: vi.fn().mockResolvedValue({
    projectId: 'goose-hub-self',
    reviewerSlots: [
      { model: 'claude', prompt: 'default' },
      { model: 'codex', prompt: 'unconstrained' },
    ],
    updatedAt: null,
    updatedBy: null,
  }),
  fetchWorkflowCatalog: vi.fn().mockResolvedValue({
    catalog: [
      {
        kind: 'bug',
        title: 'Bug workflow',
        description: 'Bug path.',
        normalPath: ['triaging', 'accepted', 'needs-qa'],
        stages: [
          {
            id: 'triage',
            title: 'Triage',
            group: 'triage',
            nodes: ['triaging', 'triage-skill', 'accepted'],
          },
          {
            id: 'delivery',
            title: 'Delivery router',
            group: 'delivery',
            nodes: ['accepted'],
            variants: [
              {
                id: 'legacy-delivery',
                title: 'Legacy implement',
                mode: 'legacy',
                activation: {
                  setting: 'useMultiAgentPipeline',
                  value: false,
                  label: 'multi-agent pipeline off',
                },
                nodes: ['accepted'],
              },
              {
                id: 'multi-agent-delivery',
                title: 'Multi-agent pipeline',
                mode: 'multi-agent',
                activation: {
                  setting: 'useMultiAgentPipeline',
                  value: true,
                  label: 'multi-agent pipeline on',
                },
                nodes: ['dev-review-skill'],
              },
            ],
            branches: [
              {
                id: 'repair',
                title: 'Repair',
                kind: 'retry',
                nodes: ['needs-qa'],
              },
            ],
          },
          {
            id: 'qa',
            title: 'QA holdout',
            group: 'qa',
            nodes: ['needs-qa', 'qa-skill'],
          },
        ],
        nodes: [
          { id: 'triaging', label: 'Triage', state: 'factory:triaging' },
          { id: 'accepted', label: 'Accepted', state: 'factory:accepted' },
          { id: 'needs-qa', label: 'QA', state: 'factory:needs-qa' },
          {
            id: 'triage-skill',
            label: 'triage',
            skill: 'triage',
            role: 'triager',
            state: 'factory:triaging',
          },
          {
            id: 'qa-skill',
            label: 'qa',
            skill: 'qa',
            role: 'qa',
            state: 'factory:needs-qa',
          },
          {
            id: 'dev-review-skill',
            label: 'dev-review',
            skill: 'dev-review',
            role: 'dev-reviewer',
            state: 'factory:accepted',
          },
        ],
        edges: [
          { from: 'triaging', to: 'accepted', kind: 'primary' },
          { from: 'accepted', to: 'needs-qa', kind: 'primary' },
          { from: 'needs-qa', to: 'accepted', label: 'Repair', kind: 'retry' },
        ],
      },
      {
        kind: 'feature',
        title: 'Feature workflow',
        description: 'Feature path.',
        normalPath: ['triaging'],
        stages: [{ id: 'triage', title: 'Triage', group: 'triage', nodes: ['triaging'] }],
        nodes: [{ id: 'triaging', label: 'Triage', state: 'factory:triaging' }],
        edges: [],
      },
      {
        kind: 'chore',
        title: 'Chore workflow',
        description: 'Chore path.',
        normalPath: ['triaging'],
        stages: [{ id: 'triage', title: 'Triage', group: 'triage', nodes: ['triaging'] }],
        nodes: [{ id: 'triaging', label: 'Triage', state: 'factory:triaging' }],
        edges: [],
      },
      {
        kind: 'research',
        title: 'Research workflow',
        description: 'Research path.',
        normalPath: ['triaging'],
        stages: [{ id: 'triage', title: 'Triage', group: 'triage', nodes: ['triaging'] }],
        nodes: [{ id: 'triaging', label: 'Triage', state: 'factory:triaging' }],
        edges: [],
      },
    ],
  }),
}));

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorkflowMapPanel slug="goose-hub-self" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WorkflowMapPanel', () => {
  it('renders a vertical effective flow with states, skill nodes, and branch rows', async () => {
    renderPanel();

    expect(await screen.findByText('Bug workflow')).toBeTruthy();
    const pipelineHeading = screen.getByRole('heading', { name: 'Pipeline/Review settings' });
    const workflowHeading = screen.getByRole('heading', { name: 'Workflow map' });
    expect(
      Boolean(
        pipelineHeading.compareDocumentPosition(workflowHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(screen.getByText('Investigation swarm')).toBeTruthy();
    expect(screen.getAllByText('Multi-agent pipeline').length).toBeGreaterThan(0);
    expect(screen.getByTestId('workflow-expand-all')).toBeTruthy();
    expect(screen.getByTestId('workflow-collapse-all')).toBeTruthy();
    expect(screen.queryByTestId('workflow-variant-multi-agent-delivery')).toBeNull();

    fireEvent.click(screen.getByTestId('workflow-expand-all'));

    expect(screen.getAllByText('triage').length).toBeGreaterThan(0);
    expect(screen.getAllByText('qa').length).toBeGreaterThan(0);
    expect(screen.getByText('Repair')).toBeTruthy();
    expect(screen.getByTestId('workflow-vertical-flow')).toBeTruthy();
    expect(screen.getAllByTestId('workflow-stage')).toHaveLength(3);
    expect(screen.getByTestId('workflow-variant-multi-agent-delivery').textContent).toContain(
      'active',
    );
    expect(screen.getByTestId('workflow-variant-legacy-delivery').textContent).toContain(
      'inactive',
    );
  });

  it('collapses and expands workflow categories', async () => {
    renderPanel();

    await screen.findByText('Bug workflow');
    expect(screen.queryByTestId('workflow-variant-multi-agent-delivery')).toBeNull();

    const deliveryToggle = screen.getByRole('button', { name: 'Delivery router' });
    fireEvent.click(deliveryToggle);

    expect(deliveryToggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('workflow-stage-body-delivery')).toBeTruthy();
    expect(screen.getByTestId('workflow-variant-multi-agent-delivery')).toBeTruthy();

    fireEvent.click(deliveryToggle);

    expect(deliveryToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('workflow-stage-body-delivery')).toBeNull();
    expect(screen.queryByTestId('workflow-variant-multi-agent-delivery')).toBeNull();
  });

  it('expands and collapses all workflow categories for the selected kind', async () => {
    renderPanel();

    await screen.findByText('Bug workflow');
    expect(screen.queryByTestId('workflow-stage-body-triage')).toBeNull();
    expect(screen.queryByTestId('workflow-stage-body-delivery')).toBeNull();
    expect(screen.queryByTestId('workflow-stage-body-qa')).toBeNull();

    fireEvent.click(screen.getByTestId('workflow-expand-all'));

    expect(screen.getByTestId('workflow-stage-body-triage')).toBeTruthy();
    expect(screen.getByTestId('workflow-stage-body-delivery')).toBeTruthy();
    expect(screen.getByTestId('workflow-stage-body-qa')).toBeTruthy();

    fireEvent.click(screen.getByTestId('workflow-collapse-all'));

    expect(screen.queryByTestId('workflow-stage-body-triage')).toBeNull();
    expect(screen.queryByTestId('workflow-stage-body-delivery')).toBeNull();
    expect(screen.queryByTestId('workflow-stage-body-qa')).toBeNull();
  });

  it('switches workflow kinds and opens selected skill details in a modal', async () => {
    renderPanel();

    await screen.findByText('Bug workflow');
    fireEvent.click(screen.getByTestId('workflow-expand-all'));
    const triageNode = screen
      .getAllByTestId('workflow-skill-node')
      .find((node) => node.textContent?.includes('triage'));
    expect(triageNode).toBeTruthy();
    fireEvent.click(triageNode as HTMLElement);
    const modal = screen.getByTestId('skill-detail-modal');
    const detail = screen.getByTestId('skill-detail');
    expect(modal).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'triage details' })).toBeTruthy();
    expect(detail.textContent).toContain('Classifies incoming work.');
    expect(detail.textContent).toContain('Tier from skill-default');
    expect(detail.textContent).toContain('Provider from fallback');
    expect(screen.getAllByTestId('workflow-skill-node')[0]?.textContent).not.toContain('Tier from');

    fireEvent.click(screen.getByRole('button', { name: 'Close skill detail' }));
    expect(screen.queryByTestId('skill-detail-modal')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Feature' }));
    expect(await screen.findByText('Feature workflow')).toBeTruthy();
  });
});
