/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectBudgetPanel } from './ProjectBudgetPanel';

const mockPatchGlobalBudgetSettings = vi.hoisted(() => vi.fn());
const mockPatchSkillBudgetSetting = vi.hoisted(() => vi.fn());
const mockPatchDevReviewSettings = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  deleteSkillBudgetSetting: vi.fn(),
  fetchClaudeAuthStatus: vi.fn().mockResolvedValue({
    status: 'connected',
    authPath: '/Users/test/.claude.json',
    credentialSource: 'Claude Code oauth',
    loginCommand: 'claude auth login',
  }),
  fetchCodexAuthStatus: vi.fn().mockResolvedValue({
    status: 'connected',
    authPath: '/Users/test/.codex/auth.json',
    loginCommand: 'codex login',
  }),
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
  fetchProjectSettings: vi.fn().mockResolvedValue({
    projectId: 'goose-hub-self',
    configBudgets: {},
    dbGlobalOverrides: null,
    dbPipelineFlags: null,
    implementWpDefaults: {
      editTestLoopMaxCycles: 3,
      bugMaxTurns: 70,
      bugMaxBudgetUsd: 4,
      featureMaxTurns: 100,
      featureMaxBudgetUsd: 6,
      complexMaxTurns: 130,
      complexMaxBudgetUsd: 8,
      highPriorityUsd: 1,
      manyFilesThreshold: 3,
      manyFilesUsd: 1,
      contractKeywords: ['schema', 'migration', 'api'],
      contractUsd: 1,
    },
    resolvedImplementWp: {
      editTestLoopMaxCycles: 2,
      bugMaxTurns: 70,
      bugMaxBudgetUsd: 4,
      featureMaxTurns: 100,
      featureMaxBudgetUsd: 6,
      complexMaxTurns: 130,
      complexMaxBudgetUsd: 8,
      highPriorityUsd: 1,
      manyFilesThreshold: 3,
      manyFilesUsd: 1,
      contractKeywords: ['schema', 'migration', 'api'],
      contractUsd: 1,
    },
    dbImplementWpOverrides: {
      implementWpEditTestLoopMaxCycles: 2,
      implementWpBugMaxTurns: null,
      implementWpBugMaxBudgetUsd: null,
      implementWpFeatureMaxTurns: null,
      implementWpFeatureMaxBudgetUsd: null,
      implementWpComplexMaxTurns: null,
      implementWpComplexMaxBudgetUsd: null,
      implementWpHighPriorityUsd: null,
      implementWpManyFilesThreshold: null,
      implementWpManyFilesUsd: null,
      implementWpContractKeywords: null,
      implementWpContractUsd: null,
      updatedAt: '2026-05-20T00:00:00Z',
      updatedBy: 'ui',
    },
    dbSkillOverrides: {
      qa: {
        maxTurns: null,
        maxBudgetUsd: null,
        timeoutMs: null,
        modelTier: null,
        provider: null,
        effort: 'high',
        escalationModelTier: null,
        escalationMaxBudgetUsd: null,
        escalationMaxTurns: null,
        escalationTimeoutMs: null,
        devReviewMaxRevisionTurns: null,
        devReviewPerCycleMaxUsd: null,
        devReviewTimeoutMs: null,
        updatedAt: '2026-05-20T00:00:00Z',
      },
      implement: {
        maxTurns: null,
        maxBudgetUsd: null,
        timeoutMs: null,
        modelTier: null,
        provider: null,
        effort: null,
        escalationModelTier: 'opus',
        escalationMaxBudgetUsd: 18,
        escalationMaxTurns: null,
        escalationTimeoutMs: null,
        devReviewMaxRevisionTurns: null,
        devReviewPerCycleMaxUsd: null,
        devReviewTimeoutMs: null,
        updatedAt: '2026-05-20T00:00:00Z',
      },
    },
    registeredSkills: ['qa', 'implement', 'dev-review'],
    skillMetadata: {
      qa: { description: 'Holdout QA check.', dependencies: ['prDiff'], callers: ['QA gate'] },
    },
    skillDefaults: {
      qa: {
        maxTurns: 100,
        maxBudgetUsd: 3,
        timeoutMs: 600000,
        modelTier: 'sonnet',
        modelProvider: 'claude',
        effort: null,
        escalation: null,
      },
      implement: {
        maxTurns: 150,
        maxBudgetUsd: 6,
        timeoutMs: 900000,
        modelTier: 'haiku',
        modelProvider: 'claude',
        effort: null,
        escalation: {
          modelTier: 'sonnet',
          maxBudgetUsd: 15,
          maxTurns: null,
          timeoutMs: null,
        },
      },
      'dev-review': {
        maxTurns: 20,
        maxBudgetUsd: 2,
        timeoutMs: 180000,
        modelTier: 'sonnet',
        modelProvider: 'codex',
        effort: null,
        escalation: null,
      },
    },
    resolvedSkillRuntimes: {
      qa: {
        source: 'db',
        effectiveTier: 'sonnet',
        effectiveProvider: 'claude',
        effectiveEffort: 'high',
        resolvedPrimary: { tier: 'sonnet', provider: 'claude', modelId: 'claude-sonnet' },
        resolvedFallback: null,
        resolvedAdvisor: null,
        selectionReason: 'tier skill-default, provider fallback, effort db',
        resolutionTrace: {
          tier: {
            value: 'sonnet',
            source: 'skill-default',
            reason: 'holdout skill ignores DB/config tier overrides; using SKILL_BUDGETS default',
          },
          provider: {
            value: 'claude',
            source: 'fallback',
            reason:
              'holdout skill ignores DB/config provider overrides; using resolver fallback provider',
          },
          effort: { value: 'high', source: 'db', reason: 'project_skill_settings.effort override' },
        },
      },
      implement: {
        source: 'db',
        effectiveTier: 'haiku',
        effectiveProvider: 'claude',
        effectiveEffort: null,
        resolvedPrimary: { tier: 'haiku', provider: 'claude', modelId: 'claude-haiku' },
        resolvedFallback: { tier: 'haiku', provider: 'claude', modelId: 'claude-haiku' },
        resolvedAdvisor: { tier: 'sonnet', provider: 'claude', modelId: 'claude-sonnet' },
        resolvedEscalation: {
          tier: 'opus',
          provider: 'claude',
          modelId: 'claude-opus',
          budgets: { maxTurns: 150, maxBudgetUsd: 18, timeoutMs: 900000 },
        },
        selectionReason: 'tier skill-default, provider fallback',
        resolutionTrace: {
          tier: { value: 'haiku', source: 'skill-default', reason: 'SKILL_BUDGETS default tier' },
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
        resolvedEscalation: null,
        selectionReason: 'tier skill-default, provider skill-default',
        resolutionTrace: {
          tier: { value: 'sonnet', source: 'skill-default', reason: 'SKILL_BUDGETS default tier' },
          provider: { value: 'codex', source: 'skill-default', reason: 'SKILL_BUDGETS provider' },
        },
      },
    },
  }),
  fetchRuntimeProfiler: vi.fn().mockResolvedValue({
    projectId: 'goose-hub-self',
    window: {
      days: 14,
      sinceIso: '2026-05-06T00:00:00.000Z',
      untilIso: '2026-05-20T00:00:00.000Z',
    },
    skills: [
      {
        skill: 'qa',
        metrics: {
          runCount: 6,
          medianInputTokens: 1000,
          p95InputTokens: 2000,
          medianOutputTokens: 500,
          p95OutputTokens: 700,
          medianCostUsd: 0.1,
          p95CostUsd: 0.3,
          p95ReadCount: 12,
          p95BytesRead: 8192,
          maxCostOutlier: { runId: 'r1', costUsd: 0.3 },
          timeoutRate: 0,
          budgetExceededRate: 0,
          schemaValidationRetryRate: 0,
          toolCallCount: 4,
          topToolNames: [{ name: 'Read', count: 4 }],
          repeatedBashCommands: [],
          commonCommandSequences: [],
        },
        recommendations: [
          {
            kind: 'lower-runtime',
            severity: 'info',
            summary: 'This skill looks stable and inexpensive.',
            evidence: 'p95 cost is $0.3000 across 6 runs.',
          },
        ],
      },
    ],
  }),
  patchGlobalBudgetSettings: mockPatchGlobalBudgetSettings,
  patchDevReviewSettings: mockPatchDevReviewSettings,
  patchSkillBudgetSetting: mockPatchSkillBudgetSetting,
  resetAllProjectBudgets: vi.fn(),
}));

beforeEach(() => {
  mockPatchGlobalBudgetSettings.mockClear();
  mockPatchSkillBudgetSetting.mockClear();
  mockPatchDevReviewSettings.mockClear();
});

afterEach(() => cleanup());

describe('ProjectBudgetPanel', () => {
  it('renders per-skill effort and observed runtime profile recommendations', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <ProjectBudgetPanel slug="goose-hub-self" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Observed runtime profile')).toBeTruthy());
    expect(screen.getByText('Claude CLI auth')).toBeTruthy();
    expect(screen.getByText('Codex CLI auth')).toBeTruthy();
    expect(screen.getByDisplayValue('high')).toBeTruthy();
    expect(screen.getByText(/from skill-default: holdout skill ignores/)).toBeTruthy();
    expect(screen.getByText(/from fallback: holdout skill ignores/)).toBeTruthy();
    expect(screen.getByText(/from db: project_skill_settings\.effort override/)).toBeTruthy();
    expect(await screen.findByText('p95 reads 12')).toBeTruthy();
    expect(await screen.findByText('p95 bytes 8.0 KB')).toBeTruthy();
    expect(await screen.findByText('This skill looks stable and inexpensive.')).toBeTruthy();
  });

  it('renders implement-WP controls and patches workflow-level keys', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <ProjectBudgetPanel slug="goose-hub-self" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Implement-WP controls')).toBeTruthy());
    expect(screen.getByText('Edit-test loop cycles')).toBeTruthy();
    const editTestLoopInput = screen
      .getAllByPlaceholderText('3')
      .find((input) => (input as HTMLInputElement).value === '2') as HTMLInputElement;
    expect(editTestLoopInput).toBeTruthy();

    const featureBudget = screen.getByPlaceholderText('6');
    fireEvent.change(featureBudget, { target: { value: '7.5' } });
    fireEvent.blur(featureBudget);

    await waitFor(() =>
      expect(mockPatchGlobalBudgetSettings).toHaveBeenCalledWith('goose-hub-self', {
        implementWpFeatureMaxBudgetUsd: 7.5,
      }),
    );
  });

  it('renders escalation and dev-review loop controls inside skill runtime settings', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <ProjectBudgetPanel slug="goose-hub-self" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Skill runtime settings')).toBeTruthy());
    expect(screen.getByText('Escalation tier')).toBeTruthy();
    expect(screen.getByDisplayValue('opus')).toBeTruthy();
    expect(screen.getByText('Dev-review loop controls')).toBeTruthy();

    const escalationBudget = screen.getByDisplayValue('18');
    fireEvent.change(escalationBudget, { target: { value: '19' } });
    fireEvent.blur(escalationBudget);

    await waitFor(() =>
      expect(mockPatchSkillBudgetSetting).toHaveBeenCalledWith('goose-hub-self', 'implement', {
        escalationMaxBudgetUsd: 19,
      }),
    );

    const devReviewBudget = screen
      .getAllByPlaceholderText('2.00')
      .find((input) => (input as HTMLInputElement).value === '2') as HTMLInputElement;
    expect(devReviewBudget).toBeTruthy();
    fireEvent.change(devReviewBudget, { target: { value: '3' } });
    fireEvent.blur(devReviewBudget);

    await waitFor(() =>
      expect(mockPatchDevReviewSettings).toHaveBeenCalledWith('goose-hub-self', {
        perCycleMaxUsd: 3,
      }),
    );
  });

  it('renders and patches implement-WP contract keywords', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <ProjectBudgetPanel slug="goose-hub-self" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Contract keywords')).toBeTruthy());

    const input = screen.getByDisplayValue('schema, migration, api');
    fireEvent.change(input, { target: { value: 'schema, auth' } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(mockPatchGlobalBudgetSettings).toHaveBeenCalledWith('goose-hub-self', {
        implementWpContractKeywords: ['schema', 'auth'],
      }),
    );

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(mockPatchGlobalBudgetSettings).toHaveBeenCalledWith('goose-hub-self', {
        implementWpContractKeywords: null,
      }),
    );
  });
});
