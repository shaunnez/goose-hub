/** @vitest-environment jsdom */
import * as api from '@/lib/api';
import type { ProjectSettingsDto } from '@/lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectBudgetPanel } from './ProjectBudgetPanel';

vi.mock('@/lib/api', () => ({
  fetchProjectSettings: vi.fn(),
  patchGlobalBudgetSettings: vi.fn(),
  patchSkillBudgetSetting: vi.fn(),
  deleteSkillBudgetSetting: vi.fn(),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

function mockSettings(overrides: Partial<ProjectSettingsDto> = {}): ProjectSettingsDto {
  return {
    projectId: 'proj-1',
    configBudgets: {},
    dbGlobalOverrides: null,
    dbSkillOverrides: {},
    registeredSkills: [],
    skillDefaults: {},
    ...overrides,
  };
}

function renderPanel(slug = 'test-project') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProjectBudgetPanel slug={slug} />
    </QueryClientProvider>,
  );
}

describe('ProjectBudgetPanel', () => {
  it('displays default values for global budget fields in labels', async () => {
    vi.mocked(api.fetchProjectSettings).mockResolvedValueOnce(
      mockSettings({
        configBudgets: {
          perWorkflowMaxUsd: 5.0,
          perAgentMaxUsd: 2.5,
          perAdvisorMaxUsd: 1.0,
          dailyTokens: 1000000,
          maxParallelAgents: 5,
          maxRetries: 3,
          perBashCommandMaxSeconds: 300,
        },
      }),
    );

    renderPanel();
    await waitFor(() => {
      // Check that labels show the default values
      expect(screen.getByText('Per-workflow max USD (default: $5.00)')).toBeTruthy();
      expect(screen.getByText('Per-agent max USD (default: $2.50)')).toBeTruthy();
      expect(screen.getByText('Per-advisor max USD (default: $1.00)')).toBeTruthy();
      expect(screen.getByText('Daily tokens (default: 1,000,000)')).toBeTruthy();
      expect(screen.getByText('Max parallel agents (default: 5)')).toBeTruthy();
      expect(screen.getByText('Max retries (default: 3)')).toBeTruthy();
      expect(screen.getByText('Per-bash-command max seconds (default: 300)')).toBeTruthy();
    });
  });

  it('displays skill budget defaults in placeholders', async () => {
    vi.mocked(api.fetchProjectSettings).mockResolvedValueOnce(
      mockSettings({
        registeredSkills: ['implement', 'qa'],
        skillDefaults: {
          implement: { maxTurns: 150, maxBudgetUsd: 6.0, timeoutMs: 900000 },
          qa: { maxTurns: 100, maxBudgetUsd: 3.0, timeoutMs: 600000 },
        },
      }),
    );

    renderPanel();
    await waitFor(() => {
      // Check that skill table rows show defaults in placeholders
      expect(screen.getByText('implement')).toBeTruthy();
      expect(screen.getByText('qa')).toBeTruthy();

      // Find inputs for skill budget defaults
      const inputs = screen.getAllByRole('spinbutton');
      const implementMaxTurnsInput = inputs.find((inp) =>
        inp.getAttribute('placeholder')?.includes('150'),
      );
      const qaMaxBudgetInput = inputs.find((inp) => inp.getAttribute('placeholder')?.includes('3'));

      expect(implementMaxTurnsInput).toBeTruthy();
      expect(qaMaxBudgetInput).toBeTruthy();
    });
  });

  it('shows "—" when global config values are not set', async () => {
    vi.mocked(api.fetchProjectSettings).mockResolvedValueOnce(mockSettings());

    renderPanel();
    await waitFor(() => {
      // When no config budgets are set, inputs should show "—"
      const inputs = screen.getAllByRole('spinbutton');
      const emptyInput = inputs.find((inp) => inp.getAttribute('placeholder') === '—');
      expect(emptyInput).toBeTruthy();
    });
  });

  it('formats currency values with $ and decimal places', async () => {
    vi.mocked(api.fetchProjectSettings).mockResolvedValueOnce(
      mockSettings({
        configBudgets: {
          perWorkflowMaxUsd: 123.456,
          perAgentMaxUsd: 0.05,
          perAdvisorMaxUsd: 1.5,
          dailyTokens: 1000000,
          maxParallelAgents: 5,
          maxRetries: 3,
          perBashCommandMaxSeconds: 300,
        },
      }),
    );

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Per-workflow max USD (default: $123.46)')).toBeTruthy();
      expect(screen.getByText('Per-agent max USD (default: $0.05)')).toBeTruthy();
      expect(screen.getByText('Per-advisor max USD (default: $1.50)')).toBeTruthy();
    });
  });

  it('formats integer values with thousand separators', async () => {
    vi.mocked(api.fetchProjectSettings).mockResolvedValueOnce(
      mockSettings({
        configBudgets: {
          perWorkflowMaxUsd: 1.0,
          perAgentMaxUsd: 1.0,
          perAdvisorMaxUsd: 1.0,
          dailyTokens: 1500000,
          maxParallelAgents: 50,
          maxRetries: 20,
          perBashCommandMaxSeconds: 3600,
        },
      }),
    );

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Daily tokens (default: 1,500,000)')).toBeTruthy();
      expect(screen.getByText('Max parallel agents (default: 50)')).toBeTruthy();
      expect(screen.getByText('Max retries (default: 20)')).toBeTruthy();
      expect(screen.getByText('Per-bash-command max seconds (default: 3,600)')).toBeTruthy();
    });
  });

  it('shows skill timeout in milliseconds with formatting', async () => {
    vi.mocked(api.fetchProjectSettings).mockResolvedValueOnce(
      mockSettings({
        registeredSkills: ['implement'],
        skillDefaults: {
          implement: { maxTurns: 150, maxBudgetUsd: 6.0, timeoutMs: 900000 },
        },
      }),
    );

    renderPanel();
    await waitFor(() => {
      // Should display timeout default (900000 ms)
      const inputs = screen.getAllByRole('spinbutton');
      const timeoutInput = inputs.find((inp) =>
        inp.getAttribute('placeholder')?.includes('900000'),
      );
      expect(timeoutInput).toBeTruthy();
    });
  });
});
