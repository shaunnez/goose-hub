import { SKILL_BUDGETS } from '@goose-hub/core/agent-runtime/budgets.js';
import {
  deleteProjectSkillSetting,
  readProjectSettings,
  readProjectSkillSettings,
  resetAllProjectBudgets,
  writeProjectSettings,
  writeProjectSkillSetting,
} from '@goose-hub/core/db/repositories/project-settings.js';
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
  maxRetries: z.number().int().min(0).max(20).nullable().optional(),
  perBashCommandMaxSeconds: z.number().int().min(0).max(3600).nullable().optional(),
});

const SkillBudgetPatchSchema = z.object({
  maxTurns: z.number().int().min(1).max(500).nullable().optional(),
  maxBudgetUsd: z.number().min(0).max(100).nullable().optional(),
  timeoutMs: z.number().int().min(5_000).max(3_600_000).nullable().optional(),
});

/** GET /projects/:slug/settings — merged view of config + DB overrides */
router.get('/:slug/settings', async (c) => {
  const slug = c.req.param('slug');
  const project = await getProject(slug);
  if (project == null) return c.json({ error: 'project not found' }, 404);

  const globalRow = readProjectSettings(project.id);
  const skillRows = readProjectSkillSettings(project.id);

  const skillSettings: Record<
    string,
    {
      maxTurns: number | null;
      maxBudgetUsd: number | null;
      timeoutMs: number | null;
      updatedAt: string | null;
    }
  > = {};
  for (const [skill, row] of skillRows) {
    skillSettings[skill] = {
      maxTurns: row.maxTurns ?? null,
      maxBudgetUsd: row.maxBudgetUsd ?? null,
      timeoutMs: row.timeoutMs ?? null,
      updatedAt: row.updatedAt,
    };
  }

  // UX-3: surface the actual SKILL_BUDGETS defaults so the UI can render them
  // beneath each per-skill input ("default: 25 turns") instead of just showing
  // "default" as placeholder text.
  const skillDefaults: Record<
    string,
    { maxTurns: number; maxBudgetUsd: number; timeoutMs: number }
  > = {};
  for (const [skill, budget] of Object.entries(SKILL_BUDGETS)) {
    skillDefaults[skill] = {
      maxTurns: budget.maxTurns,
      maxBudgetUsd: budget.maxBudgetUsd,
      timeoutMs: budget.timeoutMs,
    };
  }

  return c.json({
    projectId: project.id,
    configBudgets: project.budgets,
    dbGlobalOverrides: globalRow
      ? {
          perWorkflowMaxUsd: globalRow.perWorkflowMaxUsd,
          perAgentMaxUsd: globalRow.perAgentMaxUsd,
          perAdvisorMaxUsd: globalRow.perAdvisorMaxUsd,
          dailyTokens: globalRow.dailyTokens,
          maxParallelAgents: globalRow.maxParallelAgents,
          maxRetries: globalRow.maxRetries,
          perBashCommandMaxSeconds: globalRow.perBashCommandMaxSeconds,
          updatedAt: globalRow.updatedAt,
          updatedBy: globalRow.updatedBy,
        }
      : null,
    dbSkillOverrides: skillSettings,
    registeredSkills: Object.keys(SKILL_BUDGETS),
    skillDefaults,
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

  writeProjectSkillSetting(project.id, skill, parsed.data, 'ui');
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
