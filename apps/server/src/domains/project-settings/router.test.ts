import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDeleteProjectSkillSetting,
  mockGetUseInvestigationSwarm,
  mockGetUseMultiAgentPipeline,
  mockGetProject,
  mockParseReviewerSlots,
  mockReadProjectDevReviewSettings,
  mockReadProjectReviewSettings,
  mockReadProjectSettings,
  mockReadProjectSkillSettings,
  mockResetAllProjectBudgets,
  mockSetUseInvestigationSwarm,
  mockSetUseMultiAgentPipeline,
  mockWriteProjectDevReviewSettings,
  mockWriteProjectReviewSettings,
  mockWriteProjectSettings,
  mockWriteProjectSkillSetting,
  mockProfileRuntimeProject,
} = vi.hoisted(() => ({
  mockDeleteProjectSkillSetting: vi.fn(),
  mockGetUseInvestigationSwarm: vi.fn(),
  mockGetUseMultiAgentPipeline: vi.fn(),
  mockGetProject: vi.fn(),
  mockParseReviewerSlots: vi.fn(),
  mockReadProjectDevReviewSettings: vi.fn(),
  mockReadProjectReviewSettings: vi.fn(),
  mockReadProjectSettings: vi.fn(),
  mockReadProjectSkillSettings: vi.fn(),
  mockResetAllProjectBudgets: vi.fn(),
  mockSetUseInvestigationSwarm: vi.fn(),
  mockSetUseMultiAgentPipeline: vi.fn(),
  mockWriteProjectDevReviewSettings: vi.fn(),
  mockWriteProjectReviewSettings: vi.fn(),
  mockWriteProjectSettings: vi.fn(),
  mockWriteProjectSkillSetting: vi.fn(),
  mockProfileRuntimeProject: vi.fn(),
}));

vi.mock('#shared/projects.js', () => ({
  getProject: mockGetProject,
}));

vi.mock('@goose-hub/core/db/repositories/project-settings.js', () => ({
  deleteProjectSkillSetting: mockDeleteProjectSkillSetting,
  getUseInvestigationSwarm: mockGetUseInvestigationSwarm,
  getUseMultiAgentPipeline: mockGetUseMultiAgentPipeline,
  readProjectSettings: mockReadProjectSettings,
  readProjectSkillSettings: mockReadProjectSkillSettings,
  resetAllProjectBudgets: mockResetAllProjectBudgets,
  setUseInvestigationSwarm: mockSetUseInvestigationSwarm,
  setUseMultiAgentPipeline: mockSetUseMultiAgentPipeline,
  writeProjectSettings: mockWriteProjectSettings,
  writeProjectSkillSetting: mockWriteProjectSkillSetting,
}));

vi.mock('@goose-hub/core/db/repositories/project-dev-review-settings.js', () => ({
  readProjectDevReviewSettings: mockReadProjectDevReviewSettings,
  writeProjectDevReviewSettings: mockWriteProjectDevReviewSettings,
}));

vi.mock('@goose-hub/core/db/repositories/project-review-settings.js', () => ({
  parseReviewerSlots: mockParseReviewerSlots,
  readProjectReviewSettings: mockReadProjectReviewSettings,
  writeProjectReviewSettings: mockWriteProjectReviewSettings,
}));

vi.mock('@goose-hub/core/runtime-profiler/profile-runs.js', () => ({
  profileRuntimeProject: mockProfileRuntimeProject,
}));

import { projectSettingsRouter } from './router.js';

function makeApp() {
  return new Hono().route('/projects', projectSettingsRouter);
}

function project() {
  return {
    id: 'goose-hub-self',
    budgets: {},
    agentConfig: {
      runtime: 'auto',
      allowHoldoutOverride: false,
      rolesModels: {},
    },
  };
}

describe('project settings router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProject.mockResolvedValue(project());
    mockReadProjectSettings.mockReturnValue(null);
    mockReadProjectSkillSettings.mockReturnValue(new Map());
    mockReadProjectDevReviewSettings.mockReturnValue(null);
    mockReadProjectReviewSettings.mockReturnValue(null);
    mockParseReviewerSlots.mockReturnValue(null);
    mockGetUseMultiAgentPipeline.mockReturnValue(false);
    mockGetUseInvestigationSwarm.mockReturnValue(true);
    mockProfileRuntimeProject.mockReturnValue({
      projectId: 'goose-hub-self',
      window: {
        days: 14,
        sinceIso: '2026-05-06T00:00:00.000Z',
        untilIso: '2026-05-20T00:00:00.000Z',
      },
      skills: [],
    });
  });

  it('does not expose the removed role-model settings route', async () => {
    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/settings/models');

    expect(res.status).toBe(404);
  });

  it('keeps Codex auth status under project settings', async () => {
    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/settings/codex-auth');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      loginCommand: 'codex login',
    });
  });

  it('returns observed runtime profiler data for the project', async () => {
    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/runtime-profiler?days=7&skill=qa');

    expect(res.status).toBe(200);
    expect(mockProfileRuntimeProject).toHaveBeenCalledWith({
      projectId: 'goose-hub-self',
      days: 7,
      skill: 'qa',
    });
    expect(await res.json()).toMatchObject({
      projectId: 'goose-hub-self',
      skills: [],
    });
  });

  it('returns Codex provider defaults for provider-pinned skills', async () => {
    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/settings');

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      skillDefaults: Record<string, { modelProvider: string }>;
      skillMetadata: Record<
        string,
        { description: string | null; dependencies: string[]; callers: string[] }
      >;
      resolvedSkillRuntimes: Record<
        string,
        { effectiveProvider: string; resolvedPrimary: { modelId: string } }
      >;
    };

    expect(body.skillDefaults['dev-review'].modelProvider).toBe('codex');
    expect(body.resolvedSkillRuntimes['dev-review'].effectiveProvider).toBe('codex');
    expect(body.resolvedSkillRuntimes['dev-review'].resolvedPrimary.modelId).toBe('gpt-5.4');
    expect(body.skillMetadata['dev-review'].description).toContain('Codex pre-QA dev-review');
    expect(body.skillMetadata['dev-review'].dependencies).toContain('prDiff');
    expect(body.skillMetadata['dev-review'].callers).toContain('developer pre-QA advisor');
  });

  it('writes tier/provider patches to project_skill_settings model columns', async () => {
    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/settings/skills/repo-match', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelTier: 'sonnet', provider: 'codex' }),
    });

    expect(res.status).toBe(200);
    expect(mockWriteProjectSkillSetting).toHaveBeenCalledWith(
      'goose-hub-self',
      'repo-match',
      { modelTier: 'sonnet', modelProvider: 'codex' },
      'ui',
    );
  });

  it('writes effort patches to project_skill_settings', async () => {
    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/settings/skills/repo-match', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ effort: 'high' }),
    });

    expect(res.status).toBe(200);
    expect(mockWriteProjectSkillSetting).toHaveBeenCalledWith(
      'goose-hub-self',
      'repo-match',
      { effort: 'high' },
      'ui',
    );
  });

  it('resolves per-skill DB tier/provider above project config and skill defaults', async () => {
    mockGetProject.mockResolvedValue({
      ...project(),
      budgets: {
        skillBudgetOverrides: {
          'repo-match': { modelTier: 'opus' },
        },
      },
    });
    mockReadProjectSkillSettings.mockReturnValue(
      new Map([
        [
          'repo-match',
          {
            projectId: 'goose-hub-self',
            skillName: 'repo-match',
            modelTier: 'sonnet',
            modelProvider: 'codex',
            effort: 'xhigh',
            updatedAt: '2026-05-18T00:00:00Z',
          },
        ],
      ]),
    );

    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/settings');
    const body = (await res.json()) as {
      resolvedSkillRuntimes: Record<
        string,
        {
          source: string;
          effectiveTier: string;
          effectiveProvider: string;
          effectiveEffort: string | null;
          resolvedPrimary: { modelId: string };
        }
      >;
    };

    expect(body.resolvedSkillRuntimes['repo-match']).toMatchObject({
      source: 'db',
      effectiveTier: 'sonnet',
      effectiveProvider: 'codex',
      effectiveEffort: 'xhigh',
      resolvedPrimary: { modelId: 'gpt-5.4' },
    });
  });

  it('coerces per-skill provider when project runtime is forced', async () => {
    mockGetProject.mockResolvedValue({
      ...project(),
      agentConfig: {
        ...project().agentConfig,
        runtime: 'codex-cli',
      },
    });
    mockReadProjectSkillSettings.mockReturnValue(
      new Map([
        [
          'repo-match',
          {
            projectId: 'goose-hub-self',
            skillName: 'repo-match',
            modelTier: 'sonnet',
            modelProvider: 'claude',
            updatedAt: '2026-05-18T00:00:00Z',
          },
        ],
      ]),
    );

    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/settings');
    const body = (await res.json()) as {
      resolvedSkillRuntimes: Record<
        string,
        { effectiveProvider: string; resolvedPrimary: { modelId: string } }
      >;
    };

    expect(body.resolvedSkillRuntimes['repo-match'].effectiveProvider).toBe('codex');
    expect(body.resolvedSkillRuntimes['repo-match'].resolvedPrimary.modelId).toBe('gpt-5.4');
  });

  it('does not expose fallback or advisor models for holdout skills', async () => {
    mockReadProjectSkillSettings.mockReturnValue(
      new Map([
        [
          'qa',
          {
            projectId: 'goose-hub-self',
            skillName: 'qa',
            modelTier: 'haiku',
            modelProvider: 'codex',
            updatedAt: '2026-05-18T00:00:00Z',
          },
        ],
      ]),
    );

    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/settings');
    const body = (await res.json()) as {
      resolvedSkillRuntimes: Record<
        string,
        {
          effectiveTier: string;
          effectiveProvider: string;
          resolvedFallback: unknown;
          resolvedAdvisor: unknown;
        }
      >;
    };

    expect(body.resolvedSkillRuntimes.qa.effectiveTier).toBe('sonnet');
    expect(body.resolvedSkillRuntimes.qa.effectiveProvider).toBe('claude');
    expect(body.resolvedSkillRuntimes.qa.resolvedFallback).toBeNull();
    expect(body.resolvedSkillRuntimes.qa.resolvedAdvisor).toBeNull();
  });
});
