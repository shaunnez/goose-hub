import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClaudeCliRuntime } from '@goose-hub/core/agent-runtime/claude-cli.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { logger } from '@goose-hub/core/logger.js';
import { skillsRoot } from '@goose-hub/skills';
import { BugEnhanceOutputSchema } from '@goose-hub/skills/bug-enhance/schema.js';

const jsonSchema = toJsonSchema(BugEnhanceOutputSchema);

function readPrompt(): string {
  return readFileSync(join(skillsRoot, 'bug-enhance', 'prompt.md'), 'utf8');
}

/**
 * Runs the bug-enhance agent on a UI/web bug report.
 * Returns the markdown string to append after the original body, or null on failure.
 */
export async function runBugEnhance(
  projectId: string,
  title: string,
  body: string,
): Promise<string | null> {
  const runtime = new ClaudeCliRuntime();
  const runId = crypto.randomUUID();
  const { personaId } = selectPersona(projectId, 'triager');

  let prompt: string;
  try {
    prompt = readPrompt();
  } catch (err) {
    logger.error('bug-enhance: failed to read prompt', { err: String(err) });
    return null;
  }

  try {
    const result = await runtime.run({
      runId,
      role: 'triager',
      skill: 'bug-enhance',
      context: { workItem: { title, body } },
      contextAllowlist: ['workItem'],
      freshContext: false,
      toolBundles: [],
      toolExtras: [],
      budgets: { maxTurns: 3, maxBudgetUsd: 0.5 },
      personaId,
      outputJsonSchema: jsonSchema,
      appendSystemPrompt: prompt,
    });

    const parsed = BugEnhanceOutputSchema.safeParse(result.output);
    if (!parsed.success) {
      logger.warn('bug-enhance: output validation failed', {
        errors: parsed.error.issues,
      });
      return null;
    }

    const content = parsed.data.enhancedContent.trim();
    return content.length > 0 ? content : null;
  } catch (err) {
    logger.error('bug-enhance: agent run failed', { err: String(err) });
    return null;
  }
}
