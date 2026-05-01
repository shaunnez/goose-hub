#!/usr/bin/env tsx
import 'dotenv/config';
import { createInterface } from 'node:readline';
import { STATES } from '@goose-hub/core/state-machine/states.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import { GitHubLabelsSource } from '@goose-hub/core/state-source/github-labels.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import type { ProjectConfig } from '@goose-hub/core/types.js';
import gooseHubSelf from '../../../target-projects/goose-hub-self/project.config.js';

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
        ? await source.listClosedWork(milestone.number)
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

const [, , command, ...args] = process.argv;

switch (command) {
  case 'status':
    await statusCommand(args[0] ?? '');
    break;
  case 'sweep':
    await sweepCommand(args[0] ?? '', args[1] ?? '');
    break;
  default:
    console.error('Usage: goose <command> [args]');
    console.error('Commands:');
    console.error('  status <project-slug>            Show open issues and their factory states');
    console.error('  sweep <project-slug> <milestone> Archive non-terminal issues in a milestone');
    process.exit(1);
}
