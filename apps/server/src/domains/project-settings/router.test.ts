import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDeleteProjectSkillSetting,
  mockGetProject,
  mockReadProjectSettings,
  mockReadProjectSkillSettings,
  mockResetAllProjectBudgets,
  mockWriteProjectSettings,
  mockWriteProjectSkillSetting,
} = vi.hoisted(() => ({
  mockDeleteProjectSkillSetting: vi.fn(),
  mockGetProject: vi.fn(),
  mockReadProjectSettings: vi.fn(),
  mockReadProjectSkillSettings: vi.fn(),
  mockResetAllProjectBudgets: vi.fn(),
  mockWriteProjectSettings: vi.fn(),
  mockWriteProjectSkillSetting: vi.fn(),
}));

vi.mock('#shared/projects.js', () => ({
  getProject: mockGetProject,
}));

vi.mock('@goose-hub/core/db/repositories/project-settings.js', () => ({
  deleteProjectSkillSetting: mockDeleteProjectSkillSetting,
  readProjectSettings: mockReadProjectSettings,
  readProjectSkillSettings: mockReadProjectSkillSettings,
  resetAllProjectBudgets: mockResetAllProjectBudgets,
  writeProjectSettings: mockWriteProjectSettings,
  writeProjectSkillSetting: mockWriteProjectSkillSetting,
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
});
