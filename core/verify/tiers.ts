// core/verify/tiers.ts
// 3-tier verification engine (M19.05, issue #562).
// Steve's model: 03-lifecycle-harness.md:121-142

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '@goose-hub/core/db/db.js';
import { wpIterations } from '@goose-hub/core/db/schema.js';
import type { AgentEvent, AppendEventInput } from '@goose-hub/core/event-stream/store.js';
import { type EngineeringSpec, fileOwnedPath } from '@goose-hub/skills/spec-author/schema.js';
import { and, desc, eq } from 'drizzle-orm';

export type RegressionPolicy = 'escalate' | 'ignore';

export interface VerifyFinding {
  message: string;
  file?: string;
  line?: number;
  severity: 'error' | 'warning' | 'info';
  category?: 'product' | 'verification-infrastructure';
  code?: string;
}

export interface TierResult {
  tier: 1 | 2 | 3;
  passed: boolean;
  evidence: string[];
  findings: VerifyFinding[];
}

export interface RunArtifacts {
  runId: string;
  projectId: string;
  workItemId?: string | null;
  worktreePath: string;
  diff?: string;
  testCommand?: string;
  regressionPolicy?: RegressionPolicy;
  iteration?: number;
}

export interface TierDeps {
  appendEvent?: (input: AppendEventInput) => AgentEvent;
  getLastWpStatusImpl?: (runId: string, wpId: string) => 'ok' | 'failed' | 'in-progress' | null;
  runVerificationCommandImpl?: (
    command: string,
    worktreePath: string,
    expectedExitCodes: number[],
  ) => Promise<{ passed: boolean; output: string }>;
  runRegressionTestsImpl?: (
    command: string,
    cwd: string,
  ) => Promise<{ passed: boolean; failedTests: string[] }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Tier 1: Structural ───────────────────────────────────────────────────────

/**
 * Tier 1 verifies the change was physically applied: owned files exist, and
 * every declared interface contract is exported from its target file.
 *
 * Answers Steve's Tier-1 question: "Was the change executed?"
 */
export function verifyStructural(
  spec: EngineeringSpec,
  _diff: string,
  worktreePath: string,
): TierResult {
  const evidence: string[] = [];
  const findings: VerifyFinding[] = [];

  for (const wp of spec.workPackages) {
    for (const entry of wp.filesOwned) {
      const filePath = fileOwnedPath(entry);
      const fullPath = join(worktreePath, filePath);
      if (existsSync(fullPath)) {
        evidence.push(`file-exists: ${filePath} (WP ${wp.id})`);
      } else {
        findings.push({
          message: `WP ${wp.id}: owned file ${filePath} does not exist in worktree`,
          file: filePath,
          severity: 'error',
        });
      }
    }
  }

  for (const contract of spec.interfaceContracts) {
    const fullPath = join(worktreePath, contract.file);
    if (!existsSync(fullPath)) {
      findings.push({
        message: `Interface contract '${contract.name}': file ${contract.file} does not exist`,
        file: contract.file,
        severity: 'error',
      });
      continue;
    }

    const content = readFileSync(fullPath, 'utf8');
    // Matches: export [async] function|const|class|type|interface|let|var <name>
    const exportPattern = new RegExp(
      `export\\s+(?:async\\s+)?(?:function|const|class|type|interface|let|var)\\s+${escapeRegex(contract.name)}\\b`,
    );
    // Also matches: export { <name> } re-exports
    const reExportPattern = new RegExp(
      `export\\s+\\{[^}]*\\b${escapeRegex(contract.name)}\\b[^}]*\\}`,
    );

    if (exportPattern.test(content) || reExportPattern.test(content)) {
      evidence.push(`export-found: ${contract.name} in ${contract.file}`);
    } else {
      findings.push({
        message: `Interface contract '${contract.name}' is not exported from ${contract.file}`,
        file: contract.file,
        severity: 'error',
      });
    }
  }

  return {
    tier: 1,
    passed: findings.filter((f) => f.severity === 'error').length === 0,
    evidence,
    findings,
  };
}

// ─── Tier 2: Functional ───────────────────────────────────────────────────────

const BARE_REPO_PATH_PATTERN = /^(?:\.\/)?[\w@./-]+\.[A-Za-z0-9]+$/;
const LAUNCH_ERROR_MARKER = 'GOOSE_VERIFICATION_COMMAND_LAUNCH_ERROR';
const ROOT_WEB_PLAYWRIGHT_PREFIX = 'pnpm exec playwright test apps/web/e2e/';

export function isBareVerificationPath(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  const trimmed = command.trim();
  return !/\s/.test(trimmed) && trimmed.includes('/') && BARE_REPO_PATH_PATTERN.test(trimmed);
}

function commandLauncher(command: string): string {
  return (
    command
      .trim()
      .split(/\s+/)[0]
      ?.replace(/^['"`]/, '')
      .replace(/['"`]$/, '') ?? ''
  );
}

function isLauncherMissing(command: string, output: string): boolean {
  if (output.includes(LAUNCH_ERROR_MARKER)) return true;
  const launcher = commandLauncher(command);
  if (launcher === '') return false;
  const escaped = escapeRegex(launcher);
  return new RegExp(
    `(^|\\n|\\s)(?:sh:\\s+\\d+:\\s+)?${escaped}:\\s+(?:command not found|not found|no such file or directory)`,
    'i',
  ).test(output);
}

function classifyVerificationCommandFailure(
  command: string,
  output: string,
): Pick<VerifyFinding, 'category' | 'code'> {
  const detail = `${command}\n${output}`.toLowerCase();
  if (isBareVerificationPath(command)) {
    return { category: 'verification-infrastructure', code: 'malformed-verification-command' };
  }
  if (
    /(permission denied|eacces)/i.test(detail) &&
    /(?:^|\s|\/)(?:apps|src|core|slices|skills)\/|(?:\.test|\.spec)?\.[cm]?[jt]sx?\b/.test(detail)
  ) {
    return { category: 'verification-infrastructure', code: 'verification-permission-denied' };
  }
  if (isLauncherMissing(command, output)) {
    return { category: 'verification-infrastructure', code: 'verification-runner-missing' };
  }
  if (
    /(no test files found|missing script|err_pnpm_no_script|failed to load config)/i.test(detail)
  ) {
    return { category: 'verification-infrastructure', code: 'verification-harness-config' };
  }
  return { category: 'product' };
}

function normalizeVerificationCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed.startsWith(ROOT_WEB_PLAYWRIGHT_PREFIX)) {
    return command;
  }

  const webSpecAndArgs = trimmed.slice(ROOT_WEB_PLAYWRIGHT_PREFIX.length);
  const specPath = webSpecAndArgs.split(/\s+/, 1)[0] ?? '';
  const packageRelative = `e2e/${webSpecAndArgs}`;

  if (specPath === 'chat.spec.ts') {
    return `pnpm --filter @goose-hub/web exec playwright test --config playwright-chat.config.ts ${packageRelative}`;
  }

  return `pnpm --filter @goose-hub/web exec playwright test ${packageRelative}`;
}

async function defaultRunVerificationCommand(
  command: string,
  worktreePath: string,
  expectedExitCodes: number[],
): Promise<{ passed: boolean; output: string }> {
  if (isBareVerificationPath(command)) {
    return {
      passed: false,
      output: `Malformed verification command: expected an executable command, got bare file path '${command}'`,
    };
  }
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const normalizedCommand = normalizeVerificationCommand(command);
    const child = spawn('sh', ['-c', normalizedCommand], {
      cwd: worktreePath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '1' },
    });
    child.stdout?.on('data', (d: Buffer) => chunks.push(d));
    child.stderr?.on('data', (d: Buffer) => chunks.push(d));
    child.on('exit', (code) => {
      const output = Buffer.concat(chunks).toString('utf8').slice(0, 4096);
      const exitCode = code ?? 1;
      resolve({ passed: expectedExitCodes.includes(exitCode), output });
    });
    child.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      resolve({
        passed: false,
        output: `${LAUNCH_ERROR_MARKER}${code != null ? ` ${code}` : ''}: ${err.message}`,
      });
    });
  });
}

/**
 * Tier 2 runs each declared verification tool and checks exit codes.
 * Answers Steve's Tier-2 question: "Does the new code work?"
 */
export async function verifyFunctional(
  spec: EngineeringSpec,
  worktreePath: string,
  deps: Pick<TierDeps, 'runVerificationCommandImpl'> = {},
): Promise<TierResult> {
  const evidence: string[] = [];
  const findings: VerifyFinding[] = [];
  const runCommand = deps.runVerificationCommandImpl ?? defaultRunVerificationCommand;

  if (spec.verificationTooling.length === 0) {
    evidence.push('no-verification-tooling-declared');
    return { tier: 2, passed: true, evidence, findings };
  }

  for (const tool of spec.verificationTooling) {
    if (typeof tool.command !== 'string' || tool.command.trim() === '') {
      findings.push({
        message: `Verification tool '${tool.name}' is missing executable command`,
        severity: 'error',
        category: 'verification-infrastructure',
        code: 'malformed-verification-command',
      });
      continue;
    }
    const command = normalizeVerificationCommand(tool.command);
    const result = await runCommand(command, worktreePath, tool.expectedExitCodes);
    if (result.passed) {
      evidence.push(`tool-passed: ${tool.name}`);
    } else {
      const classification = classifyVerificationCommandFailure(command, result.output);
      findings.push({
        message: `Verification tool '${tool.name}' failed (command: ${command}): ${result.output.slice(0, 256)}`,
        severity: 'error',
        ...classification,
      });
    }
  }

  return {
    tier: 2,
    passed: findings.filter((f) => f.severity === 'error').length === 0,
    evidence,
    findings,
  };
}

// ─── Tier 3: Regression ───────────────────────────────────────────────────────

function defaultGetLastWpStatus(
  runId: string,
  wpId: string,
): 'ok' | 'failed' | 'in-progress' | null {
  const rows = db
    .select()
    .from(wpIterations)
    .where(and(eq(wpIterations.runId, runId), eq(wpIterations.wpId, wpId)))
    .orderBy(desc(wpIterations.iteration))
    .limit(1)
    .all();
  return (rows[0]?.status as 'ok' | 'failed' | 'in-progress' | null) ?? null;
}

function extractFailedTests(output: string): string[] {
  const failed: string[] = [];
  for (const line of output.split('\n')) {
    const t = line.trim();
    if ((t.includes('FAIL') || t.includes('✗') || t.includes('× ')) && t.length < 200) {
      failed.push(t);
    }
  }
  return failed.slice(0, 20);
}

async function defaultRunRegressionTests(
  command: string,
  cwd: string,
): Promise<{ passed: boolean; failedTests: string[] }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const child = spawn('sh', ['-c', command], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
    });
    child.stdout?.on('data', (d: Buffer) => chunks.push(d));
    child.stderr?.on('data', (d: Buffer) => chunks.push(d));
    child.on('exit', (code) => {
      const output = Buffer.concat(chunks).toString('utf8');
      resolve({ passed: (code ?? 1) === 0, failedTests: extractFailedTests(output) });
    });
    child.on('error', (err) => {
      resolve({ passed: false, failedTests: [err.message] });
    });
  });
}

/**
 * Tier 3 runs the full regression suite and checks carry-forward failures.
 * Answers Steve's Tier-3 question: "Did anything else break?"
 *
 * Carry-forward rule (03-lifecycle-harness.md:224-225): a WP whose last
 * recorded status in wp_iterations is 'ok' must stay ok in the next
 * iteration. If the test suite fails, any previously-ok WP is implicated.
 */
export async function verifyRegression(
  spec: EngineeringSpec,
  runArtifacts: RunArtifacts,
  deps: TierDeps = {},
): Promise<TierResult> {
  const evidence: string[] = [];
  const findings: VerifyFinding[] = [];
  const getStatus = deps.getLastWpStatusImpl ?? defaultGetLastWpStatus;
  const runTests = deps.runRegressionTestsImpl ?? defaultRunRegressionTests;
  const policy = runArtifacts.regressionPolicy ?? 'escalate';

  const previouslyOkWpIds = spec.workPackages
    .map((wp) => wp.id)
    .filter((id) => getStatus(runArtifacts.runId, id) === 'ok');

  if (previouslyOkWpIds.length > 0) {
    evidence.push(`carry-forward-ok-wps: ${previouslyOkWpIds.join(', ')}`);
  }

  const testCommand = runArtifacts.testCommand ?? 'pnpm test';
  const testResult = await runTests(testCommand, runArtifacts.worktreePath);

  if (testResult.passed) {
    evidence.push(`test-suite-passed: ${testCommand}`);
  } else {
    const sev = policy === 'ignore' ? 'warning' : 'error';
    const failList = testResult.failedTests;
    if (failList.length > 0) {
      for (const ft of failList) {
        findings.push({ message: `Regression [${policy}]: ${ft}`, severity: sev });
      }
    } else {
      findings.push({
        message: `Test suite exited non-zero [policy: ${policy}]`,
        severity: sev,
      });
    }
  }

  return {
    tier: 3,
    passed: findings.filter((f) => f.severity === 'error').length === 0,
    evidence,
    findings,
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

const TIER_NAME = { 1: 'structural', 2: 'functional', 3: 'regression' } as const;

/**
 * Run a single verification tier and emit the appropriate event.
 * Orchestrator calls this sequentially (1 → 2 → 3) and stops on first failure.
 */
export async function runTier(
  tier: 1 | 2 | 3,
  spec: EngineeringSpec,
  runArtifacts: RunArtifacts,
  deps: TierDeps = {},
): Promise<TierResult> {
  let result: TierResult;

  if (tier === 1) {
    result = verifyStructural(spec, runArtifacts.diff ?? '', runArtifacts.worktreePath);
  } else if (tier === 2) {
    result = await verifyFunctional(spec, runArtifacts.worktreePath, deps);
  } else {
    result = await verifyRegression(spec, runArtifacts, deps);
  }

  if (deps.appendEvent) {
    const passKind =
      tier === 1
        ? 'qa.structural-passed'
        : tier === 2
          ? 'qa.functional-passed'
          : 'qa.regression-passed';
    const failKind =
      tier === 1
        ? 'qa.structural-failed'
        : tier === 2
          ? 'qa.functional-failed'
          : 'qa.regression-failed';

    deps.appendEvent({
      projectId: runArtifacts.projectId,
      workItemId: runArtifacts.workItemId ?? null,
      kind: result.passed ? passKind : failKind,
      payload: {
        tier: TIER_NAME[tier],
        tierNumber: tier,
        evidence: result.evidence,
        findingCount: result.findings.length,
        runId: runArtifacts.runId,
      },
      runId: runArtifacts.runId,
    });
  }

  return result;
}
