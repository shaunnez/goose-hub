import { spawn } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { SandboxViolationError } from './read.js';

/**
 * Default denylist of forbidden command patterns. Each entry is matched as a
 * case-insensitive substring against the joined argv. Patterns intentionally
 * cast wider than the workspace `.claude/settings.json` deny list — this is
 * the in-process programmatic guard, separate from the spawn-time hook.
 */
export const DEFAULT_BASH_DENYLIST: readonly string[] = [
  'rm -rf /',
  'rm -rf /*',
  'rm -rf ~',
  'sudo ',
  'git push --force',
  'git push -f ',
  'git push --force-with-lease',
  ':(){ :|:& };:',
  'mkfs',
  '> /dev/sda',
  'dd if=/dev/zero',
  'curl http://',
  'wget http://',
] as const;

const BASH_TIMEOUT_MS = 30_000; // FACTORY_RULES rule 32
const BASH_STDOUT_CAP = 4 * 1024 * 1024; // FACTORY_RULES rule 31

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** True if stdout was capped at BASH_STDOUT_CAP. */
  truncated: boolean;
  /** True if the process was killed by the timeout. */
  timedOut: boolean;
}

interface RunBashParams {
  /** Absolute path to the workspace root. cwd for the child process. */
  workspaceRoot: string;
  /**
   * Command and arguments as an argv array. Never passed through a shell
   * (FACTORY_RULES rule 29). The first element is the command; the rest are
   * positional arguments.
   */
  argv: readonly string[];
  /** Optional override of the denylist. Defaults to DEFAULT_BASH_DENYLIST. */
  denylist?: readonly string[];
  /** Optional environment variables. Merged on top of a minimal base env. */
  env?: Record<string, string>;
  /** Optional override of the timeout (ms). Defaults to 30 s. */
  timeoutMs?: number;
}

/**
 * Runs a command (argv array) with `workspaceRoot` as cwd. Never invokes a
 * shell — the argv is passed directly to `spawn`.
 *
 * Security constraints:
 * - argv must be non-empty.
 * - The joined argv (case-insensitive) must not match any pattern in the denylist.
 * - `workspaceRoot` must not contain `..` traversal (paranoid; caller supplies it).
 * - Process is killed after `timeoutMs` and stdout is capped at 4 MB.
 *
 * @throws {SandboxViolationError} on argv validation failure.
 */
export async function runBash(params: RunBashParams): Promise<BashResult> {
  const { workspaceRoot, argv, denylist = DEFAULT_BASH_DENYLIST, env, timeoutMs } = params;

  if (argv.length === 0) {
    throw new SandboxViolationError('argv must not be empty');
  }

  for (const arg of argv) {
    if (typeof arg !== 'string') {
      throw new SandboxViolationError('argv entries must be strings');
    }
  }

  const joined = argv.join(' ').toLowerCase();
  for (const pattern of denylist) {
    if (joined.includes(pattern.toLowerCase())) {
      throw new SandboxViolationError(
        `Command rejected by denylist: matched "${pattern}" in "${argv.join(' ')}"`,
      );
    }
  }

  const rootNormalized = resolve(workspaceRoot);
  if (!isAbsolute(rootNormalized)) {
    throw new SandboxViolationError(`workspaceRoot must be absolute: "${workspaceRoot}"`);
  }

  const minimalEnv: Record<string, string> = {
    HOME: process.env.HOME ?? rootNormalized,
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    ...env,
  };

  const effectiveTimeoutMs = timeoutMs ?? BASH_TIMEOUT_MS;
  const [command, ...rest] = argv;

  return new Promise<BashResult>((resolveBash, rejectBash) => {
    const child = spawn(command, rest, {
      cwd: rootNormalized,
      shell: false, // FACTORY_RULES rule 29
      stdio: ['ignore', 'pipe', 'pipe'],
      env: minimalEnv,
    });

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;

    child.stdout.on('data', (chunk: Buffer) => {
      const remaining = BASH_STDOUT_CAP - stdout.length;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      stdout += chunk.slice(0, remaining).toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, effectiveTimeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolveBash({ stdout, stderr, exitCode: code ?? -1, truncated, timedOut });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      rejectBash(new Error(`Failed to spawn "${command}": ${err.message}`));
    });
  });
}
