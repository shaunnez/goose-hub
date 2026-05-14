import { randomUUID } from 'node:crypto';
import { SKILL_BUDGETS, resolveBudgets } from '@goose-hub/core/agent-runtime/budgets.js';
import { assembleSpawnContext } from '@goose-hub/core/agent-runtime/context-assembly.js';
import { withFallback } from '@goose-hub/core/agent-runtime/fallback.js';
import type { AgentSpec } from '@goose-hub/core/agent-runtime/interface.js';
import { validateOutput } from '@goose-hub/core/agent-runtime/output-validator.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectRuntime } from '@goose-hub/core/agent-runtime/select-runtime.js';

export async function runAgentCommand(rawArgs: string[]): Promise<void> {
  // Parse --skill=<name> --input='<json>' [--project=<slug>] [--dry-run]
  let skillName: string | null = null;
  let inputJson: string | null = null;
  let projectSlug = '';
  let dryRun = false;

  for (const arg of rawArgs) {
    if (arg.startsWith('--skill=')) skillName = arg.slice('--skill='.length);
    else if (arg.startsWith('--input=')) inputJson = arg.slice('--input='.length);
    else if (arg.startsWith('--project=')) projectSlug = arg.slice('--project='.length);
    else if (arg === '--dry-run') dryRun = true;
  }

  if (!skillName || !inputJson) {
    console.error(
      "Usage: goose run-agent --skill=<name> --input='<json>' [--project=<slug>] [--dry-run]",
    );
    process.exit(1);
  }

  // Dynamic import of skill config
  let skillModule: { default: import('@goose-hub/core/agent-runtime/interface.js').SkillConfig };
  try {
    skillModule = await import(`@goose-hub/skills/${skillName}/skill.config.js`);
  } catch {
    console.error(`Skill '${skillName}' not found at skills/${skillName}/skill.config.js`);
    process.exit(1);
  }

  const skillConfig = skillModule.default;

  let inputData: Record<string, unknown>;
  try {
    inputData = JSON.parse(inputJson) as Record<string, unknown>;
  } catch {
    console.error('--input must be valid JSON');
    process.exit(1);
  }

  // Validate input against skill's context schema
  const contextResult = skillConfig.contextSchema.safeParse(inputData);
  if (!contextResult.success) {
    console.error('Input does not match skill context schema:');
    console.error(
      JSON.stringify((contextResult as { success: false; error: unknown }).error, null, 2),
    );
    process.exit(1);
  }

  // Load skill's prompt.md (with optional project overlay) as system prompt
  // (CONTEXT.md: --append-system-prompt channel). When --project is omitted,
  // an empty slug is passed and the overlay path won't exist, so just the
  // base prompt is returned.
  let appendSystemPrompt: string | undefined;
  try {
    appendSystemPrompt = readPromptWithContext(skillName, projectSlug);
  } catch {
    // no prompt.md — skill runs without system prompt
  }

  const runId = randomUUID();
  const spec: AgentSpec = {
    runId,
    role: skillConfig.role ?? 'developer',
    skill: skillName,
    context: inputData,
    contextAllowlist: skillConfig.contextAllowlist ?? Object.keys(inputData),
    freshContext: skillConfig.freshContext,
    toolBundles: skillConfig.toolBundles,
    toolExtras: [],
    // Use skill budget if registered; fall back to a safe generic default for ad-hoc CLI runs.
    ...(skillName in SKILL_BUDGETS
      ? resolveBudgets(skillName)
      : {
          budgets: { maxTurns: 10, maxBudgetUsd: 1.0, timeoutMs: 120_000 },
          modelOverride: undefined,
        }),
    // CLI runs don't use persona routing — use a placeholder persona ID
    personaId: `cli/${skillConfig.role ?? 'developer'}/0`,
    appendSystemPrompt,
  };

  if (dryRun) {
    console.log('--- Assembled AgentSpec (dry-run, no spawn) ---');
    const { contextXml } = assembleSpawnContext(spec);
    console.log(JSON.stringify({ ...spec, contextXml }, null, 2));
    process.exit(0);
  }

  // Load skill output schema
  let schemaModule: { default?: unknown; [key: string]: unknown };
  try {
    schemaModule = await import(`@goose-hub/skills/${skillName}/schema.js`);
  } catch {
    schemaModule = {};
  }

  // Find the last ZodType export (outermost output schema is always last).
  // 'default' export takes precedence if present.
  const isZodType = (v: unknown): v is import('zod').ZodType =>
    v != null && typeof (v as Record<string, unknown>).safeParse === 'function';
  const outputSchema =
    (isZodType(schemaModule.default) ? schemaModule.default : null) ??
    [...Object.values(schemaModule)].reverse().find(isZodType) ??
    null;

  if (outputSchema != null) {
    spec.outputJsonSchema = toJsonSchema(outputSchema);
  }

  const runtime = withFallback(
    selectRuntime({
      configRuntime: 'auto',
      model: spec.modelOverride,
      skillProvider: skillConfig.provider,
    }),
    { allowDownTier: true, maxAttempts: 2 },
  );

  let result: import('@goose-hub/core/agent-runtime/interface.js').AgentResult;
  try {
    result = await runtime.run(spec);
  } catch (err) {
    console.error('Agent run failed:', (err as Error).message);
    process.exit(1);
  }

  // Validate output if we have a schema
  if (outputSchema != null) {
    try {
      validateOutput(JSON.stringify(result.output), outputSchema);
    } catch (err) {
      console.error('Output validation failed:', (err as Error).message);
      process.exit(1);
    }
  }

  console.log(JSON.stringify(result.output, null, 2));
  process.exit(0);
}
