import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SKILL_BUDGETS } from '@goose-hub/core/agent-runtime/budgets.js';
import { defaultModelForTierAndProvider } from '@goose-hub/core/agent-runtime/models.js';
import { HOLDOUT_ROLES, ROLE_DEFAULTS } from '@goose-hub/core/agent-runtime/roles.js';
import {
  readProjectDevReviewSettings,
  writeProjectDevReviewSettings,
} from '@goose-hub/core/db/repositories/project-dev-review-settings.js';
import {
  deleteAllRoleModelSettings,
  deleteRoleModelSetting,
  readProjectModelSettings,
  writeBulkRoleModelPrimary,
  writeComplexityOverrides,
  writeRoleModelSetting,
} from '@goose-hub/core/db/repositories/project-model-settings.js';
import {
  parseReviewerSlots,
  readProjectReviewSettings,
  writeProjectReviewSettings,
} from '@goose-hub/core/db/repositories/project-review-settings.js';
import {
  getUseInvestigationSwarm,
  getUseMultiAgentPipeline,
  setUseInvestigationSwarm,
  setUseMultiAgentPipeline,
} from '@goose-hub/core/db/repositories/project-settings.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { parseBody } from '#shared/middleware.js';
import { getProject } from '#shared/projects.js';

const router = new Hono();

const VALID_TIERS = ['haiku', 'sonnet', 'opus'] as const;
const VALID_PROVIDERS = ['claude', 'codex'] as const;
const TierSchema = z.enum(VALID_TIERS).nullable().optional();
const ProviderSchema = z.enum(VALID_PROVIDERS).nullable().optional();

const RoleModelPatchSchema = z.object({
  primaryModel: TierSchema,
  fallbackModel: TierSchema,
  advisorModel: TierSchema,
  primaryProvider: ProviderSchema,
  fallbackProvider: ProviderSchema,
  advisorProvider: ProviderSchema,
  maxTurns: z.number().int().min(1).max(500).nullable().optional(),
  timeoutMs: z.number().int().min(5_000).max(3_600_000).nullable().optional(),
});

const BulkRoleModelSchema = z.object({
  tier: z.enum(VALID_TIERS),
  provider: z.enum(VALID_PROVIDERS),
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
  type Provider = (typeof VALID_PROVIDERS)[number];
  type Tier = (typeof VALID_TIERS)[number];

  // Find a representative skill for each role so we can resolve a sensible
  // "skill default" tier for the UX-3 hint. Multiple skills can declare a role,
  // but using the first match is enough for a hint — the UI just needs to
  // surface "what tier kicks in if nothing is overridden".
  const skillDefaultsByRole = new Map<string, Tier>();
  for (const [, budget] of Object.entries(SKILL_BUDGETS)) {
    // SKILL_BUDGETS has no explicit role field; the role mapping is via skill
    // config files. Default each role to the global sonnet baseline; the UI
    // hint is still informative because the role's row-default also shows.
    void budget;
  }
  void skillDefaultsByRole;

  function resolveModelId(tier: Tier | null, provider: Provider | null): string | null {
    if (tier == null) return null;
    try {
      return defaultModelForTierAndProvider(tier, provider ?? 'claude');
    } catch {
      return null;
    }
  }

  const result: Record<
    string,
    {
      configRoleModel: {
        primary: string;
        fallback: string | null;
        advisor: string | null;
        primaryProvider: Provider | null;
        fallbackProvider: Provider | null;
        advisorProvider: Provider | null;
      } | null;
      dbRoleModel: {
        primaryModel: string | null;
        fallbackModel: string | null;
        advisorModel: string | null;
        primaryProvider: Provider | null;
        fallbackProvider: Provider | null;
        advisorProvider: Provider | null;
        maxTurns: number | null;
        timeoutMs: number | null;
        updatedAt: string | null;
      } | null;
      dbComplexityOverrides: Record<string, string>;
      /** Concrete model ID the dispatcher will use right now for the primary
       *  slot, after merging DB → config → skill default → role default. The
       *  UI renders this as a subtitle under the primary tier select. */
      resolvedPrimary: string | null;
      /** Skill-default tier for the role — what the placeholder text means. */
      roleDefaultTier: Tier;
      /** ROLE_DEFAULTS budgets for this role — used by the UI as "default: N" hints. */
      roleDefaultBudgets: { maxTurns: number; timeoutMs: number };
    }
  > = {};

  const allowHoldoutOverride = project.agentConfig?.allowHoldoutOverride ?? false;

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

    const isHoldout = HOLDOUT_ROLES.has(role);
    const honour = !isHoldout || allowHoldoutOverride;

    let effectiveTier: Tier;
    let effectiveProvider: Provider;
    if (honour && dbRow?.primaryModel != null) {
      effectiveTier = dbRow.primaryModel as Tier;
      effectiveProvider = (dbRow.primaryProvider as Provider | null) ?? 'claude';
    } else if (honour && configEntry?.primary != null) {
      effectiveTier = configEntry.primary as Tier;
      effectiveProvider = (configEntry.primaryProvider as Provider | undefined) ?? 'claude';
    } else {
      effectiveTier = ROLE_DEFAULTS[role].modelTier as Tier;
      effectiveProvider = 'claude';
    }

    result[role] = {
      configRoleModel: configEntry
        ? {
            primary: configEntry.primary,
            fallback: configEntry.fallback,
            advisor: configEntry.advisor,
            primaryProvider: (configEntry.primaryProvider as Provider | undefined) ?? null,
            fallbackProvider: (configEntry.fallbackProvider as Provider | undefined) ?? null,
            advisorProvider: (configEntry.advisorProvider as Provider | undefined) ?? null,
          }
        : null,
      dbRoleModel: dbRow
        ? {
            primaryModel: dbRow.primaryModel ?? null,
            fallbackModel: dbRow.fallbackModel ?? null,
            advisorModel: dbRow.advisorModel ?? null,
            primaryProvider: (dbRow.primaryProvider as Provider | null) ?? null,
            fallbackProvider: (dbRow.fallbackProvider as Provider | null) ?? null,
            advisorProvider: (dbRow.advisorProvider as Provider | null) ?? null,
            maxTurns: dbRow.maxTurns ?? null,
            timeoutMs: dbRow.timeoutMs ?? null,
            updatedAt: dbRow.updatedAt,
          }
        : null,
      dbComplexityOverrides: complexityOverrides,
      resolvedPrimary: resolveModelId(effectiveTier, effectiveProvider),
      roleDefaultTier: ROLE_DEFAULTS[role].modelTier as Tier,
      roleDefaultBudgets: {
        maxTurns: ROLE_DEFAULTS[role].budgets.maxTurns,
        timeoutMs: ROLE_DEFAULTS[role].budgets.timeoutMs,
      },
    };
  }

  return c.json({
    projectId: project.id,
    allowHoldoutOverride: project.agentConfig?.allowHoldoutOverride ?? false,
    roles: result,
  });
});

/**
 * PATCH /projects/:slug/settings/models/bulk — set the primary (tier, provider)
 * for every non-holdout role in one call. Holdout roles (qa, reviewer) are
 * skipped unless `agentConfig.allowHoldoutOverride` is true. Backs the
 * "All → Codex" / "All → Claude" buttons in the Models settings UI.
 * Must be registered before /:role to avoid Hono matching "bulk" as a role name.
 */
router.patch('/:slug/settings/models/bulk', async (c) => {
  const slug = c.req.param('slug');
  const project = await getProject(slug);
  if (project == null) return c.json({ error: 'project not found' }, 404);

  const body = await parseBody<unknown>(c);
  if (!body.ok) return body.error;

  const parsed = BulkRoleModelSchema.safeParse(body.data);
  if (!parsed.success) {
    return c.json({ error: 'invalid body', details: parsed.error.issues }, 422);
  }

  const allowHoldoutOverride = project.agentConfig?.allowHoldoutOverride ?? false;
  const eligibleRoles = (Object.keys(ROLE_DEFAULTS) as string[]).filter(
    (role) =>
      allowHoldoutOverride || !HOLDOUT_ROLES.has(role as Parameters<typeof HOLDOUT_ROLES.has>[0]),
  );

  writeBulkRoleModelPrimary(
    project.id,
    eligibleRoles,
    parsed.data.tier,
    parsed.data.provider,
    'ui',
  );
  return c.json({ ok: true, rolesUpdated: eligibleRoles.length });
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

/** DELETE /projects/:slug/settings/models — remove all DB overrides for every role */
router.delete('/:slug/settings/models', async (c) => {
  const slug = c.req.param('slug');
  const project = await getProject(slug);
  if (project == null) return c.json({ error: 'project not found' }, 404);

  deleteAllRoleModelSettings(project.id);
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

// ─── Review settings (M19.20) ────────────────────────────────────────────────

const ReviewerSlotSchema = z.object({
  model: z.enum(['claude', 'codex']),
  prompt: z.enum(['default', 'unconstrained']),
});

const ReviewPatchSchema = z.object({
  reviewerSlots: z.array(ReviewerSlotSchema).min(1).max(2).nullable(),
});

/** GET /projects/:slug/settings/review — current reviewer slot configuration */
router.get('/:slug/settings/review', async (c) => {
  const slug = c.req.param('slug');
  const project = await getProject(slug);
  if (project == null) return c.json({ error: 'project not found' }, 404);

  const dbRow = readProjectReviewSettings(project.id);
  return c.json({
    projectId: project.id,
    reviewerSlots: parseReviewerSlots(dbRow) ?? null,
    updatedAt: dbRow?.updatedAt ?? null,
    updatedBy: dbRow?.updatedBy ?? null,
  });
});

/** PATCH /projects/:slug/settings/review — upsert reviewer slot configuration */
router.patch('/:slug/settings/review', async (c) => {
  const slug = c.req.param('slug');
  const project = await getProject(slug);
  if (project == null) return c.json({ error: 'project not found' }, 404);

  const body = await parseBody<unknown>(c);
  if (!body.ok) return body.error;

  const parsed = ReviewPatchSchema.safeParse(body.data);
  if (!parsed.success) {
    return c.json({ error: 'invalid body', details: parsed.error.issues }, 422);
  }

  writeProjectReviewSettings(project.id, { reviewerSlots: parsed.data.reviewerSlots }, 'ui');
  return c.json({ ok: true });
});

// ─── Multi-agent pipeline flag (M19.14) ──────────────────────────────────────

const PipelinePatchSchema = z.object({
  useMultiAgentPipeline: z.boolean().optional(),
  useInvestigationSwarm: z.boolean().optional(),
});

/** GET /projects/:slug/settings/pipeline — current pipeline flags */
router.get('/:slug/settings/pipeline', async (c) => {
  const slug = c.req.param('slug');
  const project = await getProject(slug);
  if (project == null) return c.json({ error: 'project not found' }, 404);
  const investigationSwarmConfigDefault = project.investigationSwarm?.enabled ?? true;

  return c.json({
    projectId: project.id,
    useMultiAgentPipeline: getUseMultiAgentPipeline(project.id),
    useInvestigationSwarm: getUseInvestigationSwarm(project.id, investigationSwarmConfigDefault),
    configDefaults: {
      useInvestigationSwarm: investigationSwarmConfigDefault,
    },
  });
});

/** PATCH /projects/:slug/settings/pipeline — toggle pipeline flags */
router.patch('/:slug/settings/pipeline', async (c) => {
  const slug = c.req.param('slug');
  const project = await getProject(slug);
  if (project == null) return c.json({ error: 'project not found' }, 404);

  const body = await parseBody<unknown>(c);
  if (!body.ok) return body.error;

  const parsed = PipelinePatchSchema.safeParse(body.data);
  if (!parsed.success) {
    return c.json({ error: 'invalid body', details: parsed.error.issues }, 422);
  }

  if (parsed.data.useMultiAgentPipeline != null) {
    setUseMultiAgentPipeline(project.id, parsed.data.useMultiAgentPipeline, 'ui');
  }
  if (parsed.data.useInvestigationSwarm != null) {
    setUseInvestigationSwarm(project.id, parsed.data.useInvestigationSwarm, 'ui');
  }
  return c.json({ ok: true });
});

export { router as projectModelRouter };
