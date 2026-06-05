import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type StackInfo, detectStack } from '../bootstrap/stack-detector.js';
import type { StackConfig } from '../types.js';

export type PackageManager = 'pnpm' | 'npm' | 'yarn';

export interface SelectedRepoStack extends StackConfig {
  installCommand?: string[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isYarnBerry(repoPath: string): Promise<boolean> {
  if (await exists(join(repoPath, '.yarnrc.yml'))) return true;
  try {
    const pkg = JSON.parse(await readFile(join(repoPath, 'package.json'), 'utf8')) as {
      packageManager?: unknown;
    };
    const packageManager = typeof pkg.packageManager === 'string' ? pkg.packageManager : '';
    const match = packageManager.match(/^yarn@(\d+)/);
    return match != null && Number(match[1]) >= 2;
  } catch {
    return false;
  }
}

export async function installCommandForPackageManager(
  repoPath: string,
  packageManager: PackageManager,
  filter?: string,
): Promise<string[]> {
  if (packageManager === 'pnpm') {
    return filter
      ? ['pnpm', 'install', '--frozen-lockfile', '--filter', filter]
      : ['pnpm', 'install', '--frozen-lockfile'];
  }
  if (packageManager === 'npm') return ['npm', 'ci'];
  return (await isYarnBerry(repoPath))
    ? ['yarn', 'install', '--immutable']
    : ['yarn', 'install', '--frozen-lockfile'];
}

function nodeScriptCommand(pm: PackageManager, script: string): string {
  if (script === 'test') return pm === 'npm' ? 'npm test' : `${pm} test`;
  return `${pm} run ${script}`;
}

export async function stackCommandsForWorktree(
  worktreePath: string,
  fallback?: StackConfig,
): Promise<SelectedRepoStack> {
  const detectedAt = new Date().toISOString();
  const stack = await detectStack(worktreePath);
  const commands = stackCommandsFromDetectedStack(stack, detectedAt, fallback);
  if (
    commands.packageManager === 'pnpm' ||
    commands.packageManager === 'npm' ||
    commands.packageManager === 'yarn'
  ) {
    return {
      ...commands,
      installCommand: await installCommandForPackageManager(worktreePath, commands.packageManager),
    };
  }
  return commands;
}

export function stackCommandsFromDetectedStack(
  stack: StackInfo,
  detectedAt: string,
  fallback?: StackConfig,
): SelectedRepoStack {
  if (stack.type === 'node') {
    const pm = stack.packageManager;
    return {
      runtime: 'node',
      packageManager: pm,
      detectedAt,
      testCommand: stack.scripts.test ? nodeScriptCommand(pm, 'test') : '',
      ...(stack.scripts.build ? { buildCommand: nodeScriptCommand(pm, 'build') } : {}),
      ...(stack.scripts.lint ? { lintCommand: nodeScriptCommand(pm, 'lint') } : {}),
      ...(stack.scripts.typecheck ? { typecheckCommand: nodeScriptCommand(pm, 'typecheck') } : {}),
      ...(stack.scripts.e2e ? { e2eCommand: nodeScriptCommand(pm, 'e2e') } : {}),
    };
  }
  if (stack.type === 'go') {
    return {
      runtime: 'go',
      packageManager: 'go',
      detectedAt,
      buildCommand: stack.buildCommand,
      testCommand: stack.testCommand,
    };
  }
  if (stack.type === 'rust') {
    return {
      runtime: 'rust',
      packageManager: 'cargo',
      detectedAt,
      buildCommand: stack.buildCommand,
      testCommand: stack.testCommand,
    };
  }
  if (stack.type === 'python') {
    return {
      runtime: 'python',
      packageManager: 'pip',
      detectedAt,
      testCommand: stack.testRunner === 'pytest' ? 'pytest' : 'python -m unittest',
      ...(stack.lintTool != null ? { lintCommand: stack.lintTool } : {}),
    };
  }
  if (stack.type === 'ruby') {
    return {
      runtime: 'ruby',
      packageManager: 'bundle',
      detectedAt,
      testCommand: stack.testRunner === 'rspec' ? 'bundle exec rspec' : 'ruby -Itest',
    };
  }
  return (
    fallback ?? {
      runtime: 'unknown',
      packageManager: 'unknown',
      detectedAt,
      testCommand: '',
    }
  );
}
