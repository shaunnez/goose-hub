#!/usr/bin/env tsx
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { SKILL_BUDGETS, resolveBudgets } from '@goose-hub/core/agent-runtime/budgets.js';
import { ClaudeCliRuntime } from '@goose-hub/core/agent-runtime/claude-cli.js';
import { assembleSpawnContext } from '@goose-hub/core/agent-runtime/context-assembly.js';
import { withFallback } from '@goose-hub/core/agent-runtime/fallback.js';
import type { AgentSpec } from '@goose-hub/core/agent-runtime/interface.js';
import { validateOutput } from '@goose-hub/core/agent-runtime/output-validator.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { db } from '@goose-hub/core/db/db.js';
import { agentRunCosts } from '@goose-hub/core/db/schema.js';
import { runDescriptionLoop } from '@goose-hub/core/learning/description-loop.js';
import { exportPlaybook } from '@goose-hub/core/learning/playbook-export.js';
import { importPlaybook } from '@goose-hub/core/learning/playbook-import.js';
import { loadProjects } from '@goose-hub/core/projects/loader.js';
import {
  type DepMoveMode,
  type FetchLifecycleFn,
  type SetScheduleFn,
  moveIssueToCurrent,
} from '@goose-hub/core/projects/move-with-deps.js';
import { STATES } from '@goose-hub/core/state-machine/states.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import { GitHubLabelsSource } from '@goose-hub/core/state-source/github-labels.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import { targetProjectsRoot } from '@goose-hub/target-projects';
import { and, eq, gte, lt } from 'drizzle-orm';

async function statusCommand(slug: string): Promise<void> {
  const projects = await loadProjects(targetProjectsRoot);
  const knownSlugs = projects.map((p) => p.slug).join(', ');

  if (!slug) {
    console.error('Usage: goose status <project-slug>');
    console.error(`Known projects: ${knownSlugs}`);
    process.exit(1);
  }

  const config = projects.find((p) => p.slug === slug);
  if (!config) {
    console.error(`Unknown project: ${slug}`);
    console.error(`Known projects: ${knownSlugs}`);
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
  let milestoneNumber: number | null = null;

  try {
    if (config.activeMilestone != null) {
      // Per-project config takes priority over GitHub's default active milestone.
      milestoneLabel = config.activeMilestone;
      const milestones = await source.listMilestones();
      const match = milestones.find((m) => m.title === config.activeMilestone);
      milestoneNumber = match?.number ?? null;
    } else {
      const milestone = await source.getActiveMilestone();
      if (milestone != null) {
        milestoneLabel = milestone.title;
        milestoneNumber = milestone.number;
      }
    }
    items = await source.listOpenWork(milestoneNumber ?? undefined);
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

  // Per-project daily budget usage
  try {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const rows = await db
      .select({
        costUsd: agentRunCosts.costUsd,
        inputTokens: agentRunCosts.inputTokens,
        outputTokens: agentRunCosts.outputTokens,
      })
      .from(agentRunCosts)
      .where(
        and(
          eq(agentRunCosts.projectId, config.id),
          gte(agentRunCosts.createdAt, `${today}T00:00:00Z`),
          lt(agentRunCosts.createdAt, `${tomorrow}T00:00:00Z`),
        ),
      );
    const totalCostUsd = rows.reduce((acc, r) => acc + r.costUsd, 0);
    const totalTokens = rows.reduce((acc, r) => acc + r.inputTokens + r.outputTokens, 0);
    const limitTokens = config.budgets.dailyTokens;
    console.log(
      `\nBudget (today): $${totalCostUsd.toFixed(4)} · ${totalTokens.toLocaleString()} / ${limitTokens.toLocaleString()} tokens${totalTokens >= limitTokens && limitTokens > 0 ? '  ⚠ EXCEEDED' : ''}`,
    );
  } catch {
    // DB may not be initialised in CI or dry-run environments — silently skip
  }
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

  const projects = await loadProjects(targetProjectsRoot);
  const config = projects.find((p) => p.slug === slug);
  if (!config) {
    console.error(`Unknown project: ${slug}`);
    console.error(`Known projects: ${projects.map((p) => p.slug).join(', ')}`);
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

async function taskMoveCommand(rawArgs: string[]): Promise<void> {
  // goose task move <slug> <issue-id> --to=<schedule> [--with-dependencies | --ignore-dependencies]
  const [slug = '', id = '', ...rest] = rawArgs;
  let to = 'current';
  let withDeps: boolean | null = null;

  for (const arg of rest) {
    if (arg.startsWith('--to=')) to = arg.slice('--to='.length);
    else if (arg === '--with-dependencies') withDeps = true;
    else if (arg === '--ignore-dependencies') withDeps = false;
  }

  if (!slug || !id) {
    console.error(
      'Usage: goose task move <project-slug> <issue-id> --to=<schedule> [--with-dependencies | --ignore-dependencies]',
    );
    process.exit(1);
  }

  if (to !== 'current') {
    console.error(`Only --to=current is supported. Got: --to=${to}`);
    process.exit(1);
  }

  const projects = await loadProjects(targetProjectsRoot);
  const config = projects.find((p) => p.slug === slug);
  if (!config) {
    console.error(`Unknown project: ${slug}. Known: ${projects.map((p) => p.slug).join(', ')}`);
    process.exit(1);
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN is required. Set it in .env or the environment.');
    process.exit(1);
  }

  const source = new GitHubLabelsSource(config.id, config.source.repo, token);
  let item: WorkItem;
  try {
    item = await source.getItem(id);
  } catch (err) {
    console.error(`Failed to fetch issue #${id}: ${(err as Error).message}`);
    process.exit(1);
  }

  const hasDeps = item.dependsOn.length > 0;
  if (hasDeps && withDeps === null) {
    console.error(
      `Issue #${id} has dependencies. Choose one:\n  --with-dependencies   Move issue and all open deps\n  --ignore-dependencies Move issue only`,
    );
    process.exit(1);
  }

  const mode: DepMoveMode = withDeps === false ? 'ignore-dependencies' : 'with-dependencies';

  const fetchLifecycle: FetchLifecycleFn = async (repoRef, issueNumber) => {
    const url = `https://api.github.com/repos/${repoRef}/issues/${issueNumber}`;
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (!res.ok) return 'open';
      const json = (await res.json()) as { state: 'open' | 'closed' };
      return json.state;
    } catch {
      return 'open';
    }
  };

  const setSchedule: SetScheduleFn = async (repoRef, issueNumber, schedule) => {
    const depSource = new GitHubLabelsSource(config.id, repoRef, token);
    await depSource.setLabelInGroup(String(issueNumber), 'schedule', schedule);
  };

  let result: Awaited<ReturnType<typeof moveIssueToCurrent>>;
  try {
    result = await moveIssueToCurrent(
      item.body,
      config.source.repo,
      Number(item.externalId),
      mode,
      fetchLifecycle,
      setSchedule,
    );
  } catch (err) {
    console.error(`Move failed: ${(err as Error).message}`);
    process.exit(1);
  }

  console.log(`Moved #${id} to schedule:current.`);
  if (result.depsMoved.length > 0) {
    console.log('\nAlso moved dependencies:');
    for (const dep of result.depsMoved) {
      console.log(`  ${dep.repoRef}#${dep.issueNumber}`);
    }
  }
  if (result.depsSkipped.length > 0) {
    console.log('\nSkipped (closed or ignored):');
    for (const dep of result.depsSkipped) {
      console.log(`  ${dep.repoRef}#${dep.issueNumber} [${dep.lifecycle}]`);
    }
  }
}

async function playbookCommand(subArgs: string[]): Promise<void> {
  const [sub = '', slug = '', ...rest] = subArgs;
  const jsonMode = rest.includes('--json');

  if (sub === 'export') {
    if (!slug) {
      console.error('Usage: goose playbook export <project-slug> [--json]');
      process.exit(1);
    }
    const projects = await loadProjects(targetProjectsRoot);
    const config = projects.find((p) => p.slug === slug);
    if (!config) {
      console.error(`Unknown project: ${slug}. Known: ${projects.map((p) => p.slug).join(', ')}`);
      process.exit(1);
    }
    const manifest = exportPlaybook(config.id, config.name);
    if (jsonMode) {
      process.stdout.write(JSON.stringify(manifest));
    } else {
      process.stdout.write(JSON.stringify(manifest, null, 2));
    }
    process.exit(0);
  }

  if (sub === 'import') {
    if (!slug) {
      console.error('Usage: goose playbook import <project-slug> [--json]');
      process.exit(1);
    }
    const projects = await loadProjects(targetProjectsRoot);
    const config = projects.find((p) => p.slug === slug);
    if (!config) {
      console.error(`Unknown project: ${slug}. Known: ${projects.map((p) => p.slug).join(', ')}`);
      process.exit(1);
    }
    // Read manifest from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      console.error('Invalid JSON on stdin');
      process.exit(1);
    }
    const result = importPlaybook(config.id, manifest);
    if (jsonMode) {
      process.stdout.write(JSON.stringify(result));
    } else {
      if (result.ok) {
        console.log(
          `Imported ${result.decisionPatternsImported} decision patterns, ${result.gateThresholdsImported} gate thresholds.`,
        );
      } else {
        console.error(`Import failed: ${result.reason}`);
        process.exit(1);
      }
    }
    process.exit(0);
  }

  console.error('Usage: goose playbook export|import <project-slug> [--json]');
  process.exit(1);
}

async function skillCommand(subArgs: string[]): Promise<void> {
  const [sub = '', skillName = '', ...rest] = subArgs;
  const jsonMode = rest.includes('--json');

  if (sub === 'triggers') {
    if (!skillName) {
      console.error('Usage: goose skill triggers <skill-name> [--json]');
      process.exit(1);
    }
    const result = runDescriptionLoop(skillName);
    if (jsonMode) {
      process.stdout.write(JSON.stringify(result));
    } else {
      if ('error' in result) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
      const { tpRate, tnRate, accuracy, failures } = result;
      console.log(`Skill: ${skillName}`);
      console.log(`  TP rate:  ${(tpRate * 100).toFixed(1)}%`);
      console.log(`  TN rate:  ${(tnRate * 100).toFixed(1)}%`);
      console.log(`  Accuracy: ${(accuracy * 100).toFixed(1)}%`);
      if (failures.length > 0) {
        console.log(`\nFailures (${failures.length}):`);
        for (const f of failures) {
          console.log(`  [expected: ${f.expected}, got: ${f.actual}] ${f.prompt}`);
        }
      }
      if (accuracy < 0.8) {
        console.error(`\nAccuracy ${(accuracy * 100).toFixed(1)}% is below the 0.8 threshold.`);
        process.exit(1);
      }
    }
    process.exit(0);
  }

  console.error('Usage: goose skill triggers <skill-name> [--json]');
  process.exit(1);
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
  case 'task':
    if (args[0] === 'move') {
      await taskMoveCommand(args.slice(1));
    } else {
      console.error(
        'Usage: goose task move <project-slug> <issue-id> --to=current [--with-dependencies | --ignore-dependencies]',
      );
      process.exit(1);
    }
    break;
  case 'playbook':
    await playbookCommand(args);
    break;
  case 'skill':
    await skillCommand(args);
    break;
  default:
    console.error('Usage: goose <command> [args]');
    console.error('Commands:');
    console.error('  status <project-slug>            Show open issues and their factory states');
    console.error('  sweep <project-slug> <milestone> Archive non-terminal issues in a milestone');
    console.error(
      "  run-agent --skill=<name> --input='<json>' [--project=<slug>] [--dry-run]  Run a skill agent",
    );
    console.error(
      '  task move <project-slug> <issue-id> --to=current [--with-dependencies | --ignore-dependencies]',
    );
    console.error('  playbook export|import <project-slug> [--json]');
    console.error('  skill triggers <skill-name> [--json]');
    process.exit(1);
}
