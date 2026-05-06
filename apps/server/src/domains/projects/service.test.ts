import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/projects.js', () => ({
  listProjects: vi.fn(),
  listProjectConfigs: vi.fn(),
}));

vi.mock('@goose-hub/core/workflows/skill-coaching.js');

import { runSkillCoachingWorkflow } from '@goose-hub/core/workflows/skill-coaching.js';
import { listProjectConfigs, listProjects } from '#shared/projects.js';
import { coachSkillService, listProjectConfigsService, listProjectsService } from './service.js';

const mockRunSkillCoachingWorkflow = vi.mocked(runSkillCoachingWorkflow);

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

describe('coachSkillService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls runSkillCoachingWorkflow with projectId and params', async () => {
    mockRunSkillCoachingWorkflow.mockResolvedValueOnce(undefined);

    const result = await coachSkillService('test-proj', {
      targetSkillName: 'investigate',
      patternIds: ['p1', 'p2'],
    });

    expect(result.ok).toBe(true);
    expect(mockRunSkillCoachingWorkflow).toHaveBeenCalledWith({
      projectId: 'test-proj',
      targetSkillName: 'investigate',
      patternIds: ['p1', 'p2'],
      lifecycleIds: undefined,
    });
  });

  it('passes lifecycleIds when provided', async () => {
    mockRunSkillCoachingWorkflow.mockResolvedValueOnce(undefined);

    const result = await coachSkillService('test-proj', {
      targetSkillName: 'investigate',
      patternIds: ['p1'],
      lifecycleIds: ['l1', 'l2'],
    });

    expect(result.ok).toBe(true);
    expect(mockRunSkillCoachingWorkflow).toHaveBeenCalledWith({
      projectId: 'test-proj',
      targetSkillName: 'investigate',
      patternIds: ['p1'],
      lifecycleIds: ['l1', 'l2'],
    });
  });

  it('returns error when workflow throws', async () => {
    mockRunSkillCoachingWorkflow.mockRejectedValueOnce(new Error('Workflow failed'));

    const result = await coachSkillService('test-proj', {
      targetSkillName: 'investigate',
      patternIds: ['p1'],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Workflow failed');
    }
  });
});
