#!/usr/bin/env tsx
import 'dotenv/config';
import { STATES } from '../../../core/state-machine/states.js';
import type { StateName } from '../../../core/state-machine/states.js';
import type { ProjectConfig } from '../../../core/types.js';
import gooseHubSelf from '../../../target-projects/goose-hub-self/project.config.js';

const registry: Record<string, ProjectConfig> = {
  'goose-hub-self': gooseHubSelf,
};

const STATE_SET = new Set<string>(STATES);

type StateResolution = {
  state: StateName;
  conflict: boolean;
  raw: StateName[];
};

function resolveState(labelNames: string[]): StateResolution {
  const stateLabels = labelNames.filter((l) => STATE_SET.has(l)) as StateName[];

  if (stateLabels.length === 0) {
    return { state: 'factory:triaging', conflict: true, raw: [] };
  }
  if (stateLabels.length === 1) {
    return { state: stateLabels[0] as StateName, conflict: false, raw: stateLabels };
  }
  // archived always wins
  if (stateLabels.includes('factory:archived')) {
    return { state: 'factory:archived', conflict: true, raw: stateLabels };
  }
  // pick most-advanced (highest canonical index)
  const advanced = stateLabels.reduce((a, b) => (STATES.indexOf(a) >= STATES.indexOf(b) ? a : b));
  return { state: advanced, conflict: true, raw: stateLabels };
}

type GHIssue = {
  number: number;
  title: string;
  labels: Array<{ name: string }>;
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
      throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
    }
    const batch = (await res.json()) as GHIssue[];
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
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
  console.log(`${config.name} (${repo})`);
  console.log('─'.repeat(70));

  const issues = await fetchIssues(repo, token);
  let conflicts = 0;

  for (const issue of issues) {
    const labelNames = issue.labels.map((l) => l.name);
    const { state, conflict, raw } = resolveState(labelNames);
    const num = `#${issue.number}`.padStart(5);
    const title = issue.title.slice(0, 42).padEnd(42);

    if (conflict && raw.length > 1) {
      conflicts++;
      console.log(`  ⚠  ${num}  ${title}  CONFLICT [${raw.join(' + ')}] → ${state}`);
    } else if (conflict && raw.length === 0) {
      console.log(`  ⚠  ${num}  ${title}  ${state.padEnd(30)}  (no factory label)`);
    } else {
      console.log(`     ${num}  ${title}  ${state}`);
    }
  }

  console.log('─'.repeat(70));
  const conflictSuffix =
    conflicts > 0 ? `, ${conflicts} conflict${conflicts !== 1 ? 's' : ''}` : '';
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
