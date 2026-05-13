/**
 * `goose work` CLI namespace (M14.08 / #329).
 *
 * Houses Work-mode subcommands: `goose work status`, `goose work
 * investigate <issue>`. Gated by `WORK_MACHINE=true`. Each subcommand
 * short-circuits with a clear error message and a non-zero exit code on
 * machines where the env var is unset, mirroring the loader/scheduler
 * gates so the user gets the same "Work is hidden here" signal from
 * every surface.
 */

import { logger } from '@goose-hub/core/logger.js';
import { isWorkMachine, loadProjects } from '@goose-hub/core/projects/loader.js';
import { JiraStateSource } from '@goose-hub/core/state-source/jira.js';
import type { JiraSourceConfig, ProjectConfig } from '@goose-hub/core/types.js';
import { targetProjectsRoot } from '@goose-hub/target-projects';

export interface WorkCommandIo {
  write: (line: string) => void;
  writeErr: (line: string) => void;
  env: NodeJS.ProcessEnv;
}

const DEFAULT_IO: WorkCommandIo = {
  write: (line) => process.stdout.write(`${line}\n`),
  writeErr: (line) => process.stderr.write(`${line}\n`),
  env: process.env,
};

const WORK_GATE_MESSAGE =
  'WORK_MACHINE is not set — Work commands are unavailable on this machine.';

function requireWorkMachine(io: WorkCommandIo): boolean {
  if (isWorkMachine(io.env)) return true;
  io.writeErr(WORK_GATE_MESSAGE);
  return false;
}

function isJiraProject(cfg: ProjectConfig): cfg is ProjectConfig & { source: JiraSourceConfig } {
  return cfg.source.kind === 'jira';
}

/**
 * `goose work status` — list Work projects + the current state of their
 * open Jira tickets. Read-only.
 */
export async function workStatusCommand(io: WorkCommandIo = DEFAULT_IO): Promise<number> {
  if (!requireWorkMachine(io)) return 1;

  const projects = await loadProjects(targetProjectsRoot);
  const work = projects.filter(isJiraProject);
  if (work.length === 0) {
    io.write('No Work projects registered.');
    return 0;
  }
  for (const project of work) {
    io.write(`${project.name} (${project.source.projectKey})`);
    io.write('─'.repeat(60));
    try {
      const source = new JiraStateSource(project.id, project.source.projectKey, {
        issueTypes: project.source.issueTypes,
        statusMap: project.source.statusMap,
      });
      const items = await source.listOpenWork();
      if (items.length === 0) {
        io.write('  (no open Jira issues)');
      } else {
        for (const item of items) {
          io.write(`  ${item.externalId.padEnd(12)}  ${item.state.padEnd(28)}  ${item.title}`);
        }
      }
    } catch (err) {
      io.writeErr(`  error: ${(err as Error).message}`);
    }
    io.write('');
  }
  return 0;
}

/**
 * `goose work investigate <project-slug> <jira-key>` — manually trigger
 * an investigation against a specific Jira ticket. The actual workflow
 * dispatch lives in `apps/server`; this CLI surfaces the trigger by
 * resolving the project + ticket and writing an event the server can
 * pick up. M14 ships the surface; the wiring to dispatch is incremental.
 */
export async function workInvestigateCommand(
  args: string[],
  io: WorkCommandIo = DEFAULT_IO,
): Promise<number> {
  if (!requireWorkMachine(io)) return 1;
  const [slug, jiraKey] = args;
  if (slug == null || jiraKey == null) {
    io.writeErr('Usage: goose work investigate <project-slug> <jira-key>');
    return 1;
  }
  const projects = await loadProjects(targetProjectsRoot);
  const project = projects.find((p) => p.slug === slug);
  if (project == null || !isJiraProject(project)) {
    io.writeErr(`No Work project registered with slug "${slug}".`);
    return 1;
  }
  try {
    const source = new JiraStateSource(project.id, project.source.projectKey, {
      issueTypes: project.source.issueTypes,
      statusMap: project.source.statusMap,
    });
    const item = await source.getItem(jiraKey);
    io.write(`Triggering investigation for ${item.externalId}: ${item.title}`);
    logger.info('work.investigate-triggered', {
      projectId: project.id,
      itemId: item.id,
    });
    return 0;
  } catch (err) {
    io.writeErr(`Failed to load ticket ${jiraKey}: ${(err as Error).message}`);
    return 1;
  }
}

/** Help text — listed under `goose help` only when WORK_MACHINE=true. */
export function workHelpLines(): string[] {
  return [
    '  work status                       List active Work projects and Jira issue states',
    '  work investigate <slug> <key>     Trigger an investigation run for a Jira ticket',
  ];
}

/**
 * Top-level dispatcher for `goose work <subcommand>`. Returns the exit
 * code so the CLI entrypoint can pass it to `process.exit`.
 */
export async function workCommand(args: string[], io: WorkCommandIo = DEFAULT_IO): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case 'status':
      return workStatusCommand(io);
    case 'investigate':
      return workInvestigateCommand(rest, io);
    default:
      io.writeErr('Usage: goose work <status|investigate>');
      return 1;
  }
}
