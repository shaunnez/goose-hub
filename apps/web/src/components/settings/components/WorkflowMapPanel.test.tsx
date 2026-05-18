/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkflowMapPanel } from './WorkflowMapPanel';

vi.mock('@/lib/api', () => ({
  fetchProjectSettings: vi.fn().mockResolvedValue({
    projectId: 'goose-hub-self',
    configBudgets: {},
    dbGlobalOverrides: null,
    dbPipelineFlags: null,
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
      },
      qa: {
        maxTurns: 100,
        maxBudgetUsd: 3,
        timeoutMs: 600000,
        modelTier: 'sonnet',
        modelProvider: 'claude',
      },
      'dev-review': {
        maxTurns: 20,
        maxBudgetUsd: 2,
        timeoutMs: 180000,
        modelTier: 'sonnet',
        modelProvider: 'codex',
      },
    },
    resolvedSkillRuntimes: {
      triage: {
        source: 'default',
        effectiveTier: 'haiku',
        effectiveProvider: 'claude',
        resolvedPrimary: { tier: 'haiku', provider: 'claude', modelId: 'claude-haiku' },
        resolvedFallback: null,
        resolvedAdvisor: null,
      },
      qa: {
        source: 'default',
        effectiveTier: 'sonnet',
        effectiveProvider: 'claude',
        resolvedPrimary: { tier: 'sonnet', provider: 'claude', modelId: 'claude-sonnet' },
        resolvedFallback: null,
        resolvedAdvisor: null,
      },
      'dev-review': {
        source: 'default',
        effectiveTier: 'sonnet',
        effectiveProvider: 'codex',
        resolvedPrimary: { tier: 'sonnet', provider: 'codex', modelId: 'gpt-5.4' },
        resolvedFallback: null,
        resolvedAdvisor: null,
      },
    },
  }),
  fetchWorkflowCatalog: vi.fn().mockResolvedValue({
    catalog: [
      {
        kind: 'bug',
        title: 'Bug workflow',
        description: 'Bug path.',
        normalPath: ['triaging', 'accepted', 'needs-qa'],
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
        nodes: [{ id: 'triaging', label: 'Triage', state: 'factory:triaging' }],
        edges: [],
      },
      {
        kind: 'chore',
        title: 'Chore workflow',
        description: 'Chore path.',
        normalPath: ['triaging'],
        nodes: [{ id: 'triaging', label: 'Triage', state: 'factory:triaging' }],
        edges: [],
      },
      {
        kind: 'research',
        title: 'Research workflow',
        description: 'Research path.',
        normalPath: ['triaging'],
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
  it('renders catalog-backed states, skill chips, and branch rows', async () => {
    renderPanel();

    expect(await screen.findByText('Bug workflow')).toBeTruthy();
    expect(screen.getByText('triage')).toBeTruthy();
    expect(screen.getByText('qa')).toBeTruthy();
    expect(screen.getByText('Repair')).toBeTruthy();
    expect(screen.getAllByTestId('workflow-state-node')).toHaveLength(3);
  });

  it('switches workflow kinds and shows skill details from settings metadata', async () => {
    renderPanel();

    fireEvent.click(await screen.findByText('triage'));
    expect(screen.getByTestId('skill-detail').textContent).toContain('Classifies incoming work.');

    fireEvent.click(screen.getByRole('button', { name: 'Feature' }));
    expect(await screen.findByText('Feature workflow')).toBeTruthy();
  });
});
