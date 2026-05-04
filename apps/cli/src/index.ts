#!/usr/bin/env tsx
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { ClaudeCliRuntime } from '@goose-hub/core/agent-runtime/claude-cli.js';
import { assembleSpawnContext } from '@goose-hub/core/agent-runtime/context-assembly.js';
import { withFallback } from '@goose-hub/core/agent-runtime/fallback.js';
import type { AgentSpec } from '@goose-hub/core/agent-runtime/interface.js';
import { validateOutput } from '@goose-hub/core/agent-runtime/output-validator.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { STATES } from '@goose-hub/core/state-machine/states.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import { GitHubLabelsSource } from '@goose-hub/core/state-source/github-labels.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import type { ProjectConfig } from '@goose-hub/core/types.js';
import { skillsRoot } from '@goose-hub/skills';
import gooseHubSelf from '@goose-hub/target-projects/goose-hub-self/project.config.js';

const registry: Record<string, ProjectConfig> = {
  'goose-hub-self': gooseHubSelf,
};

async function statusCommand(slug: string): Promise<void> {
  if (!slug) {
    console.error('Usage: goose status <project-slug>');
    console.error(`Known projects: ${Object.keys(registry).join(', ')}`);
    process.exit(1);
  }

  const config = registry[slug];
  if (!config) {
    console.error(`Unknown project: ${slug}`);
    console.error(`Known projects: ${Object.keys(registry).join(', ')}`);
    process.exit(1);
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN is required. Set it in .env or the environment.');
    process.exit(1);
  }

  const source = new GitHubLabelsSource(config.id, config.source.repo, token);

  let items: WorkItem[];
  let milestoneLabel: string | null = null;

  try {
    const milestone = await source.getActiveMilestone();
    if (milestone != null) {
      milestoneLabel = milestone.title;
    }
    items =
      milestone != null && !milestone.isActive
        ? await source.listClosedWorkByMilestone(milestone.number)
        : await source.listOpenWork();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  console.log(`${config.name} (${config.source.repo})`);
  if (milestoneLabel) {
    console.log(`Active milestone: ${milestoneLabel}`);
  }
  console.log('─'.repeat(70));

  const byState = new Map<StateName, WorkItem[]>();
  for (const item of items) {
    const group = byState.get(item.state) ?? [];
    group.push(item);
    byState.set(item.state, group);
  }

  for (const state of STATES) {
    const group = byState.get(state);
    if (!group || group.length === 0) continue;
    console.log(`\n  ${state} (${group.length})`);
    for (const item of group) {
      const num = `#${item.externalId}`.padStart(5);
      const title = item.title.slice(0, 55);
      console.log(`     ${num}  ${title}`);
    }
  }

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`Total: ${items.length} open issue${items.length !== 1 ? 's' : ''}`);
}

const TERMINAL_STATES = new Set<string>(['factory:done', 'factory:archived', 'factory:rejected']);

async function sweepCommand(slug: string, milestoneArg: string): Promise<void> {
  if (!slug || !milestoneArg) {
    console.error('Usage: goose sweep <project-slug> <milestone-number>');
    process.exit(1);
  }

  const milestoneNumber = Number(milestoneArg);
  if (Number.isNaN(milestoneNumber)) {
    console.error(`Invalid milestone number: ${milestoneArg}`);
    process.exit(1);
  }

  const config = registry[slug];
  if (!config) {
    console.error(`Unknown project: ${slug}`);
    console.error(`Known projects: ${Object.keys(registry).join(', ')}`);
    process.exit(1);
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN is required. Set it in .env or the environment.');
    process.exit(1);
  }

  const source = new GitHubLabelsSource(config.id, config.source.repo, token);

  let allOpen: WorkItem[];
  try {
    allOpen = await source.listOpenWork();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const inMilestone = allOpen.filter((i) => i.milestoneId === String(milestoneNumber));
  const nonTerminal = inMilestone.filter((i) => !TERMINAL_STATES.has(i.state));

  if (nonTerminal.length === 0) {
    console.log(`All issues in milestone #${milestoneNumber} are already in a terminal state.`);
    process.exit(0);
  }

  console.log(`\nNon-terminal issues in milestone #${milestoneNumber}:\n`);
  for (const item of nonTerminal) {
    const num = `#${item.externalId}`.padStart(5);
    const state = item.state.padEnd(30);
    console.log(`  ${num}  ${state}  ${item.title.slice(0, 45)}`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(
      `\nArchive all ${nonTerminal.length} issue${nonTerminal.length === 1 ? '' : 's'}? [y/N] `,
      resolve,
    );
  });
  rl.close();

  if (answer.toLowerCase() !== 'y') {
    console.log('Aborted.');
    process.exit(0);
  }

  let failed = 0;
  for (const item of nonTerminal) {
    try {
      await source.forceState(item.id, 'factory:archived');
      console.log(`  #${item.externalId}: archived`);
    } catch (err) {
      console.error(`  #${item.externalId}: failed — ${(err as Error).message}`);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} issue${failed === 1 ? '' : 's'} failed. Re-run to retry.`);
    process.exit(1);
  }

  console.log(
    `\nDone. ${nonTerminal.length} issue${nonTerminal.length === 1 ? '' : 's'} archived.`,
  );
}

async function runAgentCommand(rawArgs: string[]): Promise<void> {
  // Parse --skill=<name> --input='<json>' [--dry-run]
  let skillName: string | null = null;
  let inputJson: string | null = null;
  let dryRun = false;

  for (const arg of rawArgs) {
    if (arg.startsWith('--skill=')) skillName = arg.slice('--skill='.length);
    else if (arg.startsWith('--input=')) inputJson = arg.slice('--input='.length);
    else if (arg === '--dry-run') dryRun = true;
  }

  if (!skillName || !inputJson) {
    console.error("Usage: goose run-agent --skill=<name> --input='<json>' [--dry-run]");
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

  // Load skill's prompt.md as system prompt (CONTEXT.md: --append-system-prompt channel)
  let appendSystemPrompt: string | undefined;
  try {
    appendSystemPrompt = readFileSync(
      pathToFileURL(path.join(skillsRoot, skillName, 'prompt.md')),
      'utf8',
    );
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
    budgets: { maxTurns: 10, maxBudgetUsd: 1.0 },
    // CLI runs don't use persona routing — use a placeholder persona ID
    personaId: `cli/${skillConfig.role ?? 'developer'}/0`,
    modelOverride: undefined,
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

  const runtime = withFallback(new ClaudeCliRuntime(), { allowDownTier: true, maxAttempts: 2 });

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

const [, , command, ...args] = process.argv;

switch (command) {
  case 'status':
    await statusCommand(args[0] ?? '');
    break;
  case 'sweep':
    await sweepCommand(args[0] ?? '', args[1] ?? '');
    break;
  case 'run-agent':
    await runAgentCommand(args);
    break;
  default:
    console.error('Usage: goose <command> [args]');
    console.error('Commands:');
    console.error('  status <project-slug>            Show open issues and their factory states');
    console.error('  sweep <project-slug> <milestone> Archive non-terminal issues in a milestone');
    console.error("  run-agent --skill=<name> --input='<json>' [--dry-run]  Run a skill agent");
    process.exit(1);
}
