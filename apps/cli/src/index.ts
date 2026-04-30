#!/usr/bin/env tsx
import 'dotenv/config';
import { STATES } from '../../../core/state-machine/states.js';
import type { ProjectConfig } from '../../../core/types.js';
import gooseHubSelf from '../../../target-projects/goose-hub-self/project.config.js';
import { groupIssues, resolveState } from './lib.js';
import type { GHIssue } from './lib.js';

const registry: Record<string, ProjectConfig> = {
  'goose-hub-self': gooseHubSelf,
};

async function fetchIssues(repo: string, token: string): Promise<GHIssue[]> {
  const all: GHIssue[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/issues?state=open&per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'goose-hub-cli',
        },
      },
    );
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error('GitHub authentication failed. Check your GITHUB_TOKEN.');
      }
      throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
    }
    const batch = (await res.json()) as GHIssue[];
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

async function fetchActiveMilestone(repo: string, token: string): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/milestones?state=open&per_page=50&sort=number&direction=asc`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'goose-hub-cli',
      },
    },
  );
  if (!res.ok) return null;
  const milestones = (await res.json()) as Array<{
    title: string;
    number: number;
    open_issues: number;
    closed_issues: number;
  }>;
  if (milestones.length === 0) return null;
  const m = milestones[0]; // lowest number = active
  return `${m.title} (${m.open_issues} open, ${m.closed_issues} closed)`;
}

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

  const { repo } = config.source;

  let issues: GHIssue[];
  let activeMilestone: string | null;

  try {
    [issues, activeMilestone] = await Promise.all([
      fetchIssues(repo, token),
      fetchActiveMilestone(repo, token),
    ]);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  console.log(`${config.name} (${repo})`);
  if (activeMilestone) {
    console.log(`Active milestone: ${activeMilestone}`);
  }
  console.log('─'.repeat(70));

  const resolved = issues.map((issue) => ({
    issue,
    resolution: resolveState(issue.labels.map((l) => l.name)),
  }));

  const { byState, conflicts } = groupIssues(resolved);

  // Print groups in canonical STATES order, skipping empty groups
  for (const state of STATES) {
    const group = byState.get(state);
    if (!group || group.length === 0) continue;

    console.log(`\n  ${state} (${group.length})`);
    for (const { issue, resolution } of group) {
      const num = `#${issue.number}`.padStart(5);
      const title = issue.title.slice(0, 50);
      if (resolution.conflict && resolution.raw.length === 0) {
        console.log(`     ${num}  ${title}  (no factory label)`);
      } else {
        console.log(`     ${num}  ${title}`);
      }
    }
  }

  // Print conflicts section
  if (conflicts.length > 0) {
    console.log(`\n  CONFLICTS (${conflicts.length})`);
    for (const { issue, resolution } of conflicts) {
      const num = `#${issue.number}`.padStart(5);
      const title = issue.title.slice(0, 42).padEnd(42);
      console.log(
        `  ⚠  ${num}  ${title}  CONFLICT [${resolution.raw.join(' + ')}] → ${resolution.state}`,
      );
    }
  }

  console.log(`\n${'─'.repeat(70)}`);
  const conflictSuffix =
    conflicts.length > 0
      ? `, ${conflicts.length} conflict${conflicts.length !== 1 ? 's' : ''}`
      : '';
  console.log(
    `Total: ${issues.length} open issue${issues.length !== 1 ? 's' : ''}${conflictSuffix}`,
  );
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
