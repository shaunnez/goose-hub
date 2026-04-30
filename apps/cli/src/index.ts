#!/usr/bin/env tsx
import 'dotenv/config';
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
    const [work, milestone] = await Promise.all([
      source.listOpenWork(),
      source.getActiveMilestone(),
    ]);
    items = work;
    if (milestone) {
      milestoneLabel = milestone.title;
    }
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

const [, , command, ...args] = process.argv;

switch (command) {
  case 'status':
    await statusCommand(args[0] ?? '');
    break;
  default:
    console.error('Usage: goose <command> [args]');
    console.error('Commands:');
    console.error('  status <project-slug>   Show open issues and their factory states');
    process.exit(1);
}
