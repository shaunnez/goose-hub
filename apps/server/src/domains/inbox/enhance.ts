import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { selectRuntime } from '@goose-hub/core/agent-runtime/select-runtime.js';
import { resolveSkillRuntimeForProject } from '@goose-hub/core/agent-runtime/skill-runtime-resolver.js';
import { logger } from '@goose-hub/core/logger.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import { BugEnhanceOutputSchema } from '@goose-hub/skills/bug-enhance/schema.js';
import { IssueEnhanceOutputSchema } from '@goose-hub/skills/issue-enhance/schema.js';

const bugEnhanceJsonSchema = toJsonSchema(BugEnhanceOutputSchema);
const issueEnhanceJsonSchema = toJsonSchema(IssueEnhanceOutputSchema);

type EnhancableInboxItemType = 'feature' | 'bug' | 'chore' | 'research';
type GenericEnhanceType = Exclude<EnhancableInboxItemType, 'bug'>;
type EnhanceSkillName = 'bug-enhance' | 'issue-enhance';

type EnhanceOutput = {
  enhancedContent: string;
  decisionSummaries: unknown[];
};

type EnhanceOptions = {
  skill: EnhanceSkillName;
  projectId: string;
  inboxItemId: number;
  title: string;
  body: string;
  type?: GenericEnhanceType;
  outputJsonSchema: object;
  parseOutput: (
    output: unknown,
  ) => { success: true; data: EnhanceOutput } | { success: false; error: { issues: unknown } };
};

async function runEnhance({
  skill,
  projectId,
  inboxItemId,
  title,
  body,
  type,
  outputJsonSchema,
  parseOutput,
}: EnhanceOptions): Promise<string | null> {
  const projectConfig = await getProjectBySlug(projectId);
  const skillRuntime = resolveSkillRuntimeForProject({
    skill,
    projectBudgets: projectConfig?.budgets,
    projectId,
    configRuntime: projectConfig?.agentConfig?.runtime ?? 'auto',
    role: 'triager',
    allowHoldoutOverride: projectConfig?.agentConfig?.allowHoldoutOverride,
  });
  const runtime = selectRuntime({
    configRuntime: projectConfig?.agentConfig?.runtime ?? 'auto',
    model: skillRuntime.modelOverride,
    skillProvider: skillRuntime.provider,
  });
  const runId = crypto.randomUUID();
  const { personaId } = selectPersona(projectId, 'triager');
  const workItemId = `inbox:${inboxItemId}`;

  let prompt: string;
  try {
    prompt = readPromptWithContext(skill, projectId);
  } catch (err) {
    logger.error(`${skill}: failed to read prompt`, { err: String(err) });
    return null;
  }

  const workItem = type == null ? { title, body } : { type, title, body };

  try {
    const result = await runtime.run({
      runId,
      role: 'triager',
      skill,
      context: { projectId, workItemId, workItem },
      contextAllowlist: ['workItem'],
      freshContext: false,
      toolBundles: [],
      toolExtras: [],
      budgets: skillRuntime.budgets,
      modelOverride: skillRuntime.modelOverride,
      personaId,
      outputJsonSchema,
      appendSystemPrompt: prompt,
    });

    const parsed = parseOutput(result.output);
    if (!parsed.success) {
      logger.warn(`${skill}: output validation failed`, {
        errors: parsed.error.issues,
        raw: JSON.stringify(result.output),
      });
      return null;
    }

    const content = parsed.data.enhancedContent.trim();
    if (content.length === 0) {
      logger.warn(`${skill}: enhancedContent empty after trim`, {
        runId,
        decisions: parsed.data.decisionSummaries,
      });
    }
    return content.length > 0 ? content : null;
  } catch (err) {
    logger.error(`${skill}: agent run failed`, { err: String(err) });
    return null;
  }
}

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
  return runEnhance({
    skill: 'bug-enhance',
    projectId,
    inboxItemId,
    title,
    body,
    outputJsonSchema: bugEnhanceJsonSchema,
    parseOutput: (output) => BugEnhanceOutputSchema.safeParse(output),
  });
}

export async function runIssueEnhance(
  projectId: string,
  inboxItemId: number,
  type: GenericEnhanceType,
  title: string,
  body: string,
): Promise<string | null> {
  return runEnhance({
    skill: 'issue-enhance',
    projectId,
    inboxItemId,
    type,
    title,
    body,
    outputJsonSchema: issueEnhanceJsonSchema,
    parseOutput: (output) => IssueEnhanceOutputSchema.safeParse(output),
  });
}

export async function runInboxEnhance(
  projectId: string,
  inboxItemId: number,
  type: EnhancableInboxItemType,
  title: string,
  body: string,
): Promise<string | null> {
  if (type === 'bug') {
    return runBugEnhance(projectId, inboxItemId, title, body);
  }

  return runIssueEnhance(projectId, inboxItemId, type, title, body);
}
