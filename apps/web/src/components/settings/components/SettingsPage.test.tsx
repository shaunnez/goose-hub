/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';

vi.mock('@/components/bootstrap/components/BootstrapWizard', () => ({
  BootstrapWizard: () => null,
}));

vi.mock('@/lib/api', () => ({
  fetchProjectConfigs: vi.fn().mockResolvedValue([
    {
      slug: 'my-proj',
      name: 'My Project',
      source: { kind: 'github', repo: 'owner/my-proj' },
      targetRepo: {
        cloneUrl: 'git@github.com:owner/my-proj.git',
        defaultBranch: 'main',
        localPath: '~/code/my-proj',
      },
      stack: {
        runtime: 'node',
        packageManager: 'pnpm',
        testCommand: 'pnpm test',
      },
      activeMilestone: 'M10: Orchestration',
      colorStripe: '#7c3aed',
      budgets: { perWorkflowMaxUsd: 2, dailyTokens: 500000, perAdvisorMaxUsd: 0.5 },
      mode: 'supervised',
      storage: { path: '~/.factory/data/my-proj' },
      isolation: { mode: 'native' },
    },
  ]),
}));

vi.mock('./DevReviewPanel', () => ({
  DevReviewPanel: () => <div data-testid="dev-review-panel" />,
}));
vi.mock('./MilestonesPanel', () => ({
  MilestonesPanel: ({ slug }: { slug: string }) => (
    <div data-testid="milestones-panel">Milestones for {slug}</div>
  ),
}));
vi.mock('./PipelinePanel', () => ({
  PipelinePanel: () => <div data-testid="pipeline-panel" />,
}));
vi.mock('./ProjectBudgetPanel', () => ({
  ProjectBudgetPanel: () => <div data-testid="project-budget-panel" />,
}));
vi.mock('./ReviewPanel', () => ({
  ReviewPanel: () => <div data-testid="review-panel" />,
}));
vi.mock('./WorkflowMapPanel', () => ({
  WorkflowMapPanel: () => <div data-testid="workflow-map-panel" />,
}));

afterEach(() => cleanup());

function renderSettingsPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

describe('SettingsPage', () => {
  it('uses Summary as the default tab and moves milestones into their own tab', async () => {
    renderSettingsPage();

    await waitFor(() => expect(screen.getByTestId('project-config-panel')).toBeTruthy());

    expect(screen.getByRole('button', { name: 'Summary' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Config' })).toBeNull();
    expect(screen.queryByTestId('milestones-panel')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Milestones' }));

    expect(screen.getByTestId('milestones-panel').textContent).toContain('my-proj');
  });
});
