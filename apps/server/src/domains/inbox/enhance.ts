import { omitNullObjectProperties } from '@goose-hub/core/agent-runtime/output-normalization.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { selectRuntime } from '@goose-hub/core/agent-runtime/select-runtime.js';
import { resolveSkillRuntimeForProject } from '@goose-hub/core/agent-runtime/skill-runtime-resolver.js';
import { logger } from '@goose-hub/core/logger.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import { BugEnhanceOutputSchema } from '@goose-hub/skills/bug-enhance/schema.js';

const jsonSchema = toJsonSchema(BugEnhanceOutputSchema);

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
  const projectConfig = await getProjectBySlug(projectId);
  const bugEnhanceRuntime = resolveSkillRuntimeForProject({
    skill: 'bug-enhance',
    projectBudgets: projectConfig?.budgets,
    projectId,
    configRuntime: projectConfig?.agentConfig?.runtime ?? 'auto',
    role: 'triager',
    allowHoldoutOverride: projectConfig?.agentConfig?.allowHoldoutOverride,
  });
  const runtime = selectRuntime({
    configRuntime: projectConfig?.agentConfig?.runtime ?? 'auto',
    model: bugEnhanceRuntime.modelOverride,
    skillProvider: bugEnhanceRuntime.provider,
  });
  const runId = crypto.randomUUID();
  const { personaId } = selectPersona(projectId, 'triager');
  const workItemId = `inbox:${inboxItemId}`;

  let prompt: string;
  try {
    prompt = readPromptWithContext('bug-enhance', projectId);
  } catch (err) {
    logger.error('bug-enhance: failed to read prompt', { err: String(err) });
    return null;
  }

  try {
    const result = await runtime.run({
      runId,
      role: 'triager',
      skill: 'bug-enhance',
      context: { projectId, workItemId, workItem: { title, body } },
      contextAllowlist: ['workItem'],
      freshContext: false,
      toolBundles: [],
      toolExtras: [],
      budgets: bugEnhanceRuntime.budgets,
      modelOverride: bugEnhanceRuntime.modelOverride,
      personaId,
      outputJsonSchema: jsonSchema,
      appendSystemPrompt: prompt,
    });

    const parsed = BugEnhanceOutputSchema.safeParse(omitNullObjectProperties(result.output));
    if (!parsed.success) {
      logger.warn('bug-enhance: output validation failed', {
        errors: parsed.error.issues,
        raw: JSON.stringify(result.output),
      });
      return null;
    }

    const content = parsed.data.enhancedContent.trim();
    if (content.length === 0) {
      logger.warn('bug-enhance: enhancedContent empty after trim', {
        runId,
        decisions: parsed.data.decisionSummaries,
      });
    }
    return content.length > 0 ? content : null;
  } catch (err) {
    logger.error('bug-enhance: agent run failed', { err: String(err) });
    return null;
  }
}
