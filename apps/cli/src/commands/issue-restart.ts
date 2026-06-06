import { loadProjects } from '@goose-hub/core/projects/loader.js';
import { type RestartIssueResult, restartIssue } from '@goose-hub/core/projects/restart-issue.js';
import { STATES, type StateName } from '@goose-hub/core/state-machine/states.js';
import type { Schedule, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { targetProjectsRoot } from '@goose-hub/target-projects';
import { createCliStateSource } from '../source.js';

const VALID_SCHEDULES = new Set<Schedule>(['current', 'next', 'later', 'blocked-by']);

interface ParsedRestartArgs {
  slug: string;
  id: string;
  state?: StateName;
  schedule?: Schedule;
  yes: boolean;
}

function usage(): string {
  return [
    'Usage: goose issue restart <project-slug> <issue-id> [--state=factory:triaging] [--schedule=current|next|later|blocked-by] [--yes]',
    '',
    'Without --yes, prints the restart plan without creating or archiving issues.',
  ].join('\n');
}

function parseArgs(rawArgs: string[]): ParsedRestartArgs | null {
  const [slug = '', id = '', ...rest] = rawArgs;
  let state: StateName | undefined;
  let schedule: Schedule | undefined;
  let yes = false;

  for (const arg of rest) {
    if (arg.startsWith('--state=')) {
      const rawState = arg.slice('--state='.length);
      if (!(STATES as readonly string[]).includes(rawState)) {
        console.error(`Invalid --state: ${rawState}`);
        return null;
      }
      state = rawState as StateName;
    } else if (arg.startsWith('--schedule=')) {
      const rawSchedule = arg.slice('--schedule='.length);
      if (!VALID_SCHEDULES.has(rawSchedule as Schedule)) {
        console.error(`Invalid --schedule: ${rawSchedule}`);
        return null;
      }
      schedule = rawSchedule as Schedule;
    } else if (arg === '--yes') {
      yes = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      return null;
    }
  }

  if (!slug || !id) return null;
  return { slug, id, state, schedule, yes };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function issueRestartCommand(rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs);
  if (args == null) {
    console.error(usage());
    process.exit(1);
  }

  const projects = await loadProjects(targetProjectsRoot);
  const config = projects.find((p) => p.slug === args.slug);
  if (!config) {
    console.error(`Unknown project: ${args.slug}`);
    console.error(`Known projects: ${projects.map((p) => p.slug).join(', ')}`);
    process.exit(1);
  }

  let source: ReturnType<typeof createCliStateSource>;
  try {
    source = createCliStateSource(config);
  } catch (err) {
    console.error(errorMessage(err));
    process.exit(1);
  }
  let oldItem: WorkItem;
  try {
    oldItem = await source.getItem(args.id);
  } catch (err) {
    console.error(`Failed to fetch issue #${args.id}: ${errorMessage(err)}`);
    process.exit(1);
  }
  const targetState = args.state ?? 'factory:triaging';
  const schedule = args.schedule ?? oldItem.schedule;

  if (!args.yes) {
    console.log('Issue restart plan:');
    console.log(`  project:      ${args.slug}`);
    console.log(`  original:     ${oldItem.repoRef}#${oldItem.externalId}`);
    console.log(`  title:        ${oldItem.title}`);
    console.log(`  old state:    ${oldItem.state}`);
    console.log(`  new state:    ${targetState}`);
    console.log(`  new schedule: ${schedule}`);
    console.log(`  milestone:    ${oldItem.milestoneTitle ?? oldItem.milestoneId ?? '<none>'}`);
    console.log('');
    console.log('Re-run with --yes to create the fresh issue and archive the original.');
    return;
  }

  let result: RestartIssueResult;
  try {
    result = await restartIssue({
      source,
      projectId: config.id,
      itemId: oldItem.id,
      targetState,
      schedule,
    });
  } catch (err) {
    console.error(`Issue restart failed: ${errorMessage(err)}`);
    console.error(
      'If --yes was used, the operation may have partially completed. Check the issue comments and labels before retrying.',
    );
    process.exit(1);
  }

  let verifiedOldState = 'archive requested';
  try {
    verifiedOldState = (await source.getItem(oldItem.id)).state;
  } catch {
    // Keep the success output honest when post-restart verification cannot read GitHub.
  }

  console.log(`Restarted ${oldItem.repoRef}#${oldItem.externalId}.`);
  console.log(`  fresh issue:  ${result.newItem.repoRef}#${result.newItem.externalId}`);
  console.log(`  old state:    ${verifiedOldState}`);
  console.log(`  new state:    ${result.targetState}`);
  console.log(`  new schedule: ${result.schedule}`);
}
