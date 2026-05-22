import { safeParseOutputForSchema } from '@goose-hub/core/agent-runtime/output-normalization.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { selectRuntime } from '@goose-hub/core/agent-runtime/select-runtime.js';
import { resolveSkillRuntimeForProject } from '@goose-hub/core/agent-runtime/skill-runtime-resolver.js';
import { logger } from '@goose-hub/core/logger.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import { BugEnhanceOutputSchema } from '@goose-hub/skills/bug-enhance/schema.js';

const jsonSchema = toJsonSchema(BugEnhanceOutputSchema);
export const SUPPORTED_PROMOTION_TYPES = ['feature', 'bug', 'chore', 'research'] as const;

export type PromotionType = (typeof SUPPORTED_PROMOTION_TYPES)[number];

type EnhanceSkillName = 'bug-enhance' | 'idea-promotion-enhance';

const ENHANCE_SKILL_BY_TYPE: Record<PromotionType, EnhanceSkillName> = {
  bug: 'bug-enhance',
  feature: 'idea-promotion-enhance',
  chore: 'idea-promotion-enhance',
  research: 'idea-promotion-enhance',
};

/**
 * Runs the bug-enhance agent on a UI/web bug report.
 * Returns the markdown string to append after the original body, or null on failure.
 *
 * inboxItemId is the local DB id of the inbox item. Because the GitHub issue doesn't
 * exist yet at promotion time, it is used as "inbox:<id>" for cost/event attribution.
 */
export async function runBugEnhance(
  projectId: string,
  inboxItemId: number,
  title: string,
  body: string,
): Promise<string | null> {
  return runEnhanceSkill({ projectId, inboxItemId, promotionType: 'bug', title, body });
}

export function isSupportedPromotionType(type: string | null | undefined): type is PromotionType {
  return SUPPORTED_PROMOTION_TYPES.includes(type as PromotionType);
}

export async function runPromotionEnhance(
  projectId: string,
  inboxItemId: number,
  promotionType: PromotionType,
  title: string,
  body: string,
): Promise<string | null> {
  return runEnhanceSkill({ projectId, inboxItemId, promotionType, title, body });
}

async function runEnhanceSkill({
  projectId,
  inboxItemId,
  promotionType,
  title,
  body,
}: {
  projectId: string;
  inboxItemId: number;
  promotionType: PromotionType;
  title: string;
  body: string;
}): Promise<string | null> {
  const skill = ENHANCE_SKILL_BY_TYPE[promotionType];
  const projectConfig = await getProjectBySlug(projectId);
  const enhanceRuntime = resolveSkillRuntimeForProject({
    skill,
    projectBudgets: projectConfig?.budgets,
    projectId,
    configRuntime: projectConfig?.agentConfig?.runtime ?? 'auto',
    role: 'triager',
    allowHoldoutOverride: projectConfig?.agentConfig?.allowHoldoutOverride,
  });
  const runtime = selectRuntime({
    configRuntime: projectConfig?.agentConfig?.runtime ?? 'auto',
    model: enhanceRuntime.modelOverride,
    skillProvider: enhanceRuntime.provider,
  });
  const runId = crypto.randomUUID();
  const { personaId } = selectPersona(projectId, 'triager');
  const workItemId = `inbox:${inboxItemId}`;

  let prompt: string;
  try {
    prompt = readPromptWithContext(skill, projectId);
  } catch (err) {
    logger.error('promotion-enhance: failed to read prompt', { err: String(err), promotionType });
    return null;
  }

  try {
    const result = await runtime.run({
      runId,
      role: 'triager',
      skill,
      context: { projectId, workItemId, workItem: { title, body, type: promotionType } },
      contextAllowlist: ['workItem'],
      freshContext: false,
      toolBundles: [],
      toolExtras: [],
      budgets: enhanceRuntime.budgets,
      modelOverride: enhanceRuntime.modelOverride,
      personaId,
      outputJsonSchema: jsonSchema,
      appendSystemPrompt: prompt,
    });

    const parsed = safeParseOutputForSchema(BugEnhanceOutputSchema, result.output);
    if (!parsed.success) {
      logger.warn('promotion-enhance: output validation failed', {
        errors: parsed.error.issues,
        raw: JSON.stringify(result.output),
        promotionType,
      });
      return null;
    }

    const content = parsed.data.enhancedContent.trim();
    if (content.length === 0) {
      logger.warn('promotion-enhance: enhancedContent empty after trim', {
        runId,
        promotionType,
        decisions: parsed.data.decisionSummaries,
      });
    }
    return content.length > 0 ? content : null;
  } catch (err) {
    logger.error('promotion-enhance: agent run failed', { err: String(err), promotionType });
    return null;
  }
}
