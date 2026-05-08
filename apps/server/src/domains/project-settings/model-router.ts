import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ROLE_DEFAULTS } from '@goose-hub/core/agent-runtime/roles.js';
import {
  readProjectDevReviewSettings,
  writeProjectDevReviewSettings,
} from '@goose-hub/core/db/repositories/project-dev-review-settings.js';
import {
  deleteRoleModelSetting,
  readProjectModelSettings,
  writeComplexityOverrides,
  writeRoleModelSetting,
} from '@goose-hub/core/db/repositories/project-model-settings.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { parseBody } from '#shared/middleware.js';
import { getProject } from '#shared/projects.js';

const router = new Hono();

const VALID_TIERS = ['haiku', 'sonnet', 'opus'] as const;
const TierSchema = z.enum(VALID_TIERS).nullable().optional();

const RoleModelPatchSchema = z.object({
  primaryModel: TierSchema,
  fallbackModel: TierSchema,
  advisorModel: TierSchema,
});

const ComplexityOverridesSchema = z.record(z.string(), z.enum(VALID_TIERS));

/** GET /projects/:slug/settings/models — merged view of config + DB overrides */
router.get('/:slug/settings/models', async (c) => {
  const slug = c.req.param('slug');
  const project = await getProject(slug);
  if (project == null) return c.json({ error: 'project not found' }, 404);

  const dbRows = readProjectModelSettings(project.id);
  const configRolesModels = project.agentConfig?.rolesModels ?? {};

  const roles = Object.keys(ROLE_DEFAULTS) as Array<keyof typeof ROLE_DEFAULTS>;
  const result: Record<
    string,
    {
      configRoleModel: { primary: string; fallback: string | null; advisor: string | null } | null;
      dbRoleModel: {
        primaryModel: string | null;
        fallbackModel: string | null;
        advisorModel: string | null;
        updatedAt: string | null;
      } | null;
      dbComplexityOverrides: Record<string, string>;
    }
  > = {};

  for (const role of roles) {
    const dbRow = dbRows.get(role) ?? null;
    const configEntry = configRolesModels[role] ?? null;
    let complexityOverrides: Record<string, string> = {};
    if (dbRow?.complexityOverridesJson) {
      try {
        complexityOverrides = JSON.parse(dbRow.complexityOverridesJson) as Record<string, string>;
      } catch {
        complexityOverrides = {};
      }
    }

    result[role] = {
      configRoleModel: configEntry
        ? {
            primary: configEntry.primary,
            fallback: configEntry.fallback,
            advisor: configEntry.advisor,
          }
        : null,
      dbRoleModel: dbRow
        ? {
            primaryModel: dbRow.primaryModel ?? null,
            fallbackModel: dbRow.fallbackModel ?? null,
            advisorModel: dbRow.advisorModel ?? null,
            updatedAt: dbRow.updatedAt,
          }
        : null,
      dbComplexityOverrides: complexityOverrides,
    };
  }

  return c.json({
    projectId: project.id,
    allowHoldoutOverride: project.agentConfig?.allowHoldoutOverride ?? false,
    roles: result,
  });
});

/** PATCH /projects/:slug/settings/models/:role — upsert per-role model assignment */
router.patch('/:slug/settings/models/:role', async (c) => {
  const slug = c.req.param('slug');
  const role = c.req.param('role');
  const project = await getProject(slug);
  if (project == null) return c.json({ error: 'project not found' }, 404);

  const body = await parseBody<unknown>(c);
  if (!body.ok) return body.error;

  const parsed = RoleModelPatchSchema.safeParse(body.data);
  if (!parsed.success) {
    return c.json({ error: 'invalid body', details: parsed.error.issues }, 422);
  }

  writeRoleModelSetting(project.id, role, parsed.data, 'ui');
  return c.json({ ok: true });
});

/** PATCH /projects/:slug/settings/models/:role/complexity — upsert complexity overrides */
router.patch('/:slug/settings/models/:role/complexity', async (c) => {
  const slug = c.req.param('slug');
  const role = c.req.param('role');
  const project = await getProject(slug);
  if (project == null) return c.json({ error: 'project not found' }, 404);

  const body = await parseBody<unknown>(c);
  if (!body.ok) return body.error;

  const parsed = ComplexityOverridesSchema.safeParse(body.data);
  if (!parsed.success) {
    return c.json({ error: 'invalid body', details: parsed.error.issues }, 422);
  }

  writeComplexityOverrides(project.id, role, parsed.data, 'ui');
  return c.json({ ok: true });
});

/** DELETE /projects/:slug/settings/models/:role — remove all overrides for a role */
router.delete('/:slug/settings/models/:role', async (c) => {
  const slug = c.req.param('slug');
  const role = c.req.param('role');
  const project = await getProject(slug);
  if (project == null) return c.json({ error: 'project not found' }, 404);

  deleteRoleModelSetting(project.id, role);
  return c.json({ ok: true });
});

/**
 * GET /:slug/settings/codex-auth — read-only Codex CLI auth presence check.
 * Machine-scoped data, but exposed under the project route so it's discoverable
 * alongside the per-project Models UI. Returns the same payload regardless of slug.
 */
router.get('/:slug/settings/codex-auth', async (c) => {
  const slug = c.req.param('slug');
  const project = await getProject(slug);
  if (project == null) return c.json({ error: 'project not found' }, 404);

  const authPath = join(homedir(), '.codex', 'auth.json');
  const status = existsSync(authPath) ? 'connected' : 'missing';
  return c.json({
    status,
    authPath,
    loginCommand: 'codex login',
  });
});

// ─── Dev-review settings (M19.12) ────────────────────────────────────────────

const DevReviewPatchSchema = z.object({
  enabled: z.boolean().nullable().optional(),
  triggerOn: z
    .enum(['all', 'priority:medium+', 'priority:high+', 'priority:critical'])
    .nullable()
    .optional(),
  maxRevisionTurns: z.number().int().min(1).max(5).nullable().optional(),
  perCycleMaxUsd: z.number().min(0).max(50).nullable().optional(),
  timeoutMs: z.number().int().min(30_000).max(1_800_000).nullable().optional(),
});

/** GET /projects/:slug/settings/dev-review — merged view of config + DB override */
router.get('/:slug/settings/dev-review', async (c) => {
  const slug = c.req.param('slug');
  const project = await getProject(slug);
  if (project == null) return c.json({ error: 'project not found' }, 404);

  const dbRow = readProjectDevReviewSettings(project.id);
  const configDevReview = project.agentConfig?.devReview ?? null;

  return c.json({
    projectId: project.id,
    config: configDevReview,
    dbOverride: dbRow
      ? {
          enabled: dbRow.enabled ?? null,
          triggerOn: dbRow.triggerOn ?? null,
          maxRevisionTurns: dbRow.maxRevisionTurns ?? null,
          perCycleMaxUsd: dbRow.perCycleMaxUsd ?? null,
          timeoutMs: dbRow.timeoutMs ?? null,
          updatedAt: dbRow.updatedAt,
          updatedBy: dbRow.updatedBy ?? null,
        }
      : null,
  });
});

/** PATCH /projects/:slug/settings/dev-review — upsert dev-review config override */
router.patch('/:slug/settings/dev-review', async (c) => {
  const slug = c.req.param('slug');
  const project = await getProject(slug);
  if (project == null) return c.json({ error: 'project not found' }, 404);

  const body = await parseBody<unknown>(c);
  if (!body.ok) return body.error;

  const parsed = DevReviewPatchSchema.safeParse(body.data);
  if (!parsed.success) {
    return c.json({ error: 'invalid body', details: parsed.error.issues }, 422);
  }

  writeProjectDevReviewSettings(project.id, parsed.data, 'ui');
  return c.json({ ok: true });
});

export { router as projectModelRouter };
