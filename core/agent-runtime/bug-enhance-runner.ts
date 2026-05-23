import {
  BugEnhanceOutputSchema,
  type GroundedHints,
} from '@goose-hub/skills/bug-enhance/schema.js';
import { storeArtifact } from '../agent-artifacts/repository.js';
import { logger } from '../logger.js';
import { getProjectBySlug } from '../projects/loader.js';
import { safeParseOutputForSchema } from './output-normalization.js';
import { readPromptWithContext } from './read-prompt.js';
import { toJsonSchema } from './schema-bridge.js';
import { groundedHintsToSeed } from './scout-prefetch.js';
import { selectPersona } from './select-persona.js';
import { selectRuntime } from './select-runtime.js';
import { resolveSkillRuntimeForProject } from './skill-runtime-resolver.js';

const jsonSchema = toJsonSchema(BugEnhanceOutputSchema);

export interface BugEnhanceResult {
  /** Markdown sections to append after the original bug body, if any. */
  markdown: string | null;
  /** Structured grounding hints the caller can persist as a seed artifact. */
  groundedHints: GroundedHints | null;
}

export interface RunBugEnhanceInput {
  projectId: string;
  /**
   * The work-item id used for event/cost attribution. At inbox promotion the
   * GitHub issue doesn't exist yet, so callers pass `inbox:<inboxItemId>`.
   * At lazy invocation from the investigate workflow, this is the real
   * work-item id.
   */
  workItemId: string;
  title: string;
  body: string;
  /** Optional working directory for tool execution (e.g. worktree path). */
  workspaceDir?: string;
}

/**
 * Runs the bug-enhance agent on a UI/web bug report. Returns the markdown to
 * append plus structured grounded hints (file/component/route candidates)
 * the caller can persist so downstream investigation starts anchored.
 * Returns `{ markdown: null, groundedHints: null }` on failure.
 */
export async function runBugEnhance(input: RunBugEnhanceInput): Promise<BugEnhanceResult> {
  const projectConfig = await getProjectBySlug(input.projectId);
  const bugEnhanceRuntime = resolveSkillRuntimeForProject({
    skill: 'bug-enhance',
    projectBudgets: projectConfig?.budgets,
    projectId: input.projectId,
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
  const { personaId } = selectPersona(input.projectId, 'triager');

  let prompt: string;
  try {
    prompt = readPromptWithContext('bug-enhance', input.projectId);
  } catch (err) {
    logger.error('bug-enhance: failed to read prompt', { err: String(err) });
    return { markdown: null, groundedHints: null };
  }

  try {
    const result = await runtime.run({
      runId,
      role: 'triager',
      skill: 'bug-enhance',
      ...(input.workspaceDir != null ? { workspaceDir: input.workspaceDir } : {}),
      context: {
        projectId: input.projectId,
        workItemId: input.workItemId,
        workItem: { title: input.title, body: input.body },
      },
      contextAllowlist: ['workItem'],
      freshContext: false,
      toolBundles: ['read'],
      toolExtras: [],
      budgets: bugEnhanceRuntime.budgets,
      modelOverride: bugEnhanceRuntime.modelOverride,
      personaId,
      outputJsonSchema: jsonSchema,
      appendSystemPrompt: prompt,
    });

    const parsed = safeParseOutputForSchema(BugEnhanceOutputSchema, result.output);
    if (!parsed.success) {
      logger.warn('bug-enhance: output validation failed', {
        errors: parsed.error.issues,
        raw: JSON.stringify(result.output),
      });
      return { markdown: null, groundedHints: null };
    }

    const content = parsed.data.enhancedContent.trim();
    if (content.length === 0) {
      logger.warn('bug-enhance: enhancedContent empty after trim', {
        runId,
        decisions: parsed.data.decisionSummaries,
      });
    }
    const groundedHints = hasUsableHints(parsed.data.groundedHints)
      ? parsed.data.groundedHints
      : null;
    return {
      markdown: content.length > 0 ? content : null,
      groundedHints: groundedHints ?? null,
    };
  } catch (err) {
    logger.error('bug-enhance: agent run failed', { err: String(err) });
    return { markdown: null, groundedHints: null };
  }
}

function hasUsableHints(hints: GroundedHints | undefined): hints is GroundedHints {
  if (hints == null) return false;
  return (
    hints.candidateFiles.length > 0 ||
    hints.candidateComponents.length > 0 ||
    hints.candidateRoutes.length > 0
  );
}

export interface PersistGroundedSeedInput {
  projectId: string;
  workItemId: string;
  runId: string;
  hints: GroundedHints;
}

/**
 * Persists bug-enhance's grounded hints as an `investigation-seed` artifact
 * keyed under the work-item id. The downstream investigation/dev runs read
 * this artifact via `defaultLoadGroundedSeed` in scout-prefetch so they
 * start anchored to real files instead of brute-search.
 */
export function persistGroundedSeed(input: PersistGroundedSeedInput): void {
  try {
    const seed = groundedHintsToSeed({
      candidateFiles: input.hints.candidateFiles,
      candidateComponents: input.hints.candidateComponents,
    });
    storeArtifact({
      projectId: input.projectId,
      workItemId: input.workItemId,
      runId: input.runId,
      kind: 'investigation-seed',
      artifactKey: `investigation-seed:promotion:${input.workItemId}`,
      summary: `Grounded seed for ${input.workItemId} (bug-enhance)`,
      payload: seed,
    });
  } catch (err) {
    logger.warn('bug-enhance: failed to persist grounded seed', {
      workItemId: input.workItemId,
      err: String(err),
    });
  }
}
