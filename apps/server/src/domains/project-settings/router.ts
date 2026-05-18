import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SKILL_BUDGETS } from '@goose-hub/core/agent-runtime/budgets.js';
import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { deriveSkillRuntimeResponse } from '@goose-hub/core/agent-runtime/skill-runtime-resolver.js';
import {
  deleteProjectSkillSetting,
  readProjectSettings,
  readProjectSkillSettings,
  resetAllProjectBudgets,
  writeProjectSettings,
  writeProjectSkillSetting,
} from '@goose-hub/core/db/repositories/project-settings.js';
import type { ModelProvider, ModelTier, Role } from '@goose-hub/core/types.js';
import { skillsRoot } from '@goose-hub/skills';
import { Hono } from 'hono';
import { z } from 'zod';
import { parseBody } from '#shared/middleware.js';
import { getProject } from '#shared/projects.js';

const router = new Hono();

const GlobalBudgetPatchSchema = z.object({
  perWorkflowMaxUsd: z.number().min(0).max(1000).nullable().optional(),
  perAgentMaxUsd: z.number().min(0).max(1000).nullable().optional(),
  perAdvisorMaxUsd: z.number().min(0).max(1000).nullable().optional(),
  dailyTokens: z.number().int().min(0).max(100_000_000).nullable().optional(),
  maxParallelAgents: z.number().int().min(0).max(50).nullable().optional(),
  maxScoutAgents: z.number().int().min(1).max(50).nullable().optional(),
  maxRetries: z.number().int().min(0).max(20).nullable().optional(),
  perBashCommandMaxSeconds: z.number().int().min(0).max(3600).nullable().optional(),
  qaE2eMode: z.enum(['off', 'ui-changed', 'always']).nullable().optional(),
  playwrightReproEnabled: z.number().int().min(0).max(1).nullable().optional(),
  evidencePostEnabled: z.number().int().min(0).max(1).nullable().optional(),
});

const SkillBudgetPatchSchema = z.object({
  maxTurns: z.number().int().min(1).max(500).nullable().optional(),
  maxBudgetUsd: z.number().min(0).max(100).nullable().optional(),
  timeoutMs: z.number().int().min(5_000).max(3_600_000).nullable().optional(),
  modelTier: z.enum(['haiku', 'sonnet', 'opus']).nullable().optional(),
  provider: z.enum(['claude', 'codex']).nullable().optional(),
});

function roleForSkill(skill: string): Role | undefined {
  if (skill === 'advise-on-plan') return 'researcher';
  if (skill === 'advise-on-prd' || skill === 'write-prd') return 'prd-writer';
  if (skill === 'bug-enhance' || skill === 'triage') return 'triager';
  if (skill === 'code-quality-audit') return 'auditor';
  if (skill === 'decompose-issues') return 'decomposer';
  if (skill === 'dev-review') return 'dev-reviewer';
  if (
    skill === 'dev-review-response' ||
    skill === 'echo-test' ||
    skill === 'evidence-post' ||
    skill === 'implement' ||
    skill === 'implement-wp' ||
    skill === 'resolve-conflict' ||
    skill === 'spec-author'
  )
    return 'developer';
  if (skill === 'grill-me') return 'griller';
  if (skill === 'investigate' || skill === 'playwright-repro') return 'investigator';
  if (skill === 'qa') return 'qa';
  if (skill === 'repo-match') return 'researcher';
  if (
    skill === 'retrospective-light' ||
    skill === 'retrospective-deep' ||
    skill === 'retrospective-cross-run' ||
    skill === 'skill-coach' ||
    skill === 'sprint-review'
  )
    return 'retrospector';
  if (skill === 'review') return 'reviewer';
  if (skill.startsWith('scout-') || skill.startsWith('wave2-')) return 'investigator';
  return undefined;
}

async function loadSkillRuntimeHint(skill: string): Promise<{
  role?: Role;
  modelTier?: ModelTier;
  provider?: ModelProvider;
}> {
  try {
    const configPath = join(skillsRoot, skill, 'skill.config.ts');
    // Cross-package boundary at runtime path: skill configs live in @goose-hub/skills.
    const mod = (await import(pathToFileURL(configPath).href)) as { default?: unknown };
    if (mod.default == null || typeof mod.default !== 'object') return {};
    const config = mod.default as Partial<SkillConfig>;
    return {
      role: config.role,
      modelTier: config.modelPin,
      provider: config.provider,
    };
  } catch {
    return {};
  }
}

/** GET /projects/:slug/settings — merged view of config + DB overrides */
router.get('/:slug/settings', async (c) => {
  const slug = c.req.param('slug');
  const project = await getProject(slug);
  if (project == null) return c.json({ error: 'project not found' }, 404);

  const globalRow = readProjectSettings(project.id);
  const skillRows = readProjectSkillSettings(project.id);
  const skillRuntimeHints = new Map<string, Awaited<ReturnType<typeof loadSkillRuntimeHint>>>();
  for (const skill of Object.keys(SKILL_BUDGETS)) {
    skillRuntimeHints.set(skill, await loadSkillRuntimeHint(skill));
  }

  const skillSettings: Record<
    string,
    {
      maxTurns: number | null;
      maxBudgetUsd: number | null;
      timeoutMs: number | null;
      modelTier: string | null;
      provider: string | null;
      updatedAt: string | null;
    }
  > = {};
  for (const [skill, row] of skillRows) {
    skillSettings[skill] = {
      maxTurns: row.maxTurns ?? null,
      maxBudgetUsd: row.maxBudgetUsd ?? null,
      timeoutMs: row.timeoutMs ?? null,
      modelTier: row.modelTier ?? null,
      provider: row.modelProvider ?? null,
      updatedAt: row.updatedAt,
    };
  }

  // UX-3: surface the actual SKILL_BUDGETS defaults so the UI can render them
  // beneath each per-skill input ("default: 25 turns") instead of just showing
  // "default" as placeholder text.
  const skillDefaults: Record<
    string,
    {
      maxTurns: number;
      maxBudgetUsd: number;
      timeoutMs: number;
      modelTier: string;
      modelProvider: string;
    }
  > = {};
  for (const [skill, budget] of Object.entries(SKILL_BUDGETS)) {
    const hint = skillRuntimeHints.get(skill);
    skillDefaults[skill] = {
      maxTurns: budget.maxTurns,
      maxBudgetUsd: budget.maxBudgetUsd,
      timeoutMs: budget.timeoutMs,
      modelTier: budget.modelTier,
      modelProvider: hint?.provider ?? budget.provider ?? 'claude',
    };
  }

  const resolvedSkillRuntimes: Record<
    string,
    {
      source: string;
      effectiveTier: string;
      effectiveProvider: string;
      resolvedPrimary: unknown;
      resolvedFallback: unknown;
      resolvedAdvisor: unknown;
    }
  > = {};
  for (const skill of Object.keys(SKILL_BUDGETS)) {
    const hint = skillRuntimeHints.get(skill);
    const role = hint?.role ?? roleForSkill(skill);
    const resolved = deriveSkillRuntimeResponse({
      skill,
      row: skillRows.get(skill),
      projectBudgets: project.budgets,
      configRuntime: project.agentConfig.runtime,
      role,
      allowHoldoutOverride: project.agentConfig.allowHoldoutOverride,
      skillProvider: hint?.provider ?? SKILL_BUDGETS[skill]?.provider,
      fallbackTier: hint?.modelTier,
      fallbackProvider: hint?.provider,
    });
    resolvedSkillRuntimes[skill] = {
      source: resolved.source,
      effectiveTier: resolved.tier,
      effectiveProvider: resolved.provider,
      resolvedPrimary: resolved.resolvedPrimary,
      resolvedFallback: resolved.resolvedFallback,
      resolvedAdvisor: resolved.resolvedAdvisor,
    };
  }

  const dbGlobalOverrides =
    globalRow != null &&
    [
      globalRow.perWorkflowMaxUsd,
      globalRow.perAgentMaxUsd,
      globalRow.perAdvisorMaxUsd,
      globalRow.dailyTokens,
      globalRow.maxParallelAgents,
      globalRow.maxScoutAgents,
      globalRow.maxRetries,
      globalRow.perBashCommandMaxSeconds,
    ].some((value) => value != null)
      ? {
          perWorkflowMaxUsd: globalRow.perWorkflowMaxUsd,
          perAgentMaxUsd: globalRow.perAgentMaxUsd,
          perAdvisorMaxUsd: globalRow.perAdvisorMaxUsd,
          dailyTokens: globalRow.dailyTokens,
          maxParallelAgents: globalRow.maxParallelAgents,
          maxScoutAgents: globalRow.maxScoutAgents,
          maxRetries: globalRow.maxRetries,
          perBashCommandMaxSeconds: globalRow.perBashCommandMaxSeconds,
          updatedAt: globalRow.updatedAt,
          updatedBy: globalRow.updatedBy,
        }
      : null;

  const dbPipelineFlags =
    globalRow != null
      ? {
          qaE2eMode: globalRow.qaE2eMode ?? null,
          playwrightReproEnabled: globalRow.playwrightReproEnabled ?? null,
          evidencePostEnabled: globalRow.evidencePostEnabled ?? null,
        }
      : null;

  return c.json({
    projectId: project.id,
    configBudgets: project.budgets,
    dbGlobalOverrides,
    dbPipelineFlags,
    dbSkillOverrides: skillSettings,
    registeredSkills: Object.keys(SKILL_BUDGETS),
    skillDefaults,
    resolvedSkillRuntimes,
  });
});

/**
 * DELETE /projects/:slug/settings/budgets — clear ALL budget overrides for
 * this project. Both global caps and every per-skill override are removed in
 * one transaction. The project then falls back to config + SKILL_BUDGETS
 * defaults. Backs the "Reset all to defaults" button in the Budgets UI.
 */
router.delete('/:slug/settings/budgets', async (c) => {
  const slug = c.req.param('slug');
  const project = await getProject(slug);
  if (project == null) return c.json({ error: 'project not found' }, 404);

  resetAllProjectBudgets(project.id);
  return c.json({ ok: true });
});

/** PATCH /projects/:slug/settings/global — upsert global budget caps */
router.patch('/:slug/settings/global', async (c) => {
  const slug = c.req.param('slug');
  const project = await getProject(slug);
  if (project == null) return c.json({ error: 'project not found' }, 404);

  const body = await parseBody<unknown>(c);
  if (!body.ok) return body.error;

  const parsed = GlobalBudgetPatchSchema.safeParse(body.data);
  if (!parsed.success) {
    return c.json({ error: 'invalid body', details: parsed.error.issues }, 422);
  }

  writeProjectSettings(project.id, parsed.data, 'ui');
  return c.json({ ok: true });
});

/** PATCH /projects/:slug/settings/skills/:skill — upsert per-skill override */
router.patch('/:slug/settings/skills/:skill', async (c) => {
  const slug = c.req.param('slug');
  const skill = c.req.param('skill');
  const project = await getProject(slug);
  if (project == null) return c.json({ error: 'project not found' }, 404);

  const body = await parseBody<unknown>(c);
  if (!body.ok) return body.error;

  const parsed = SkillBudgetPatchSchema.safeParse(body.data);
  if (!parsed.success) {
    return c.json({ error: 'invalid body', details: parsed.error.issues }, 422);
  }

  const { provider, ...patch } = parsed.data;
  writeProjectSkillSetting(
    project.id,
    skill,
    { ...patch, ...(provider !== undefined ? { modelProvider: provider } : {}) },
    'ui',
  );
  return c.json({ ok: true });
});

/** DELETE /projects/:slug/settings/skills/:skill — remove skill override */
router.delete('/:slug/settings/skills/:skill', async (c) => {
  const slug = c.req.param('slug');
  const skill = c.req.param('skill');
  const project = await getProject(slug);
  if (project == null) return c.json({ error: 'project not found' }, 404);

  deleteProjectSkillSetting(project.id, skill);
  return c.json({ ok: true });
});

export { router as projectSettingsRouter };
