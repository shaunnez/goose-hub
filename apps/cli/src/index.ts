#!/usr/bin/env tsx
import 'dotenv/config';
import { isWorkMachine } from '@goose-hub/core/projects/loader.js';
import { bootstrapProject } from '@goose-hub/core/workflows/bootstrap-project.js';
import { bootstrapCommand } from './bootstrap-command.js';
import { runAgentCommand } from './commands/agent.js';
import { playbookCommand } from './commands/playbook.js';
import { skillCommand } from './commands/skill.js';
import { statusCommand } from './commands/status.js';
import { sweepCommand } from './commands/sweep.js';
import { taskMoveCommand } from './commands/task-move.js';
import { workCommand, workHelpLines } from './commands/work.js';

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
  case 'work': {
    const exitCode = await workCommand(args);
    process.exit(exitCode);
    break;
  }
  case 'project':
    if (args[0] === 'bootstrap') {
      const exitCode = await bootstrapCommand({
        argv: process.argv,
        env: process.env as Record<string, string | undefined>,
        runWorkflow: (input) => bootstrapProject(input),
        write: (line) => process.stdout.write(`${line}\n`),
        writeErr: (line) => process.stderr.write(`${line}\n`),
      });
      process.exit(exitCode);
    } else {
      console.error('Usage: goose project bootstrap <owner>/<repo>');
      process.exit(1);
    }
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
    console.error('  project bootstrap <owner>/<repo>  Bootstrap a new project into Factory');
    if (isWorkMachine()) {
      for (const line of workHelpLines()) console.error(line);
    }
    process.exit(1);
}
