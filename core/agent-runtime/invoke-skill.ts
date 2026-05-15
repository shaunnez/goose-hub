import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { skillsRoot } from '@goose-hub/skills';
import { getProjectBySlug } from '../projects/loader.js';
import type { ProjectConfig } from '../types.js';
import type { ResolvedBudget } from './budgets.js';
import type { AgentResult, AgentRuntime, SkillConfig } from './interface.js';
import { readPromptWithContext } from './read-prompt.js';
import { toJsonSchema } from './schema-bridge.js';
import { selectPersona } from './select-persona.js';
import { selectRuntime } from './select-runtime.js';
import { resolveSkillRuntimeForProject } from './skill-runtime-resolver.js';

export class ContextValidationError extends Error {
  issues: Array<{ path: Array<string | number>; message: string }>;

  constructor(issues: Array<{ path: Array<string | number>; message: string }>, skillName: string) {
    super(`invokeSkill: context validation failed for '${skillName}'`);
    this.name = 'ContextValidationError';
    this.issues = issues;
  }
}

export class OutputValidationError extends Error {
  issues: Array<{ path: Array<string | number>; message: string }>;
  runTelemetry: { runId: string; skill: string };

  constructor(
    issues: Array<{ path: Array<string | number>; message: string }>,
    skillName: string,
    runId: string,
  ) {
    super(`invokeSkill: output validation failed for '${skillName}'`);
    this.name = 'OutputValidationError';
    this.issues = issues;
    this.runTelemetry = { runId, skill: skillName };
  }
}

export type InvokeSkillInput = {
  skillName: string;
  projectId: string;
  workItemId?: string;
  runId: string;
  context: Record<string, unknown>;
  overrides?: {
    modelOverride?: string;
    workspaceDir?: string;
    /** Merged into context after schema validation. Allows revision-pass feedback injection. */
    appendContext?: Record<string, unknown>;
    extraEventPayload?: Record<string, unknown>;
    /** Test seam: bypasses selectRuntime when provided. */
    runtimeOverride?: AgentRuntime;
    /** Pre-resolved project config. When provided, skips getProjectBySlug disk read. */
    projectConfigOverride?: Partial<ProjectConfig> | null;
    /** Caller-supplied freshContext flag. When provided, overrides the skill config value. */
    freshContextOverride?: boolean;
  };
};

/**
 * Canonical entry point for skill-driven agent spawns. Handles the full
 * composer pipeline: config load → context validation → prompt load →
 * persona selection → budget resolution → model resolution → runtime
 * selection → spec assembly → spawn → output validation.
 *
 * Throws ContextValidationError before spawn if context fails the skill's
 * contextSchema. Throws OutputValidationError post-spawn if output fails
 * the skill's outputSchema (when declared).
 *
 * See ADR 0038.
 */
export async function invokeSkill(input: InvokeSkillInput): Promise<AgentResult> {
  const { skillName, projectId, workItemId, runId, context, overrides } = input;

  // 1. Load skill config — absolute path import matches loader.ts pattern (tsx-safe)
  const configPath = join(skillsRoot, skillName, 'skill.config.ts');
  const mod = (await import(pathToFileURL(configPath).href)) as { default?: unknown };
  if (mod.default == null || typeof mod.default !== 'object') {
    throw new Error(`invokeSkill: skill '${skillName}' config has no valid default export`);
  }
  const skillConfig = mod.default as SkillConfig;

  // 2. Validate context against skill's declared contextSchema (pre-spawn gate)
  const ctxResult = skillConfig.contextSchema.safeParse(context);
  if (!ctxResult.success) {
    throw new ContextValidationError(
      ctxResult.error.issues.map((i) => ({
        path: i.path as Array<string | number>,
        message: i.message,
      })),
      skillName,
    );
  }

  // 3. Load prompt with optional project-specific overlay
  const appendSystemPrompt = readPromptWithContext(skillName, projectId);

  // 4. Select persona (round-robin within projectId + role)
  const role = skillConfig.role ?? 'developer';
  const { personaId } = selectPersona(projectId, role);

  // 5. Resolve budgets — fall back for skills not yet in SKILL_BUDGETS
  const projectConfig =
    overrides?.projectConfigOverride !== undefined
      ? overrides.projectConfigOverride
      : await getProjectBySlug(projectId);
  const resolved: ResolvedBudget = resolveSkillRuntimeForProject({
    skill: skillName,
    projectBudgets: projectConfig?.budgets,
    projectId,
    configRuntime: projectConfig?.agentConfig?.runtime ?? 'auto',
    skillProvider: skillConfig.provider,
    fallbackTier: skillConfig.modelPin,
    fallbackProvider: skillConfig.provider,
    callerModelOverride: overrides?.modelOverride,
    role,
    allowHoldoutOverride: projectConfig?.agentConfig?.allowHoldoutOverride,
    ignoreProviderOverride: overrides?.runtimeOverride != null && overrides?.modelOverride == null,
  });
  const modelOverride = resolved.modelOverride;

  // 7. Select runtime — runtimeOverride short-circuits for tests and bespoke callers
  const runtime =
    overrides?.runtimeOverride ??
    selectRuntime({
      configRuntime: projectConfig?.agentConfig?.runtime ?? 'auto',
      model: modelOverride,
      skillProvider: skillConfig.provider,
    });

  // 8. Build output JSON schema when available
  const outputJsonSchema = skillConfig.outputSchema
    ? (toJsonSchema(skillConfig.outputSchema) as Record<string, unknown>)
    : undefined;

  // 9. Assemble AgentSpec — contextAllowlist read directly from skillConfig (required)
  const mergedContext: Record<string, unknown> = {
    ...context,
    ...overrides?.appendContext,
    projectId,
    ...(workItemId != null && { workItemId }),
  };

  // 10. Spawn
  const result = await runtime.run({
    runId,
    role,
    skill: skillName,
    context: mergedContext,
    contextAllowlist: skillConfig.contextAllowlist,
    freshContext: overrides?.freshContextOverride ?? skillConfig.freshContext,
    toolBundles: skillConfig.toolBundles,
    toolExtras: [],
    budgets: resolved.budgets,
    personaId,
    workItemId,
    modelOverride,
    outputJsonSchema,
    appendSystemPrompt,
    workspaceDir: overrides?.workspaceDir,
    extraEventPayload: overrides?.extraEventPayload,
  });

  // 11. Validate output when skill declares an outputSchema
  if (skillConfig.outputSchema != null) {
    const outResult = skillConfig.outputSchema.safeParse(result.output);
    if (!outResult.success) {
      throw new OutputValidationError(
        outResult.error.issues.map((i) => ({
          path: i.path as Array<string | number>,
          message: i.message,
        })),
        skillName,
        runId,
      );
    }
  }

  return result;
}
