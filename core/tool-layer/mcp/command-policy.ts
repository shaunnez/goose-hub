import { spawn } from 'node:child_process';
import {
  type ShapeCommandOutputResult,
  shapeCommandOutput,
  shapeCommandOutputInMemory,
} from './output-sandbox.js';

export type CommandStatus = 'ok' | 'failed' | 'timed_out';

export interface CommandSpec {
  command: string;
  args: ReadonlyArray<string>;
  cwd: string;
  env?: Readonly<Record<string, string>>;
  runId?: string;
  displayOutput?: boolean;
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
  displayTruncated: boolean;
  fullOutputPath?: string;
}

export const DEFAULT_STDOUT_LIMIT_BYTES = 256 * 1024;
export const DEFAULT_STDERR_LIMIT_BYTES = 64 * 1024;

const FORCE_KILL_GRACE_MS = 2_000;
const runInvocationCounters = new Map<string, number>();

function nextInvocationForRun(runId: string): number {
  const next = (runInvocationCounters.get(runId) ?? 0) + 1;
  runInvocationCounters.set(runId, next);
  return next;
}

export function clearRunCommandInvocationCounter(runId: string): void {
  runInvocationCounters.delete(runId);
}

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
  const invocation = spec.runId != null ? nextInvocationForRun(spec.runId) : null;

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
    let exited = false;
    let settled = false;
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
      // `child.killed` flips on signal *send*, not exit — checking it here
      // would skip SIGKILL for processes that ignore SIGTERM. Track exit
      // via the close handler instead.
      forceKillTimer = setTimeout(() => {
        if (!exited) child.kill('SIGKILL');
      }, FORCE_KILL_GRACE_MS);
    }, spec.timeoutMs);

    const resolveResult = async (
      status: CommandStatus,
      exitCode: number | null,
      signal: NodeJS.Signals | null,
    ) => {
      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks);
      let shaped: ShapeCommandOutputResult = {
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        displayTruncated: false,
      };

      if (spec.displayOutput === true && spec.runId != null && invocation != null) {
        try {
          shaped = await shapeCommandOutput({
            workspaceRoot: spec.cwd,
            runId: spec.runId,
            invocation,
            stdout,
            stderr,
            byteCaptureTruncated: truncated,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          shaped = shapeCommandOutputInMemory(
            {
              workspaceRoot: spec.cwd,
              runId: spec.runId,
              invocation,
              stdout,
              stderr,
              byteCaptureTruncated: truncated,
            },
            message,
          );
        }
      }

      resolvePromise({
        status,
        exitCode,
        signal,
        stdout: shaped.stdout,
        stderr: shaped.stderr,
        durationMs: Date.now() - startedAt,
        truncated,
        displayTruncated: shaped.displayTruncated,
        ...(shaped.fullOutputPath != null ? { fullOutputPath: shaped.fullOutputPath } : {}),
      });
    };

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      exited = true;
      clearTimeout(timeoutHandle);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      const status: CommandStatus = timedOut ? 'timed_out' : exitCode === 0 ? 'ok' : 'failed';
      void resolveResult(status, exitCode, signal);
    };

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      exited = true;
      clearTimeout(timeoutHandle);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      stderrChunks.push(Buffer.from(`${err.message}\n`, 'utf8'));
      void resolveResult('failed', null, null);
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
