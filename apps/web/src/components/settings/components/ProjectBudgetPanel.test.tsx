/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectBudgetPanel } from './ProjectBudgetPanel';

vi.mock('@/lib/api', () => ({
  deleteSkillBudgetSetting: vi.fn(),
  fetchCodexAuthStatus: vi.fn().mockResolvedValue({
    status: 'connected',
    authPath: '/Users/test/.codex/auth.json',
    loginCommand: 'codex login',
  }),
  fetchProjectSettings: vi.fn().mockResolvedValue({
    projectId: 'goose-hub-self',
    configBudgets: {},
    dbGlobalOverrides: null,
    dbPipelineFlags: null,
    dbSkillOverrides: {
      qa: {
        maxTurns: null,
        maxBudgetUsd: null,
        timeoutMs: null,
        modelTier: null,
        provider: null,
        effort: 'high',
        updatedAt: '2026-05-20T00:00:00Z',
      },
    },
    registeredSkills: ['qa'],
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
  patchGlobalBudgetSettings: vi.fn(),
  patchSkillBudgetSetting: vi.fn(),
  resetAllProjectBudgets: vi.fn(),
}));

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
    expect(screen.getByDisplayValue('high')).toBeTruthy();
    expect(screen.getByText(/from skill-default: holdout skill ignores/)).toBeTruthy();
    expect(screen.getByText(/from fallback: holdout skill ignores/)).toBeTruthy();
    expect(screen.getByText(/from db: project_skill_settings\.effort override/)).toBeTruthy();
    expect(await screen.findByText('p95 reads 12')).toBeTruthy();
    expect(await screen.findByText('p95 bytes 8.0 KB')).toBeTruthy();
    expect(await screen.findByText('This skill looks stable and inexpensive.')).toBeTruthy();
  });
});
