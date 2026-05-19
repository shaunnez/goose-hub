import { spawn } from 'node:child_process';

export type CommandStatus = 'ok' | 'failed' | 'timed_out';

export interface CommandSpec {
  command: string;
  args: ReadonlyArray<string>;
  cwd: string;
  env?: Readonly<Record<string, string>>;
  timeoutMs: number;
  stdoutLimitBytes?: number;
  stderrLimitBytes?: number;
}

export interface CommandResult {
  status: CommandStatus;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
}

export const DEFAULT_STDOUT_LIMIT_BYTES = 256 * 1024;
export const DEFAULT_STDERR_LIMIT_BYTES = 64 * 1024;

const FORCE_KILL_GRACE_MS = 2_000;

/**
 * Sole execution path for MCP tools. `shell: false` is non-negotiable —
 * builders construct argv arrays from project/stack config; the model never
 * supplies a string.
 *
 * Output is byte-capped to bound memory and avoid leaking large dumps to
 * audit events. Timeouts SIGTERM then SIGKILL after a short grace window and
 * return `status: 'timed_out'` rather than throwing, so a verify-step
 * timeout is recoverable for the surrounding workflow.
 */
export async function runCommand(spec: CommandSpec): Promise<CommandResult> {
  const stdoutLimit = spec.stdoutLimitBytes ?? DEFAULT_STDOUT_LIMIT_BYTES;
  const stderrLimit = spec.stderrLimitBytes ?? DEFAULT_STDERR_LIMIT_BYTES;

  return new Promise<CommandResult>((resolvePromise) => {
    const startedAt = Date.now();
    const child = spawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      env: spec.env ? { ...spec.env } : undefined,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let timedOut = false;
    let forceKillTimer: NodeJS.Timeout | null = null;

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdoutBytes >= stdoutLimit) {
        truncated = true;
        return;
      }
      const remaining = stdoutLimit - stdoutBytes;
      if (chunk.byteLength <= remaining) {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.byteLength;
      } else {
        stdoutChunks.push(chunk.subarray(0, remaining));
        stdoutBytes = stdoutLimit;
        truncated = true;
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrBytes >= stderrLimit) {
        truncated = true;
        return;
      }
      const remaining = stderrLimit - stderrBytes;
      if (chunk.byteLength <= remaining) {
        stderrChunks.push(chunk);
        stderrBytes += chunk.byteLength;
      } else {
        stderrChunks.push(chunk.subarray(0, remaining));
        stderrBytes = stderrLimit;
        truncated = true;
      }
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, FORCE_KILL_GRACE_MS);
    }, spec.timeoutMs);

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timeoutHandle);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      const status: CommandStatus = timedOut ? 'timed_out' : exitCode === 0 ? 'ok' : 'failed';
      resolvePromise({
        status,
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        durationMs: Date.now() - startedAt,
        truncated,
      });
    };

    child.on('error', (err) => {
      clearTimeout(timeoutHandle);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      stderrChunks.push(Buffer.from(`${err.message}\n`, 'utf8'));
      resolvePromise({
        status: 'failed',
        exitCode: null,
        signal: null,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        durationMs: Date.now() - startedAt,
        truncated,
      });
    });

    child.on('close', finish);
  });
}

/**
 * Minimal env passed to spawned commands. Builders may extend with explicit
 * additions (PATH, NODE_ENV) but never propagate `process.env` wholesale —
 * that would leak orchestrator secrets into the child.
 */
export function minimalEnv(extras: Record<string, string> = {}): Record<string, string> {
  const path = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin';
  const home = process.env.HOME ?? '';
  return {
    PATH: path,
    HOME: home,
    NODE_ENV: process.env.NODE_ENV ?? 'production',
    ...extras,
  };
}
