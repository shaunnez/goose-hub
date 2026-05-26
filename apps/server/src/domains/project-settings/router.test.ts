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
  DEFAULT_COACH_POLICY: { enabled: false, consistencyThreshold: 0.8, minLifecycles: 3 },
  deleteProjectSkillSetting: mockDeleteProjectSkillSetting,
  deriveCoachPolicy: (
    row: {
      coachPolicyEnabled?: number | null;
      coachPolicyConsistencyThreshold?: number | null;
      coachPolicyMinLifecycles?: number | null;
    } | null,
    configDefault:
      | { enabled: boolean; consistencyThreshold: number; minLifecycles: number }
      | null
      | undefined,
  ) => {
    const base = configDefault ?? { enabled: false, consistencyThreshold: 0.8, minLifecycles: 3 };
    return {
      enabled: row?.coachPolicyEnabled == null ? base.enabled : row.coachPolicyEnabled === 1,
      consistencyThreshold:
        row?.coachPolicyConsistencyThreshold == null
          ? base.consistencyThreshold
          : row.coachPolicyConsistencyThreshold,
      minLifecycles:
        row?.coachPolicyMinLifecycles == null ? base.minLifecycles : row.coachPolicyMinLifecycles,
    };
  },
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
      coachPolicy: { enabled: false, consistencyThreshold: 0.8, minLifecycles: 3 },
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

  it('returns learning loop coach policy with DB overrides resolved above config', async () => {
    mockReadProjectSettings.mockReturnValue({
      projectId: 'goose-hub-self',
      coachPolicyEnabled: 1,
      coachPolicyConsistencyThreshold: 0.92,
      coachPolicyMinLifecycles: 6,
      updatedAt: '2026-05-20T00:00:00Z',
      updatedBy: 'ui',
    });
    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/settings/learning-loop');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      projectId: 'goose-hub-self',
      coachPolicy: { enabled: true, consistencyThreshold: 0.92, minLifecycles: 6 },
      configDefaults: { enabled: false, consistencyThreshold: 0.8, minLifecycles: 3 },
      dbOverrides: {
        enabled: true,
        consistencyThreshold: 0.92,
        minLifecycles: 6,
        updatedBy: 'ui',
      },
    });
  });

  it('writes learning loop coach policy overrides', async () => {
    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/settings/learning-loop', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, consistencyThreshold: 0.9, minLifecycles: 5 }),
    });

    expect(res.status).toBe(200);
    expect(mockWriteProjectSettings).toHaveBeenCalledWith(
      'goose-hub-self',
      {
        coachPolicyEnabled: 1,
        coachPolicyConsistencyThreshold: 0.9,
        coachPolicyMinLifecycles: 5,
      },
      'ui',
    );
  });

  it('clears learning loop coach policy overrides with null', async () => {
    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/settings/learning-loop', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: null, consistencyThreshold: null, minLifecycles: null }),
    });

    expect(res.status).toBe(200);
    expect(mockWriteProjectSettings).toHaveBeenCalledWith(
      'goose-hub-self',
      {
        coachPolicyEnabled: null,
        coachPolicyConsistencyThreshold: null,
        coachPolicyMinLifecycles: null,
      },
      'ui',
    );
  });

  it('rejects invalid learning loop policy patches', async () => {
    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/settings/learning-loop', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consistencyThreshold: 1.5, minLifecycles: 0 }),
    });

    expect(res.status).toBe(422);
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

  it('returns implement-WP defaults, DB overrides, and resolved settings', async () => {
    mockGetProject.mockResolvedValue({
      ...project(),
      budgets: {
        implementWp: {
          editTestLoopMaxCycles: 4,
          budgetSizing: {
            bug: { maxTurns: 80, maxBudgetUsd: 5 },
            feature: { maxTurns: 110, maxBudgetUsd: 7 },
            complex: { maxTurns: 140, maxBudgetUsd: 9 },
            complexAdditions: {
              highPriorityUsd: 2,
              manyFilesThreshold: 5,
              manyFilesUsd: 1.5,
              contractUsd: 2.5,
            },
          },
        },
      },
    });
    mockReadProjectSettings.mockReturnValue({
      projectId: 'goose-hub-self',
      implementWpEditTestLoopMaxCycles: 2,
      implementWpBugMaxTurns: null,
      implementWpBugMaxBudgetUsd: 3.5,
      implementWpFeatureMaxTurns: null,
      implementWpFeatureMaxBudgetUsd: null,
      implementWpComplexMaxTurns: null,
      implementWpComplexMaxBudgetUsd: null,
      implementWpHighPriorityUsd: null,
      implementWpManyFilesThreshold: null,
      implementWpManyFilesUsd: null,
      implementWpContractUsd: null,
      updatedAt: '2026-05-26T00:00:00Z',
      updatedBy: 'ui',
    });

    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/settings');
    const body = (await res.json()) as {
      implementWpDefaults: Record<string, number>;
      dbImplementWpOverrides: Record<string, number | string | null>;
      resolvedImplementWp: Record<string, number>;
    };

    expect(res.status).toBe(200);
    expect(body.implementWpDefaults).toMatchObject({
      editTestLoopMaxCycles: 4,
      bugMaxTurns: 80,
      bugMaxBudgetUsd: 5,
      highPriorityUsd: 2,
      manyFilesThreshold: 5,
    });
    expect(body.dbImplementWpOverrides).toMatchObject({
      implementWpEditTestLoopMaxCycles: 2,
      implementWpBugMaxBudgetUsd: 3.5,
      updatedBy: 'ui',
    });
    expect(body.resolvedImplementWp).toMatchObject({
      editTestLoopMaxCycles: 2,
      bugMaxTurns: 80,
      bugMaxBudgetUsd: 3.5,
      featureMaxBudgetUsd: 7,
    });
  });

  it('writes implement-WP workflow-level patches through project settings', async () => {
    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/settings/global', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        implementWpEditTestLoopMaxCycles: 2,
        implementWpFeatureMaxBudgetUsd: 9.5,
        implementWpManyFilesThreshold: null,
      }),
    });

    expect(res.status).toBe(200);
    expect(mockWriteProjectSettings).toHaveBeenCalledWith(
      'goose-hub-self',
      {
        implementWpEditTestLoopMaxCycles: 2,
        implementWpFeatureMaxBudgetUsd: 9.5,
        implementWpManyFilesThreshold: null,
      },
      'ui',
    );
  });

  it('rejects invalid implement-WP workflow-level patches', async () => {
    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/settings/global', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        implementWpEditTestLoopMaxCycles: 0,
        implementWpManyFilesThreshold: 101,
      }),
    });

    expect(res.status).toBe(422);
    expect(mockWriteProjectSettings).not.toHaveBeenCalled();
  });

  it('routes reset-all through the budget reset repository helper', async () => {
    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/settings/budgets', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    expect(mockResetAllProjectBudgets).toHaveBeenCalledWith('goose-hub-self');
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

  it('writes escalation patches to project_skill_settings', async () => {
    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/settings/skills/implement', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        escalationModelTier: 'opus',
        escalationMaxBudgetUsd: 18,
        escalationMaxTurns: 90,
        escalationTimeoutMs: 420000,
      }),
    });

    expect(res.status).toBe(200);
    expect(mockWriteProjectSkillSetting).toHaveBeenCalledWith(
      'goose-hub-self',
      'implement',
      {
        escalationModelTier: 'opus',
        escalationMaxBudgetUsd: 18,
        escalationMaxTurns: 90,
        escalationTimeoutMs: 420000,
      },
      'ui',
    );
  });

  it('writes implement-WP contract keyword patches through global settings', async () => {
    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/settings/global', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ implementWpContractKeywords: ['schema', 'migration', 'auth'] }),
    });

    expect(res.status).toBe(200);
    expect(mockWriteProjectSettings).toHaveBeenCalledWith(
      'goose-hub-self',
      { implementWpContractKeywordsJson: JSON.stringify(['schema', 'migration', 'auth']) },
      'ui',
    );
  });

  it('clears implement-WP contract keyword overrides when the patch is empty', async () => {
    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/settings/global', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ implementWpContractKeywords: [] }),
    });

    expect(res.status).toBe(200);
    expect(mockWriteProjectSettings).toHaveBeenCalledWith(
      'goose-hub-self',
      { implementWpContractKeywordsJson: null },
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
          resolutionTrace: {
            tier: { value: string; source: string };
            provider: { value: string; source: string };
            effort?: { value: string; source: string };
          };
        }
      >;
    };

    expect(body.resolvedSkillRuntimes['repo-match']).toMatchObject({
      source: 'db',
      effectiveTier: 'sonnet',
      effectiveProvider: 'codex',
      effectiveEffort: 'xhigh',
      resolvedPrimary: { modelId: 'gpt-5.4' },
      resolutionTrace: {
        tier: { value: 'sonnet', source: 'db' },
        provider: { value: 'codex', source: 'db' },
        effort: { value: 'xhigh', source: 'db' },
      },
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
        {
          source: string;
          effectiveProvider: string;
          resolvedPrimary: { modelId: string };
          resolutionTrace: { provider: { value: string; source: string; reason: string } };
        }
      >;
    };

    expect(body.resolvedSkillRuntimes['repo-match'].source).toBe('db');
    expect(body.resolvedSkillRuntimes['repo-match'].effectiveProvider).toBe('codex');
    expect(body.resolvedSkillRuntimes['repo-match'].resolvedPrimary.modelId).toBe('gpt-5.4');
    expect(body.resolvedSkillRuntimes['repo-match'].resolutionTrace.provider).toMatchObject({
      value: 'codex',
      source: 'config',
    });
    expect(body.resolvedSkillRuntimes['repo-match'].resolutionTrace.provider.reason).toContain(
      'codex-cli forces provider codex',
    );
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
          resolutionTrace: {
            tier: { value: string; source: string; reason: string };
            provider: { value: string; source: string; reason: string };
          };
        }
      >;
    };

    expect(body.resolvedSkillRuntimes.qa.effectiveTier).toBe('sonnet');
    expect(body.resolvedSkillRuntimes.qa.effectiveProvider).toBe('claude');
    expect(body.resolvedSkillRuntimes.qa.resolvedFallback).toBeNull();
    expect(body.resolvedSkillRuntimes.qa.resolvedAdvisor).toBeNull();
    expect(body.resolvedSkillRuntimes.qa.resolutionTrace.tier.reason).toContain(
      'holdout skill ignores',
    );
    expect(body.resolvedSkillRuntimes.qa.resolutionTrace.provider.reason).toContain(
      'holdout skill ignores',
    );
  });
});
