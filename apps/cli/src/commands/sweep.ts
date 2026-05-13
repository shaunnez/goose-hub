import { createInterface } from 'node:readline';
import { loadProjects } from '@goose-hub/core/projects/loader.js';
import { TERMINAL_STATES } from '@goose-hub/core/state-machine/states.js';
import { GitHubLabelsSource } from '@goose-hub/core/state-source/github-labels.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import { githubRepoRef } from '@goose-hub/core/types.js';
import { targetProjectsRoot } from '@goose-hub/target-projects';

export async function sweepCommand(slug: string, milestoneArg: string): Promise<void> {
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

  const source = new GitHubLabelsSource(config.id, githubRepoRef(config.source), token);

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
