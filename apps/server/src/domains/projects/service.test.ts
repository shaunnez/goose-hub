import { describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/projects.js', () => ({
  listProjects: vi.fn(),
  listProjectConfigs: vi.fn(),
}));

import { listProjectConfigs, listProjects } from '#shared/projects.js';
import { listProjectConfigsService, listProjectsService } from './service.js';

describe('listProjectsService (#208)', () => {
  it('returns { projects } shape from the underlying loader', async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([{ slug: 'a' }, { slug: 'b' }] as never);
    const result = await listProjectsService();
    expect(result).toEqual({ projects: [{ slug: 'a' }, { slug: 'b' }] });
  });

  it('returns empty list when no projects are registered', async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([] as never);
    const result = await listProjectsService();
    expect(result).toEqual({ projects: [] });
  });
});

describe('listProjectConfigsService (#280)', () => {
  const mockProject = {
    slug: 'my-proj',
    name: 'My Project',
    source: { kind: 'github', repo: 'owner/my-proj' },
    activeMilestone: 'M10: Orchestration',
    colorStripe: '#7c3aed',
    budgets: {
      perWorkflowMaxUsd: 2,
      dailyTokens: 500000,
      perAdvisorMaxUsd: 0.5,
      maxParallelAgents: 1,
      maxRetries: 3,
      maxIssuesPerDayFromNonOwners: 5,
      maxBashSeconds: 300,
      perAgentMaxUsd: 1,
    },
    mode: 'supervised',
  };

  it('maps full ProjectConfig to ProjectConfigDto shape', async () => {
    vi.mocked(listProjectConfigs).mockResolvedValueOnce([mockProject] as never);
    const result = await listProjectConfigsService();
    expect(result).toEqual({
      configs: [
        {
          slug: 'my-proj',
          name: 'My Project',
          source: { kind: 'github', repo: 'owner/my-proj' },
          activeMilestone: 'M10: Orchestration',
          colorStripe: '#7c3aed',
          budgets: { perWorkflowMaxUsd: 2, dailyTokens: 500000, perAdvisorMaxUsd: 0.5 },
          mode: 'supervised',
        },
      ],
    });
  });

  it('coerces missing activeMilestone to null', async () => {
    vi.mocked(listProjectConfigs).mockResolvedValueOnce([
      { ...mockProject, activeMilestone: undefined },
    ] as never);
    const result = await listProjectConfigsService();
    expect(result.configs[0].activeMilestone).toBeNull();
  });

  it('returns empty configs when no projects are registered', async () => {
    vi.mocked(listProjectConfigs).mockResolvedValueOnce([] as never);
    const result = await listProjectConfigsService();
    expect(result).toEqual({ configs: [] });
  });
});
