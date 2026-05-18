import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SKILL_BUDGETS } from '@goose-hub/core/agent-runtime/budgets.js';
import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { deriveSkillRuntimeResponse } from '@goose-hub/core/agent-runtime/skill-runtime-resolver.js';
import {
  readProjectDevReviewSettings,
  writeProjectDevReviewSettings,
} from '@goose-hub/core/db/repositories/project-dev-review-settings.js';
import {
  parseReviewerSlots,
  readProjectReviewSettings,
  writeProjectReviewSettings,
} from '@goose-hub/core/db/repositories/project-review-settings.js';
import {
  deleteProjectSkillSetting,
  getUseInvestigationSwarm,
  getUseMultiAgentPipeline,
  readProjectSettings,
  readProjectSkillSettings,
  resetAllProjectBudgets,
  setUseInvestigationSwarm,
  setUseMultiAgentPipeline,
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

const ReviewerSlotSchema = z.object({
  model: z.enum(['claude', 'codex']),
  prompt: z.enum(['default', 'unconstrained']),
});

const ReviewPatchSchema = z.object({
  reviewerSlots: z.array(ReviewerSlotSchema).min(1).max(2).nullable(),
});

const PipelinePatchSchema = z.object({
  useMultiAgentPipeline: z.boolean().optional(),
  useInvestigationSwarm: z.boolean().optional(),
});

const SKILL_CALLERS: Record<string, string[]> = {
  triage: ['triage-batch workflow', 'fake-run/debug route'],
  'repo-match': ['triage-batch workflow'],
  'bug-enhance': ['inbox promotion'],
  'evidence-post': ['post-QA evidence workflow'],
  implement: ['standard implementation workflow', 'repair loop'],
  qa: ['post-implementation QA gate'],
  review: ['final review gate'],
  'resolve-conflict': ['conflict resolution workflow'],
  investigate: ['bug investigation workflow', 'fake-run/debug route'],
  'playwright-repro': ['bug evidence workflow'],
  'advise-on-plan': ['advisor gate'],
  'spec-author': ['parallel implementation workflow'],
  'retrospective-light': ['post-merge retrospective workflow'],
  'retrospective-deep': ['post-merge retrospective workflow'],
  'retrospective-cross-run': ['cross-run retrospective workflow'],
  'skill-coach': ['cross-run retrospective workflow'],
  'grill-me': ['grill-and-prd workflow'],
  'write-prd': ['grill-and-prd workflow'],
  'advise-on-prd': ['grill-and-prd workflow'],
  'decompose-issues': ['PRD decomposition workflow'],
  'sprint-review': ['milestone completion workflow'],
  'scout-schema': ['investigation scout wave'],
  'scout-code-path': ['investigation scout wave'],
  'scout-pattern': ['investigation scout wave'],
  'scout-test-inventory': ['investigation scout wave'],
  'scout-dependency': ['investigation scout wave'],
  'scout-user-journey': ['investigation scout wave'],
  'wave2-interface-designer': ['investigation synthesis wave'],
  'wave2-risk-analyst': ['investigation synthesis wave'],
  'dev-review': ['developer pre-QA advisor'],
  'dev-review-response': ['developer pre-QA advisor'],
  'implement-wp': ['parallel implementation workflow'],
  'code-quality-audit': ['architecture audit workflow'],
};

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

function cleanMarkdownText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function loadSkillDescription(skill: string): Promise<string | null> {
  try {
    const readme = await readFile(join(skillsRoot, skill, 'README.md'), 'utf8');
    const paragraphs = readme
      .split(/\n\s*\n/)
      .map((paragraph) => cleanMarkdownText(paragraph))
      .filter(
        (paragraph) =>
          paragraph !== '' &&
          paragraph !== skill &&
          paragraph !== `${skill} skill` &&
          paragraph !== `skills/${skill}` &&
          paragraph !== `skill: ${skill}`,
      );
    const description = paragraphs.find(
      (paragraph) =>
        !paragraph.startsWith('File | Purpose') &&
        !paragraph.startsWith('When this skill runs') &&
        !paragraph.startsWith('When it runs') &&
        !paragraph.startsWith('Inputs') &&
        !paragraph.startsWith('Role'),
    );
    if (description == null) return null;
    return description.length > 220 ? `${description.slice(0, 217).trimEnd()}...` : description;
  } catch {
    return null;
  }
}

async function loadSkillRuntimeHint(skill: string): Promise<{
  role?: Role;
  modelTier?: ModelTier;
  provider?: ModelProvider;
  dependencies: string[];
  callers: string[];
  description: string | null;
}> {
  try {
    const configPath = join(skillsRoot, skill, 'skill.config.ts');
    // Cross-package boundary at runtime path: skill configs live in @goose-hub/skills.
    const mod = (await import(pathToFileURL(configPath).href)) as { default?: unknown };
    if (mod.default == null || typeof mod.default !== 'object') {
      return {
        dependencies: [],
        callers: SKILL_CALLERS[skill] ?? [],
        description: await loadSkillDescription(skill),
      };
    }
    const config = mod.default as Partial<SkillConfig>;
    return {
      role: config.role,
      modelTier: config.modelPin,
      provider: config.provider,
      dependencies: config.contextAllowlist ?? [],
      callers: SKILL_CALLERS[skill] ?? [],
      description: await loadSkillDescription(skill),
    };
  } catch {
    return {
      dependencies: [],
      callers: SKILL_CALLERS[skill] ?? [],
      description: await loadSkillDescription(skill),
    };
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
  const skillMetadata: Record<
    string,
    {
      description: string | null;
      dependencies: string[];
      callers: string[];
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
    skillMetadata[skill] = {
      description: hint?.description ?? null,
      dependencies: hint?.dependencies ?? [],
      callers: hint?.callers ?? [],
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
    skillMetadata,
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

/**
 * GET /projects/:slug/settings/codex-auth — read-only Codex CLI auth presence check.
 * Status is per-machine, but it lives beside skill runtime settings because Codex is
 * selected per skill through the provider field.
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

export { router as projectSettingsRouter };
