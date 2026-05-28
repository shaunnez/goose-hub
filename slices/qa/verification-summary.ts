import { spawn } from 'node:child_process';
import { killProcessGroupOrChild } from '@goose-hub/core/agent-runtime/process-kill.js';
import type { QaE2eMode } from '@goose-hub/core/db/repositories/project-settings.js';
import type { AgentEvent } from '@goose-hub/core/event-stream/store.js';
import type {
  TestRun,
  VerificationCommandSummary,
  VerificationSummary,
} from '@goose-hub/skills/qa/schema.js';
import {
  type PrOpenedHints,
  classifyUiChanges,
  getChangedFilePaths,
  getPrDiffStat,
} from './qa-helpers.js';

export interface RunQaCommandOptions {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export type RunQaCommand = (
  cwd: string,
  command: string,
  options?: RunQaCommandOptions,
) => Promise<VerificationCommandSummary>;

export interface VerificationSummaryInput {
  workspaceDir?: string;
  prHints: PrOpenedHints;
  prDiff: string;
  qaE2eMode: QaE2eMode;
  configuredE2eCommand?: string;
  commands: {
    testCommand: string;
    lintCommand?: string;
    typecheckCommand?: string;
  };
  priorEvents: AgentEvent[];
  devTestsRun?: { command: string; paths: string[] };
  testCapture?: { enabled: boolean; reason?: string };
  commandEnv?: NodeJS.ProcessEnv;
  commandTimeoutMs?: number;
  runTests: (cwd: string, command: string) => Promise<TestRun | null>;
  runCommand?: RunQaCommand;
}

export interface VerificationSummaryResult {
  verificationSummary: VerificationSummary;
  testRun: TestRun | null;
  e2eDecision: { mode: QaE2eMode; command?: string; reason: string };
}

const DEFAULT_COMMAND_TIMEOUT_MS = 600_000;
const COMMAND_OUTPUT_TAIL_CHARS = 4_000;
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

export async function defaultRunCommand(
  cwd: string,
  command: string,
  options: RunQaCommandOptions = {},
): Promise<VerificationCommandSummary> {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return { command, status: 'skipped', error: 'empty command' };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const started = Date.now();
  return await new Promise((resolve) => {
    let settled = false;
    let child: ReturnType<typeof spawn> | undefined;
    let stdoutTail = '';
    let stderrTail = '';
    const finish = (summary: VerificationCommandSummary) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ...summary, durationMs: Date.now() - started });
    };
    const timeout = setTimeout(() => {
      if (child != null) killProcessGroupOrChild(child);
      finish({
        command,
        status: 'failed',
        error: `command timed out after ${timeoutMs}ms`,
        ...failedOutputTails(stdoutTail, stderrTail),
      });
    }, timeoutMs);

    try {
      child = spawn('sh', ['-c', trimmed], {
        cwd,
        detached: process.platform !== 'win32',
        env: { ...process.env, CI: 'true', ...options.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      finish({ command, status: 'failed', error: sanitizeOperationalMessage(error.message) });
      return;
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdoutTail = appendOutputTail(stdoutTail, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderrTail = appendOutputTail(stderrTail, chunk);
    });
    child.on('error', (err) => {
      finish({
        command,
        status: 'failed',
        error: sanitizeOperationalMessage(err.message),
        ...failedOutputTails(stdoutTail, stderrTail),
      });
    });
    child.on('close', (code) => {
      finish({
        command,
        status: code === 0 ? 'passed' : 'failed',
        ...(code != null ? { exitCode: code } : {}),
        ...(code === 0 ? {} : failedOutputTails(stdoutTail, stderrTail)),
      });
    });
  });
}

export async function buildVerificationSummary(
  input: VerificationSummaryInput,
): Promise<VerificationSummaryResult> {
  const runCommand = input.runCommand ?? defaultRunCommand;
  const changedFilePaths = getChangedFilePaths(input.workspaceDir, input.prHints.baseBranch);
  const diffStat = getPrDiffStat(input.workspaceDir, input.prHints.baseBranch);
  const e2eDecision = decideE2e({
    mode: input.qaE2eMode,
    configuredE2eCommand: input.configuredE2eCommand,
    changedFilePaths,
  });

  const lint = await runOptionalCommand(
    input.workspaceDir,
    input.commands.lintCommand,
    runCommand,
    input.commandTimeoutMs,
    input.commandEnv,
  );
  const typecheck = await runOptionalCommand(
    input.workspaceDir,
    input.commands.typecheckCommand,
    runCommand,
    input.commandTimeoutMs,
    input.commandEnv,
  );

  let testRun: TestRun | null = null;
  let testCaptureError: string | undefined;
  if (input.workspaceDir != null && input.testCapture?.enabled !== false) {
    try {
      testRun = await input.runTests(input.workspaceDir, input.commands.testCommand);
    } catch (err) {
      testCaptureError = sanitizeOperationalMessage(err instanceof Error ? err.message : err);
    }
  }
  const testStatus: VerificationCommandSummary['status'] =
    input.workspaceDir == null || input.testCapture?.enabled === false || testRun == null
      ? 'skipped'
      : testRun.success
        ? 'passed'
        : 'failed';
  const testError =
    input.workspaceDir == null
      ? 'no worktree available'
      : input.testCapture?.enabled === false
        ? input.testCapture.reason
        : testRun == null
          ? (testCaptureError ?? 'test command did not produce structured output')
          : undefined;
  const compactedTestRun = compactTestRun(input.commands.testCommand, testStatus, testRun);
  const e2e = await runOptionalCommand(
    input.workspaceDir,
    e2eDecision.command,
    runCommand,
    input.commandTimeoutMs,
    input.commandEnv,
  );

  const verificationSummary: VerificationSummary = {
    changedFiles: {
      paths: changedFilePaths,
      count: changedFilePaths.length,
      diffCharCount: input.prDiff.length,
      ...(diffStat.length > 0 ? { diffStat } : {}),
    },
    pr: {
      ...(input.prHints.prNumber != null ? { number: input.prHints.prNumber } : {}),
      ...(input.prHints.baseBranch != null ? { baseBranch: input.prHints.baseBranch } : {}),
      ...(input.prHints.prHeadSha != null ? { headSha: input.prHints.prHeadSha } : {}),
    },
    commands: {
      ...(lint != null ? { lint } : {}),
      ...(typecheck != null ? { typecheck } : {}),
      test: {
        command: input.commands.testCommand,
        status: testStatus,
        ...(testRun != null ? { durationMs: testRun.wallTimeMs } : {}),
        ...(testError != null ? { error: testError } : {}),
      },
      ...(e2e != null ? { e2e } : {}),
    },
    ...(compactedTestRun != null ? { testRun: compactedTestRun } : {}),
    e2e: {
      mode: e2eDecision.mode,
      ...(e2eDecision.command != null ? { command: e2eDecision.command } : {}),
      status: e2e?.status ?? 'skipped',
      reason: e2eReason(e2eDecision.reason, e2e),
    },
    evidence: summarizeEvidence(input.priorEvents),
    ...(input.devTestsRun != null ? { devTestsRun: input.devTestsRun } : {}),
  };

  return { verificationSummary, testRun, e2eDecision };
}

export function estimateVerificationSummaryBytes(summary: VerificationSummary): number {
  return Buffer.byteLength(JSON.stringify(summary), 'utf8');
}

function decideE2e(input: {
  mode: QaE2eMode;
  configuredE2eCommand?: string;
  changedFilePaths: string[];
}): { mode: QaE2eMode; command?: string; reason: string } {
  const uiClassification = classifyUiChanges(input.changedFilePaths);
  if (input.mode === 'off') {
    return { mode: input.mode, reason: 'qa e2e disabled by project setting' };
  }
  if (input.mode === 'always') {
    return input.configuredE2eCommand != null
      ? { mode: input.mode, command: input.configuredE2eCommand, reason: 'qa e2e mode is always' }
      : { mode: input.mode, reason: 'qa e2e mode is always but no command is configured' };
  }
  if (uiClassification.hasSignificantUiChange && input.configuredE2eCommand != null) {
    return {
      mode: input.mode,
      command: input.configuredE2eCommand,
      reason: uiClassification.reason,
    };
  }
  return {
    mode: input.mode,
    reason:
      input.configuredE2eCommand == null
        ? 'qa e2e mode is ui-changed but no command is configured'
        : uiClassification.reason,
  };
}

function runOptionalCommand(
  workspaceDir: string | undefined,
  command: string | undefined,
  runCommand: RunQaCommand,
  timeoutMs?: number,
  env?: NodeJS.ProcessEnv,
): Promise<VerificationCommandSummary | null> {
  if (command == null || command.trim().length === 0) return Promise.resolve(null);
  if (workspaceDir == null) {
    return Promise.resolve({ command, status: 'skipped', error: 'no worktree available' });
  }
  const options =
    timeoutMs != null || env != null
      ? {
          ...(timeoutMs != null ? { timeoutMs } : {}),
          ...(env != null ? { env } : {}),
        }
      : undefined;
  return runCommand(workspaceDir, command, options);
}

function e2eReason(reason: string, e2e: VerificationCommandSummary | null): string {
  if (e2e == null) return reason;
  if (e2e.status !== 'skipped') return reason;
  return e2e.error != null
    ? `${reason}; harness did not run e2e: ${e2e.error}`
    : `${reason}; harness did not run e2e`;
}

function compactTestRun(
  command: string,
  status: VerificationCommandSummary['status'],
  testRun: TestRun | null,
): VerificationSummary['testRun'] {
  if (testRun == null) {
    return undefined;
  }

  return {
    command,
    status,
    wallTimeMs: testRun.wallTimeMs,
    total: testRun.total,
    passed: testRun.passed,
    failed: testRun.failed,
    skipped: testRun.skipped,
    failingSuites: testRun.suites
      .filter((suite) => suite.status === 'failed' || suite.failed > 0)
      .map((suite) => suite.filePath || suite.name),
  };
}

function summarizeEvidence(events: AgentEvent[]): VerificationSummary['evidence'] {
  const evidence = events
    .slice()
    .reverse()
    .find((event) =>
      [
        'evidence.posted',
        'evidence.post-failed',
        'evidence.post-skipped',
        'evidence.no-spec-declared',
      ].includes(event.kind),
    );
  if (evidence == null) {
    return {
      status: 'absent',
      reason:
        'no evidence event was recorded; no evidence spec was declared or the evidence workflow did not run',
    };
  }

  const payload = evidence.payload as Record<string, unknown>;
  if (evidence.kind === 'evidence.posted') {
    const screenshots = Array.isArray(payload.screenshots)
      ? payload.screenshots.filter((path): path is string => typeof path === 'string')
      : [];
    return {
      status: 'posted',
      ...(typeof payload.commentUrl === 'string' ? { url: payload.commentUrl } : {}),
      ...(screenshots.length > 0 ? { screenshots } : {}),
      ...(typeof payload.gifPath === 'string' || payload.gifPath === null
        ? { gifPath: payload.gifPath }
        : {}),
      ...(typeof payload.commitSha === 'string' ? { commitSha: payload.commitSha } : {}),
    };
  }
  if (evidence.kind === 'evidence.post-failed') {
    return {
      status: 'failed',
      error: sanitizeOperationalMessage(payload.error),
    };
  }
  if (evidence.kind === 'evidence.post-skipped') {
    return {
      status: 'skipped',
      reason: sanitizeOperationalMessage(payload.reason ?? 'evidence post skipped'),
    };
  }
  return { status: 'skipped', reason: 'no evidence spec declared' };
}

function sanitizeOperationalMessage(value: unknown): string {
  const message = typeof value === 'string' ? value : String(value ?? 'unknown error');
  return message.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function appendOutputTail(current: string, chunk: Buffer | string): string {
  const next = current + String(chunk);
  return next.length > COMMAND_OUTPUT_TAIL_CHARS ? next.slice(-COMMAND_OUTPUT_TAIL_CHARS) : next;
}

function failedOutputTails(
  stdoutTail: string,
  stderrTail: string,
): Pick<VerificationCommandSummary, 'stdout' | 'stderr'> {
  return {
    ...(stdoutTail.trim().length > 0 ? { stdout: sanitizeCommandOutput(stdoutTail) } : {}),
    ...(stderrTail.trim().length > 0 ? { stderr: sanitizeCommandOutput(stderrTail) } : {}),
  };
}

function sanitizeCommandOutput(value: string): string {
  return value
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(-COMMAND_OUTPUT_TAIL_CHARS);
}
