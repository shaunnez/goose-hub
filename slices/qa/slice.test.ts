import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentResult } from '@goose-hub/core/agent-runtime/interface.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerifyCommand } from './workflow.js';

// ─── module mocks ─────────────────────────────────────────────────────────────

vi.mock('@goose-hub/core/db/repositories/project-settings.js', () => ({
  getQaE2eMode: vi.fn((_projectId: string, configDefault = 'off') => configDefault),
  readProjectSettings: vi.fn().mockReturnValue(null),
  readProjectSkillSettings: vi.fn().mockReturnValue(new Map()),
}));

const mockGetEngineeringSpec = vi.fn().mockReturnValue(null);
vi.mock('@goose-hub/core/engineering-specs/repository.js', () => ({
  getEngineeringSpec: (...args: unknown[]) => mockGetEngineeringSpec(...args),
}));
const mockAccumulatePersonaStats = vi.fn();
vi.mock('@goose-hub/core/persona/accumulate.js', () => ({
  accumulatePersonaStats: (...args: unknown[]) => mockAccumulatePersonaStats(...args),
}));

const mockGetProjectBySlug = vi.fn().mockReturnValue(null);
vi.mock('@goose-hub/core/projects/loader.js', () => ({
  getProjectBySlug: (...args: unknown[]) => mockGetProjectBySlug(...args),
}));

const mockFindFreePort = vi.fn();
vi.mock('@goose-hub/core/agent-runtime/find-free-port.js', () => ({
  findFreePort: () => mockFindFreePort(),
}));

const mockRun = vi.fn();

vi.mock('@goose-hub/core/agent-runtime/claude-cli.js', () => ({
  ClaudeCliRuntime: vi.fn().mockImplementation(() => ({ run: mockRun })),
}));

vi.mock('@goose-hub/core/agent-runtime/schema-bridge.js', () => ({
  toJsonSchema: vi.fn().mockReturnValue({}),
}));

vi.mock('@goose-hub/core/agent-runtime/select-persona.js', () => ({
  selectPersona: vi
    .fn()
    .mockReturnValue({ personaId: 'test-project/qa/0', codename: 'Grey Honker' }),
}));

const mockReplay = vi.fn().mockReturnValue([]);

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi
      .fn()
      .mockReturnValue({ id: 1, kind: 'qa.completed', payload: {}, createdAt: '' }),
    replay: (...args: unknown[]) => mockReplay(...args),
  },
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn().mockReturnValue('# mock prompt') };
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:owner/repo#42',
    externalId: '42',
    repoRef: 'owner/repo',
    title: 'Test issue',
    body: '## Acceptance criteria\n- [ ] Add foo',
    type: 'feature',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:needs-qa',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date(),
    ...overrides,
  };
}

function makePassResult(): AgentResult {
  return {
    output: {
      verdict: 'pass',
      overallScore: 85,
      threshold: 70,
      tierResults: {
        structural: { passed: true, findings: [] },
        functional: { passed: true, findings: [] },
        regression: { passed: true, findings: [] },
      },
      qualityScores: {
        openClosed: 17,
        conceptCount: 12,
        timeToCapability: 13,
        complecting: 14,
        loc: 9,
        coupling: 9,
        gallsLaw: 9,
        cyclomaticComplexity: 4,
      },
      findings: [],
      decisionSummaries: [],
    },
    decisionSummaries: [],
    events: [],
  };
}

function makeSampleTestRun() {
  return {
    wallTimeMs: 7700,
    total: 39,
    passed: 38,
    failed: 1,
    skipped: 0,
    success: false,
    suites: [
      {
        name: 'cart.test.ts',
        filePath: 'core/cart.test.ts',
        total: 18,
        passed: 17,
        failed: 1,
        skipped: 0,
        durationMs: 412,
        status: 'failed' as const,
      },
    ],
  };
}

function makeFailingTestRun(failingSuites: string[]) {
  return {
    wallTimeMs: 7700,
    total: 40,
    passed: 39,
    failed: 1,
    skipped: 0,
    success: false,
    suites: failingSuites.map((filePath) => ({
      name: filePath.split('/').pop() ?? filePath,
      filePath,
      total: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
      durationMs: 412,
      status: 'failed' as const,
    })),
  };
}

function makeGitWorktreeWithChange(changedPath: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'qa-actionability-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  const fullPath = join(dir, changedPath);
  const changedPathParts = changedPath.split('/');
  mkdirSync(join(dir, ...changedPathParts.slice(0, -1)), { recursive: true });
  writeFileSync(fullPath, 'export const before = 1;\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'base'], { cwd: dir });
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: dir });
  writeFileSync(fullPath, 'export const after = 2;\n');
  execFileSync('git', ['add', changedPath], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'change'], { cwd: dir });
  return dir;
}

function makeFailResult(): AgentResult {
  return {
    output: {
      verdict: 'fail',
      overallScore: 45,
      threshold: 70,
      tierResults: {
        structural: {
          passed: false,
          findings: [
            {
              tier: 'structural',
              severity: 'error',
              description: 'lint error',
              disposition: 'needs-fix',
              dispositionRef: 'current PR',
            },
          ],
        },
        functional: { passed: false, findings: [] },
        regression: { passed: true, findings: [] },
      },
      qualityScores: {
        openClosed: 5,
        conceptCount: 5,
        timeToCapability: 5,
        complecting: 5,
        loc: 5,
        coupling: 5,
        gallsLaw: 5,
        cyclomaticComplexity: 4,
      },
      findings: [],
      decisionSummaries: [],
    },
    decisionSummaries: [],
    events: [],
  };
}

function makeQaFailResultWithFinding(input: {
  tier: 'functional' | 'regression';
  description: string;
}): AgentResult {
  const finding = {
    tier: input.tier,
    severity: 'error' as const,
    description: input.description,
    disposition: 'needs-fix' as const,
    dispositionRef: 'current PR',
  };
  return {
    output: {
      verdict: 'fail',
      overallScore: 45,
      threshold: 70,
      tierResults: {
        structural: { passed: true, findings: [] },
        functional: {
          passed: input.tier !== 'functional',
          findings: input.tier === 'functional' ? [finding] : [],
        },
        regression: {
          passed: input.tier !== 'regression',
          findings: input.tier === 'regression' ? [finding] : [],
        },
      },
      qualityScores: {
        openClosed: 5,
        conceptCount: 5,
        timeToCapability: 5,
        complecting: 5,
        loc: 5,
        coupling: 5,
        gallsLaw: 5,
        cyclomaticComplexity: 4,
      },
      findings: [finding],
      decisionSummaries: [],
    },
    decisionSummaries: [],
    events: [],
  };
}

function makePartialHighResult(): AgentResult {
  return {
    output: {
      verdict: 'partial',
      overallScore: 72,
      threshold: 70,
      tierResults: {
        structural: { passed: true, findings: [] },
        functional: { passed: false, findings: [] },
        regression: { passed: true, findings: [] },
      },
      qualityScores: {
        openClosed: 15,
        conceptCount: 10,
        timeToCapability: 12,
        complecting: 12,
        loc: 7,
        coupling: 7,
        gallsLaw: 7,
        cyclomaticComplexity: 2,
      },
      findings: [],
      decisionSummaries: [],
    },
    decisionSummaries: [],
    events: [],
  };
}

function makePartialLowResult(): AgentResult {
  return {
    output: {
      verdict: 'partial',
      overallScore: 65,
      threshold: 70,
      tierResults: {
        structural: { passed: false, findings: [] },
        functional: { passed: false, findings: [] },
        regression: { passed: true, findings: [] },
      },
      qualityScores: {
        openClosed: 10,
        conceptCount: 8,
        timeToCapability: 10,
        complecting: 10,
        loc: 6,
        coupling: 6,
        gallsLaw: 6,
        cyclomaticComplexity: 5,
      },
      findings: [],
      decisionSummaries: [],
    },
    decisionSummaries: [],
    events: [],
  };
}

function makeMockSource(overrides: Partial<StateSource> = {}): StateSource {
  return {
    projectId: 'test-project',
    repoRef: 'owner/repo',
    listOpenWork: vi.fn().mockResolvedValue([]),
    listClosedWorkByMilestone: vi.fn().mockResolvedValue([]),
    listWorkByMilestone: vi.fn().mockResolvedValue([]),
    getItem: vi.fn(),
    listMilestones: vi.fn().mockResolvedValue([]),
    getActiveMilestone: vi.fn().mockResolvedValue(null),
    transitionState: vi.fn().mockResolvedValue(undefined),
    forceState: vi.fn().mockResolvedValue(undefined),
    comment: vi.fn().mockResolvedValue(undefined),
    listComments: vi.fn().mockResolvedValue([]),
    setMilestone: vi.fn().mockResolvedValue(undefined),
    setLabelInGroup: vi.fn().mockResolvedValue(undefined),
    attach: vi.fn().mockResolvedValue(undefined),
    createIssue: vi.fn(),
    createMilestone: vi.fn(),
    updateMilestone: vi.fn(),
    deleteMilestone: vi.fn(),
    getPrDiff: vi.fn().mockResolvedValue(''),
    addLabels: vi.fn(),
    removeLabel: vi.fn(),
    listLabels: vi.fn().mockResolvedValue([]),
    watchForUpdates: vi.fn(),
    ...overrides,
  };
}

// ─── test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  mockRun.mockReset();
  mockReplay.mockReset();
  mockReplay.mockReturnValue([]);
  mockAccumulatePersonaStats.mockClear();
  mockGetEngineeringSpec.mockReset();
  mockGetEngineeringSpec.mockReturnValue(null);
  mockGetProjectBySlug.mockReset();
  mockGetProjectBySlug.mockReturnValue(null);
  vi.clearAllMocks();
  mockFindFreePort.mockResolvedValueOnce(4173).mockResolvedValueOnce(4301);
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('qa helpers', () => {
  it('caps oversized PR diffs before they are sent to the agent prompt', async () => {
    const { QA_PR_DIFF_CHAR_LIMIT, capPrDiffForPrompt } = await import('./qa-helpers.js');
    const largeDiff = `diff --git a/file b/file\n${'x'.repeat(QA_PR_DIFF_CHAR_LIMIT * 2)}`;

    const capped = capPrDiffForPrompt(largeDiff, '/tmp/worktree');

    expect(capped).toContain('QA diff truncated');
    expect(capped.length).toBeLessThan(largeDiff.length);
    expect(capped).toContain(`First ${QA_PR_DIFF_CHAR_LIMIT} characters`);
  });

  it('reads baseBranch from the latest pr.opened payload', async () => {
    mockReplay.mockReturnValue([
      {
        id: 1,
        kind: 'pr.opened',
        payload: { worktreePath: '/wt/abc', baseBranch: 'develop' },
        createdAt: '',
      },
    ]);

    const { findPrOpenedHints } = await import('./qa-helpers.js');

    expect(findPrOpenedHints('github:owner/repo#42')).toMatchObject({
      worktreePath: '/wt/abc',
      baseBranch: 'develop',
    });
  });

  it('reads pipelineRunId from a legacy fix-issue pr.opened payload', async () => {
    mockReplay.mockReturnValue([
      {
        id: 1,
        kind: 'pr.opened',
        payload: {
          worktreePath: '/wt/legacy',
          devRunId: 'legacy-dev-run',
          pipelineRunId: 'legacy-dev-run',
        },
        createdAt: '',
      },
    ]);

    const { findPrOpenedHints } = await import('./qa-helpers.js');

    expect(findPrOpenedHints('github:owner/repo#42')).toMatchObject({
      devRunId: 'legacy-dev-run',
      pipelineRunId: 'legacy-dev-run',
    });
  });

  it('classifies significant UI changes from changed file paths', async () => {
    const { classifyUiChanges } = await import('./qa-helpers.js');

    expect(
      classifyUiChanges(['apps/web/src/components/detail/TimelineEvents.tsx'])
        .hasSignificantUiChange,
    ).toBe(true);
    expect(
      classifyUiChanges(['docs/readme.md', 'apps/web/e2e/issue-42.spec.ts']).hasSignificantUiChange,
    ).toBe(false);
  });
});

describe('verification summary harness', () => {
  function makeGitFixture(): string {
    const dir = mkdtempSync(join(tmpdir(), 'qa-summary-'));
    execFileSync('git', ['init'], { cwd: dir });
    mkdirSync(join(dir, 'apps/web/src'), { recursive: true });
    writeFileSync(join(dir, 'apps/web/src/foo.ts'), 'export const foo = 1;\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'tag.gpgsign=false',
        'commit',
        '-m',
        'base',
      ],
      { cwd: dir },
    );
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: dir });
    writeFileSync(join(dir, 'apps/web/src/foo.ts'), 'export const foo = 2;\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'tag.gpgsign=false',
        'commit',
        '-m',
        'change',
      ],
      { cwd: dir },
    );
    return dir;
  }

  it('builds changed-file, diff-stat, command, test, e2e, evidence, and dev-test metadata', async () => {
    const dir = makeGitFixture();
    try {
      const { buildVerificationSummary } = await import('./verification-summary.js');
      const sampleTestRun = makeSampleTestRun();
      const runCommand = vi.fn(async (_cwd: string, command: string) => ({
        command,
        status: 'passed' as const,
      }));

      const result = await buildVerificationSummary({
        workspaceDir: dir,
        prHints: { baseBranch: 'main', prNumber: 99, prHeadSha: 'abc1234' },
        prDiff: 'diff --git a/apps/web/src/foo.ts b/apps/web/src/foo.ts\n+export const foo = 2;\n',
        qaE2eMode: 'ui-changed',
        configuredE2eCommand: 'pnpm test:e2e:pipeline',
        commands: {
          lintCommand: 'pnpm lint',
          typecheckCommand: 'pnpm typecheck',
          testCommand: 'pnpm test --reporter=json',
        },
        priorEvents: [
          {
            id: 1,
            projectId: 'test-project',
            workItemId: 'github:owner/repo#42',
            kind: 'evidence.posted',
            payload: {
              commentUrl: 'https://github.com/owner/repo/issues/42#issuecomment-1',
              screenshots: ['evidence/issue-42/step-1.png'],
              gifPath: null,
              commitSha: 'abc1234',
            },
            createdAt: '',
          },
        ],
        devTestsRun: { command: 'pnpm vitest src/foo.test.ts', paths: ['src/foo.test.ts'] },
        runTests: vi.fn().mockResolvedValue(sampleTestRun),
        runCommand,
      });

      expect(result.verificationSummary.changedFiles.paths).toEqual(['apps/web/src/foo.ts']);
      expect(result.verificationSummary.changedFiles.count).toBe(1);
      expect(result.verificationSummary.changedFiles.diffCharCount).toBeGreaterThan(0);
      expect(result.verificationSummary.changedFiles.diffStat).toContain('apps/web/src/foo.ts');
      expect(result.verificationSummary.pr).toEqual({
        number: 99,
        baseBranch: 'main',
        headSha: 'abc1234',
      });
      expect(result.verificationSummary.commands.lint?.status).toBe('passed');
      expect(result.verificationSummary.commands.typecheck?.status).toBe('passed');
      expect(result.verificationSummary.testRun?.failed).toBe(1);
      expect(result.verificationSummary.testRun?.failingSuites).toEqual(['core/cart.test.ts']);
      expect(result.verificationSummary.e2e.command).toBe('pnpm test:e2e:pipeline');
      expect(result.verificationSummary.e2e.status).toBe('passed');
      expect(result.verificationSummary.commands.e2e).toEqual({
        command: 'pnpm test:e2e:pipeline',
        status: 'passed',
      });
      expect(result.verificationSummary.evidence.status).toBe('posted');
      expect(result.verificationSummary.evidence).toMatchObject({
        screenshots: ['evidence/issue-42/step-1.png'],
        gifPath: null,
        commitSha: 'abc1234',
      });
      expect(result.verificationSummary.devTestsRun?.paths).toEqual(['src/foo.test.ts']);
      expect(runCommand).toHaveBeenNthCalledWith(3, dir, 'pnpm test:e2e:pipeline', undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('emits bounded preflight step events for pass, fail, and skip decisions', async () => {
    const dir = makeGitFixture();
    try {
      const { buildVerificationSummary } = await import('./verification-summary.js');
      const onStep = vi.fn();
      const runCommand = vi.fn(async (_cwd: string, command: string) => ({
        command,
        status: command === 'pnpm typecheck' ? ('failed' as const) : ('passed' as const),
        ...(command === 'pnpm typecheck' ? { exitCode: 2, stderr: 'type error details' } : {}),
        durationMs: 123,
      }));

      await buildVerificationSummary({
        workspaceDir: dir,
        prHints: { baseBranch: 'main' },
        prDiff: '',
        qaE2eMode: 'off',
        commands: {
          lintCommand: 'pnpm lint',
          typecheckCommand: 'pnpm typecheck',
          testCommand: 'pnpm test --reporter=json',
        },
        priorEvents: [],
        runTests: vi.fn().mockResolvedValue(makeSampleTestRun()),
        runCommand,
        onStep,
      });

      expect(onStep).toHaveBeenCalledWith({
        step: 'lint',
        command: 'pnpm lint',
        status: 'running',
      });
      expect(onStep).toHaveBeenCalledWith({
        step: 'lint',
        command: 'pnpm lint',
        status: 'passed',
        durationMs: 123,
      });
      expect(onStep).toHaveBeenCalledWith({
        step: 'typecheck',
        command: 'pnpm typecheck',
        status: 'failed',
        durationMs: 123,
        exitCode: 2,
      });
      expect(onStep).toHaveBeenCalledWith({
        step: 'test',
        command: 'pnpm test --reporter=json',
        status: 'failed',
        durationMs: 7700,
      });
      expect(onStep).toHaveBeenCalledWith({
        step: 'e2e',
        status: 'skipped',
        reason: 'qa e2e disabled by project setting',
      });
      expect(onStep).toHaveBeenCalledWith(
        expect.objectContaining({
          step: 'evidence',
          status: 'skipped',
        }),
      );
      expect(JSON.stringify(onStep.mock.calls)).not.toContain('type error details');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reflects failed workflow-owned e2e in command and summary status', async () => {
    const dir = makeGitFixture();
    try {
      const { buildVerificationSummary } = await import('./verification-summary.js');
      const runCommand = vi.fn(async (_cwd: string, command: string) => ({
        command,
        status: 'failed' as const,
        exitCode: 1,
        stderr: 'browser failed to render route',
      }));

      const result = await buildVerificationSummary({
        workspaceDir: dir,
        prHints: { baseBranch: 'main' },
        prDiff: 'diff',
        qaE2eMode: 'ui-changed',
        configuredE2eCommand: 'pnpm test:e2e:pipeline',
        commands: { testCommand: 'pnpm test --reporter=json' },
        priorEvents: [],
        runTests: vi.fn().mockResolvedValue(makeSampleTestRun()),
        runCommand,
      });

      expect(result.verificationSummary.commands.e2e).toMatchObject({
        command: 'pnpm test:e2e:pipeline',
        status: 'failed',
        exitCode: 1,
        stderr: 'browser failed to render route',
      });
      expect(result.verificationSummary.e2e).toMatchObject({
        command: 'pnpm test:e2e:pipeline',
        status: 'failed',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes command env through to workflow-owned e2e execution', async () => {
    const dir = makeGitFixture();
    try {
      const { buildVerificationSummary } = await import('./verification-summary.js');
      const runCommand = vi.fn(async (_cwd: string, command: string) => ({
        command,
        status: 'passed' as const,
      }));

      await buildVerificationSummary({
        workspaceDir: dir,
        prHints: { baseBranch: 'main' },
        prDiff: 'diff',
        qaE2eMode: 'ui-changed',
        configuredE2eCommand: 'pnpm test:e2e:pipeline',
        commandEnv: {
          WEB_PORT: '4173',
          API_PORT: '4301',
          MOCK_SERVER_PORT: '4301',
          SERVER_PORT: '4301',
          CI: 'true',
        },
        commands: { testCommand: 'pnpm test --reporter=json' },
        priorEvents: [],
        runTests: vi.fn().mockResolvedValue(makeSampleTestRun()),
        runCommand,
      });

      expect(runCommand).toHaveBeenCalledWith(
        dir,
        'pnpm test:e2e:pipeline',
        expect.objectContaining({
          env: expect.objectContaining({
            WEB_PORT: '4173',
            API_PORT: '4301',
            MOCK_SERVER_PORT: '4301',
            SERVER_PORT: '4301',
            CI: 'true',
          }),
        }),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('captures bounded stdout and stderr tails for failed command summaries', async () => {
    const { defaultRunCommand } = await import('./verification-summary.js');

    const result = await defaultRunCommand(
      process.cwd(),
      "node -e \"console.log('x'.repeat(5000)); console.error('browser failed'); process.exit(2)\"",
    );

    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(2);
    expect(result.stdout?.length).toBeLessThanOrEqual(4000);
    expect(result.stdout).toContain('x');
    expect(result.stderr).toContain('browser failed');
  });

  it('omits compact testRun and marks test command skipped when capture returns null', async () => {
    const dir = makeGitFixture();
    try {
      const { buildVerificationSummary } = await import('./verification-summary.js');
      const runTests = vi.fn().mockResolvedValue(null);

      const result = await buildVerificationSummary({
        workspaceDir: dir,
        prHints: { baseBranch: 'main' },
        prDiff: '',
        qaE2eMode: 'off',
        commands: { testCommand: 'pnpm test --reporter=json' },
        priorEvents: [],
        runTests,
      });

      expect(runTests).toHaveBeenCalledWith(dir, 'pnpm test --reporter=json');
      expect(result.testRun).toBeNull();
      expect(result.verificationSummary.commands.test).toMatchObject({
        command: 'pnpm test --reporter=json',
        status: 'skipped',
        error: 'test command did not produce structured output',
      });
      expect(result.verificationSummary.testRun).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('degrades thrown test capture errors to skipped command metadata', async () => {
    const dir = makeGitFixture();
    try {
      const { buildVerificationSummary } = await import('./verification-summary.js');

      const result = await buildVerificationSummary({
        workspaceDir: dir,
        prHints: { baseBranch: 'main' },
        prDiff: '',
        qaE2eMode: 'off',
        commands: { testCommand: 'pnpm test --reporter=json' },
        priorEvents: [],
        runTests: vi.fn().mockRejectedValue(new Error('report file missing\nat runner.ts:1')),
      });

      expect(result.testRun).toBeNull();
      expect(result.verificationSummary.commands.test).toMatchObject({
        status: 'skipped',
        error: 'report file missing at runner.ts:1',
      });
      expect(result.verificationSummary.testRun).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips incompatible structured test capture without invoking the test runner', async () => {
    const dir = makeGitFixture();
    try {
      const { buildVerificationSummary } = await import('./verification-summary.js');
      const runTests = vi.fn();

      const result = await buildVerificationSummary({
        workspaceDir: dir,
        prHints: { baseBranch: 'main' },
        prDiff: '',
        qaE2eMode: 'off',
        commands: { testCommand: 'go test ./...' },
        priorEvents: [],
        testCapture: {
          enabled: false,
          reason: 'structured test capture requires a Vitest-compatible Node command',
        },
        runTests,
      });

      expect(runTests).not.toHaveBeenCalled();
      expect(result.verificationSummary.commands.test).toMatchObject({
        command: 'go test ./...',
        status: 'skipped',
        error: 'structured test capture requires a Vitest-compatible Node command',
      });
      expect(result.verificationSummary.testRun).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes configured timeout to compact lint and typecheck commands', async () => {
    const dir = makeGitFixture();
    try {
      const { buildVerificationSummary } = await import('./verification-summary.js');
      const runCommand = vi.fn(async (_cwd: string, command: string) => ({
        command,
        status: 'passed' as const,
      }));

      await buildVerificationSummary({
        workspaceDir: dir,
        prHints: { baseBranch: 'main' },
        prDiff: '',
        qaE2eMode: 'off',
        commandTimeoutMs: 420_000,
        commands: {
          lintCommand: 'pnpm lint',
          typecheckCommand: 'pnpm typecheck',
          testCommand: 'pnpm test --reporter=json',
        },
        priorEvents: [],
        runTests: vi.fn().mockResolvedValue(makeSampleTestRun()),
        runCommand,
      });

      expect(runCommand).toHaveBeenNthCalledWith(1, dir, 'pnpm lint', { timeoutMs: 420_000 });
      expect(runCommand).toHaveBeenNthCalledWith(2, dir, 'pnpm typecheck', {
        timeoutMs: 420_000,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('summarizes failed evidence without copying non-operational payload fields', async () => {
    const { buildVerificationSummary } = await import('./verification-summary.js');

    const result = await buildVerificationSummary({
      prHints: {},
      prDiff: '',
      qaE2eMode: 'off',
      commands: { testCommand: 'pnpm test --reporter=json' },
      priorEvents: [
        {
          id: 1,
          projectId: 'test-project',
          workItemId: 'github:owner/repo#42',
          kind: 'evidence.post-failed',
          payload: {
            error: 'spawn failed\nat internal/path.ts:1',
            developerReasoning: 'root cause analysis should not leak',
          },
          createdAt: '',
        },
      ],
      runTests: vi.fn(),
      runCommand: vi.fn(),
    });

    expect(result.verificationSummary.evidence).toEqual({
      status: 'failed',
      error: 'spawn failed at internal/path.ts:1',
    });
    expect(JSON.stringify(result.verificationSummary)).not.toContain('root cause analysis');
  });

  it('explains absent evidence when no evidence workflow event was recorded', async () => {
    const { buildVerificationSummary } = await import('./verification-summary.js');

    const result = await buildVerificationSummary({
      prHints: {},
      prDiff: '',
      qaE2eMode: 'off',
      commands: { testCommand: 'pnpm test --reporter=json' },
      priorEvents: [],
      runTests: vi.fn(),
      runCommand: vi.fn(),
    });

    expect(result.verificationSummary.evidence).toEqual({
      status: 'absent',
      reason:
        'no evidence event was recorded; no evidence spec was declared or the evidence workflow did not run',
    });
  });
});

describe('runQaWorkflow', () => {
  describe('qa output validation failure', () => {
    it('transitions to needs-human when QA output schema validation fails', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce({
        output: { bad: 'data', missing: 'required' },
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:needs-human',
      );
    });

    it('emits agent.run-failed when QA output schema validation fails', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce({
        output: { invalid: true },
        decisionSummaries: [],
        events: [],
      } satisfies AgentResult);

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      const failed = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'agent.run-failed');
      expect(failed).toBeDefined();
    });
  });

  describe('tier failure events', () => {
    it('emits qa.structural-failed when structural tier fails', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeFailResult());

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      const structuralFailed = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'qa.structural-failed');
      expect(structuralFailed).toBeDefined();
    });

    it('emits qa.functional-failed when functional tier fails', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeFailResult());

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      const functionalFailed = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'qa.functional-failed');
      expect(functionalFailed).toBeDefined();
    });

    it('does NOT emit qa.structural-failed when structural tier passes', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      const structuralFailed = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'qa.structural-failed');
      expect(structuralFailed).toBeUndefined();
    });

    it('emits qa.completed with full payload including qualityScores on pass', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      const completed = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'qa.completed');
      expect(completed).toBeDefined();
      const payload = completed?.[0].payload as Record<string, unknown>;
      expect(payload.verdict).toBe('pass');
      expect(payload.qualityScores).toBeDefined();
    });

    it('classifies actionable QA findings as product failures on qa.completed', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      const productFailure = makePassResult();
      productFailure.output = {
        ...(productFailure.output as Record<string, unknown>),
        verdict: 'fail',
        overallScore: 60,
        findings: [
          {
            tier: 'functional',
            severity: 'error',
            description: 'User cannot save the form',
            disposition: 'needs-fix',
            dispositionRef: 'current PR',
          },
        ],
      };
      mockRun.mockResolvedValueOnce(productFailure);

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      const completed = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'qa.completed');
      expect(completed?.[0].payload).toMatchObject({
        verdict: 'fail',
        failureCategory: 'product',
      });
    });

    it('emits agent.decision-summary per decisionSummary entry', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      const resultWithSummaries: AgentResult = {
        output: {
          ...(makePassResult().output as object),
          decisionSummaries: [
            { kind: 'PLAN', summary: 'passed lint' },
            { kind: 'PLAN', summary: 'tests passed' },
          ],
        },
        decisionSummaries: [],
        events: [],
      };
      mockRun.mockResolvedValueOnce(resultWithSummaries);

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      const decisionEvents = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.filter(
          ([e]) =>
            e.kind === 'agent.decision-summary' && (e.payload as { skill?: string }).skill === 'qa',
        );
      expect(decisionEvents).toHaveLength(2);
    });
  });

  describe('pass verdict', () => {
    it('transitions state to factory:needs-review on pass', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:needs-review',
      );
      expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
        personaName: 'test-project/qa/0',
        role: 'qa',
        outcome: 'success',
        qualityScore: 0.85,
      });
    });

    it('posts a comment on pass verdict', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.comment).toHaveBeenCalledWith('42', expect.any(String));
    });
  });

  describe('fail verdict', () => {
    async function runActionabilityWorkflowCase(input: {
      changedPath: string;
      qaResult: AgentResult;
      testRun?: ReturnType<typeof makeFailingTestRun> | ReturnType<typeof makeSampleTestRun>;
      e2e?: {
        status: 'passed' | 'failed';
        error?: string;
        stderr?: string;
      };
      executableChecks?: VerifyCommand[];
    }) {
      const item = makeWorkItem();
      const source = makeMockSource();
      const worktree = makeGitWorktreeWithChange(input.changedPath);
      mockGetProjectBySlug.mockReturnValue({
        id: 'test-project',
        stack: {
          testCommand: 'pnpm test --reporter=json',
          lintCommand: 'pnpm lint',
          e2eCommand: 'pnpm test:e2e:pipeline',
        },
        qaE2eMode: 'always',
      });
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: worktree, baseBranch: 'main' },
          createdAt: '',
        },
      ]);
      mockRun.mockResolvedValueOnce(input.qaResult);

      try {
        const { runQaWorkflow } = await import('./workflow.js');
        await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
          runTests: vi.fn().mockResolvedValue(input.testRun ?? null),
          runCommand: vi.fn(async (_cwd, command) => {
            if (command === 'pnpm test:e2e:pipeline') {
              return {
                command,
                status: input.e2e?.status ?? 'passed',
                ...(input.e2e?.error != null ? { error: input.e2e.error } : {}),
                ...(input.e2e?.stderr != null ? { stderr: input.e2e.stderr } : {}),
              };
            }
            return { command, status: 'passed' as const };
          }),
          ...(input.executableChecks != null ? { executableChecks: input.executableChecks } : {}),
        });
        return source;
      } finally {
        rmSync(worktree, { recursive: true, force: true });
      }
    }

    it('transitions state to factory:qa-failed on fail', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeFailResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:qa-failed',
      );
      expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
        personaName: 'test-project/qa/0',
        role: 'qa',
        outcome: 'failure',
        qualityScore: expect.any(Number),
      });
    });

    it('routes fail verdict with only out-of-scope findings to factory:needs-review', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce({
        ...makePassResult(),
        output: {
          ...(makePassResult().output as Record<string, unknown>),
          verdict: 'fail',
          findings: [
            {
              tier: 'functional',
              severity: 'error',
              description: 'Pre-existing visual issue',
              disposition: 'out-of-scope',
              dispositionRef: 'Not touched by this issue',
            },
          ],
        },
      });

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:needs-review',
      );
    });

    it('keeps fail verdicts without non-blocking findings in factory:qa-failed', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce({
        ...makePassResult(),
        output: {
          ...(makePassResult().output as Record<string, unknown>),
          verdict: 'fail',
          overallScore: 20,
          threshold: 70,
          findings: [],
        },
      });

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:qa-failed',
      );
    });

    it('routes unrelated broad unit failure plus broad e2e timeout to factory:needs-review', async () => {
      const source = await runActionabilityWorkflowCase({
        changedPath: 'core/qa/actionability.ts',
        qaResult: makeQaFailResultWithFinding({
          tier: 'regression',
          description: 'Broad e2e timed out and unrelated full-suite test failed',
        }),
        testRun: makeFailingTestRun(['apps/web/src/components/unrelated/UnrelatedPanel.test.tsx']),
        e2e: {
          status: 'failed',
          error: 'command timed out after 900000ms',
          stderr: 'Timed out while running apps/web/e2e/pipeline/settings-panel.spec.ts',
        },
      });

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:needs-review',
      );
    });

    it('routes changed-surface test failures to factory:qa-failed', async () => {
      const source = await runActionabilityWorkflowCase({
        changedPath: 'core/qa/actionability.ts',
        qaResult: makeQaFailResultWithFinding({
          tier: 'functional',
          description: 'Actionability unit test failed',
        }),
        testRun: makeFailingTestRun(['core/qa/actionability.test.ts']),
      });

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:qa-failed',
      );
    });

    it('routes failed executable AC checks to factory:qa-failed', async () => {
      const source = await runActionabilityWorkflowCase({
        changedPath: 'core/qa/actionability.ts',
        qaResult: makePassResult(),
        testRun: {
          ...makeSampleTestRun(),
          failed: 0,
          passed: 39,
          success: true,
          suites: [],
        },
        executableChecks: [
          {
            criterionId: 'AC-1',
            checkId: 'AC-1-check-1',
            ac: 'Actionability command passes',
            command: 'false',
            expectedExitCodes: [0],
          },
        ],
      });

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:qa-failed',
      );
    });

    it('routes broad e2e output naming a changed surface to factory:qa-failed', async () => {
      const source = await runActionabilityWorkflowCase({
        changedPath: 'apps/web/src/components/chrome/TopBar.tsx',
        qaResult: makeQaFailResultWithFinding({
          tier: 'regression',
          description: 'TopBar e2e failed',
        }),
        e2e: {
          status: 'failed',
          stderr: 'FAIL apps/web/src/components/chrome/TopBar.tsx shortcut behavior',
        },
      });

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:qa-failed',
      );
    });

    it('routes broad e2e output naming an unrelated spec to factory:needs-review', async () => {
      const source = await runActionabilityWorkflowCase({
        changedPath: 'core/qa/actionability.ts',
        qaResult: makeQaFailResultWithFinding({
          tier: 'regression',
          description: 'Settings e2e failed',
        }),
        e2e: {
          status: 'failed',
          stderr: 'FAIL apps/web/e2e/pipeline/settings-panel.spec.ts',
        },
      });

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:needs-review',
      );
    });
  });

  describe('error path', () => {
    it('transitions to factory:needs-human on runtime error', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockRejectedValueOnce(new Error('Runtime exploded'));

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:needs-human',
      );
      expect(mockAccumulatePersonaStats).toHaveBeenCalledWith({
        personaName: 'test-project/qa/0',
        role: 'qa',
        outcome: 'failure',
      });
    });

    it('posts a comment with error message on runtime error', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockRejectedValueOnce(new Error('Runtime exploded'));

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.comment).toHaveBeenCalledWith(
        '42',
        expect.stringContaining('Runtime exploded'),
      );
    });
  });

  describe('AgentSpec fields', () => {
    it('uses role "qa" in AgentSpec', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      const specUsed = mockRun.mock.calls[0][0] as { role: string };
      expect(specUsed.role).toBe('qa');
    });

    it('sets freshContext to true in AgentSpec', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      const specUsed = mockRun.mock.calls[0][0] as { freshContext: boolean };
      expect(specUsed.freshContext).toBe(true);
    });

    it('contextAllowlist contains diff context but NOT developer reasoning', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      const specUsed = mockRun.mock.calls[0][0] as {
        context: { prDiffWithContext?: { changedFiles: string[] } };
        contextAllowlist: string[];
      };
      expect(specUsed.contextAllowlist).toContain('workItem');
      expect(specUsed.contextAllowlist).toContain('prDiff');
      expect(specUsed.contextAllowlist).toContain('prDiffWithContext');
      expect(specUsed.context.prDiffWithContext).toEqual({
        changedFiles: [],
        hunkCount: 0,
        hunks: [],
        diffCharCount: 0,
      });
      expect(specUsed.contextAllowlist).not.toContain('devDecisionSummaries');
    });

    it('stores large QA diffs as artifacts before spawning the holdout agent', async () => {
      const workspaceDir = mkdtempSync(join(tmpdir(), 'qa-large-diff-'));
      try {
        execFileSync('git', ['init', '-b', 'main'], { cwd: workspaceDir });
        execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: workspaceDir });
        execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: workspaceDir });
        writeFileSync(join(workspaceDir, 'large.txt'), 'base\n');
        execFileSync('git', ['add', 'large.txt'], { cwd: workspaceDir });
        execFileSync('git', ['commit', '-m', 'base'], { cwd: workspaceDir });
        execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], {
          cwd: workspaceDir,
        });
        writeFileSync(join(workspaceDir, 'large.txt'), `${'changed line\n'.repeat(3_000)}`);
        execFileSync('git', ['add', 'large.txt'], { cwd: workspaceDir });
        execFileSync('git', ['commit', '-m', 'large change'], { cwd: workspaceDir });

        const item = makeWorkItem();
        const source = makeMockSource();
        mockReplay.mockReturnValue([
          {
            id: 1,
            kind: 'pr.opened',
            payload: { worktreePath: workspaceDir, baseBranch: 'main' },
            createdAt: '',
          },
        ]);
        mockRun.mockResolvedValueOnce(makePassResult());

        const { runQaWorkflow } = await import('./workflow.js');
        const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
        await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
          runTests: vi.fn().mockResolvedValue(makeSampleTestRun()),
          runCommand: vi.fn(async (_cwd, command) => ({ command, status: 'passed' as const })),
        });

        const specUsed = mockRun.mock.calls[0][0] as {
          context: { prDiff: string };
        };
        expect(specUsed.context.prDiff).toContain('Full PR diff omitted from prompt context');
        expect(specUsed.context.prDiff).toContain('ArtifactRef:');
        expect(specUsed.context.prDiff).not.toContain('changed line\n'.repeat(100));

        expect(vi.mocked(eventStore.appendEvent)).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: 'agent.disclosure',
            payload: expect.objectContaining({
              kind: 'diff_summarized',
              skill: 'qa',
            }),
          }),
        );
      } finally {
        rmSync(workspaceDir, { recursive: true, force: true });
      }
    });

    it('passes verificationSummary into QA context and allowlist', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: {
            prNumber: 99,
            worktreePath: '/wt/abc',
            baseBranch: 'develop',
            prHeadSha: 'abc1234',
          },
          createdAt: '',
        },
      ]);
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn().mockResolvedValue(makeSampleTestRun()),
        runCommand: vi.fn(async (_cwd, command) => ({ command, status: 'passed' as const })),
      });

      const spec = mockRun.mock.calls[0][0] as {
        context: Record<string, unknown>;
        contextAllowlist: string[];
      };
      expect(spec.context.verificationSummary).toMatchObject({
        pr: { number: 99, baseBranch: 'develop', headSha: 'abc1234' },
        commands: {
          lint: { command: 'pnpm biome check .', status: 'passed' },
          test: { command: 'pnpm test --reporter=json', status: 'failed' },
        },
        testRun: {
          failed: 1,
          failingSuites: ['core/cart.test.ts'],
        },
      });
      expect(spec.contextAllowlist).toContain('verificationSummary');
    });

    it('emits explicit evidence skip status when no evidence workflow event exists', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: '/wt/abc' },
          createdAt: '',
        },
      ]);
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn().mockResolvedValue(makeSampleTestRun()),
      });

      expect(vi.mocked(eventStore.appendEvent)).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'evidence.post-skipped',
          payload: expect.objectContaining({
            source: 'qa',
            reason: 'non-UI change; browser evidence not required',
          }),
        }),
      );
      const summaryEvent = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'qa.verification-summary-built');
      expect(summaryEvent?.[0].payload).toMatchObject({
        evidenceStatus: 'skipped',
        evidenceReason: 'non-UI change; browser evidence not required',
      });
    });

    it('compacts oversized QA context values before spawning Codex', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      const largeAcceptanceContract = {
        source: 'normalized' as const,
        criteria: [
          {
            id: 'AC1',
            statement: 'x'.repeat(80_000),
            executableChecks: [],
          },
        ],
      };
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        acceptanceContract: largeAcceptanceContract,
        runTests: vi.fn().mockResolvedValue(makeSampleTestRun()),
      });

      const spec = mockRun.mock.calls[0][0] as {
        context: { acceptanceContract?: unknown };
      };
      expect(spec.context.acceptanceContract).toEqual(
        expect.objectContaining({
          omitted: true,
          reason: 'qa-context-value-too-large',
          key: 'acceptanceContract',
          criteriaCount: 1,
        }),
      );
      expect(JSON.stringify(spec.context).length).toBeLessThan(80_000);
    });

    it('runs workflow-owned e2e with the same controlled ports passed to QA', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockGetProjectBySlug.mockReturnValue({
        id: 'test-project',
        qaE2eMode: 'always',
        stack: {
          runtime: 'node',
          packageManager: 'pnpm',
          testCommand: 'pnpm test --reporter=json',
          e2eCommand: 'pnpm test:e2e:pipeline',
          detectedAt: '',
        },
      });
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: '/wt/abc' },
          createdAt: '',
        },
      ]);
      mockRun.mockResolvedValueOnce(makePassResult());
      const runCommand = vi.fn(async (_cwd, command) => ({ command, status: 'passed' as const }));

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn().mockResolvedValue(makeSampleTestRun()),
        runCommand,
      });

      expect(runCommand).toHaveBeenCalledWith(
        '/wt/abc',
        'pnpm test:e2e:pipeline',
        expect.objectContaining({
          env: expect.objectContaining({
            WEB_PORT: '4173',
            API_PORT: '4301',
            MOCK_SERVER_PORT: '4301',
            SERVER_PORT: '4301',
          }),
        }),
      );
      const spec = mockRun.mock.calls[0][0] as {
        env?: Record<string, string>;
        context: { verificationSummary: { e2e: { status: string } } };
      };
      expect(spec.env).toMatchObject({
        WEB_PORT: '4173',
        API_PORT: '4301',
        MOCK_SERVER_PORT: '4301',
        SERVER_PORT: '4301',
      });
      expect(spec.context.verificationSummary.e2e.status).toBe('passed');
    });

    it('does not include forbidden holdout keys in QA context or allowlist', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      const spec = mockRun.mock.calls[0][0] as {
        context: Record<string, unknown>;
        contextAllowlist: string[];
      };
      expect(spec.context.devDecisionSummaries).toBeUndefined();
      expect(spec.context.investigationFindings).toBeUndefined();
      expect(spec.contextAllowlist).not.toContain('devDecisionSummaries');
      expect(spec.contextAllowlist).not.toContain('investigationFindings');
    });

    it('emits qa.verification-summary-built telemetry with compact statuses', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        { id: 1, kind: 'pr.opened', payload: { worktreePath: '/wt/abc' }, createdAt: '' },
        {
          id: 2,
          kind: 'evidence.post-failed',
          payload: { error: 'post failed' },
          createdAt: '',
        },
      ]);
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn().mockResolvedValue(makeSampleTestRun()),
        runCommand: vi.fn(async (_cwd, command) => ({ command, status: 'passed' as const })),
      });

      const summaryEvent = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'qa.verification-summary-built');
      expect(summaryEvent).toBeDefined();
      expect(summaryEvent?.[0].payload).toMatchObject({
        lintStatus: 'passed',
        typecheckStatus: 'skipped',
        testStatus: 'failed',
        e2eStatus: 'skipped',
        evidenceStatus: 'failed',
      });
      expect(
        (summaryEvent?.[0].payload as { contextByteSizeEstimate?: number }).contextByteSizeEstimate,
      ).toBeGreaterThan(0);
    });

    it('emits qa.preflight-started and step telemetry before verification summary', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn(),
        executableChecks: [],
      });

      const calls = vi.mocked(eventStore.appendEvent).mock.calls.map(([event]) => event);
      const preflightStartedIndex = calls.findIndex(
        (event) => event.kind === 'qa.preflight-started',
      );
      const preflightCompletedIndex = calls.findIndex(
        (event) => event.kind === 'qa.preflight-completed',
      );
      const summaryIndex = calls.findIndex(
        (event) => event.kind === 'qa.verification-summary-built',
      );
      const executableCompleted = calls.find(
        (event) =>
          event.kind === 'qa.preflight-step-completed' &&
          (event.payload as { step?: string }).step === 'executable-checks',
      );

      expect(preflightStartedIndex).toBeGreaterThanOrEqual(0);
      expect(summaryIndex).toBeGreaterThan(preflightStartedIndex);
      expect(executableCompleted?.payload).toMatchObject({
        runId: expect.any(String),
        step: 'executable-checks',
        status: 'skipped',
        reason: 'no executable acceptance checks configured',
      });
      expect(preflightCompletedIndex).toBeGreaterThan(preflightStartedIndex);
      expect(preflightCompletedIndex).toBeLessThan(summaryIndex);
    });

    it('marks qa.preflight-completed failed when deterministic command steps fail', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      const worktree = makeGitWorktreeWithChange('src/foo.ts');
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: worktree, baseBranch: 'main' },
          createdAt: '',
        },
      ]);
      mockRun.mockResolvedValueOnce(makePassResult());

      try {
        const { runQaWorkflow } = await import('./workflow.js');
        const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
        await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
          runTests: vi.fn().mockResolvedValue(makeSampleTestRun()),
          executableChecks: [],
        });

        const preflightCompleted = vi
          .mocked(eventStore.appendEvent)
          .mock.calls.find(([event]) => event.kind === 'qa.preflight-completed');

        expect(preflightCompleted?.[0].payload).toMatchObject({
          status: 'failed',
        });
      } finally {
        rmSync(worktree, { recursive: true, force: true });
      }
    });
  });

  describe('test-run propagation', () => {
    const sampleTestRun = {
      wallTimeMs: 7700,
      total: 39,
      passed: 38,
      failed: 0,
      skipped: 1,
      success: true,
      suites: [
        {
          name: 'cart.test.ts',
          filePath: '/wt/cart.test.ts',
          total: 18,
          passed: 18,
          failed: 0,
          skipped: 0,
          durationMs: 412,
          status: 'passed' as const,
        },
      ],
    };

    it('runs the injected test runner against the worktree path before invoking the agent', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: '/wt/abc' },
          createdAt: '',
        },
      ]);
      mockRun.mockResolvedValueOnce(makePassResult());
      const runTests = vi.fn().mockResolvedValue(sampleTestRun);

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', { runTests });

      expect(runTests).toHaveBeenCalledTimes(1);
      expect(runTests).toHaveBeenCalledWith('/wt/abc', expect.stringContaining('pnpm test'));
    });

    it('uses worktreePath from the parallel-implement pr.opened payload', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: {
            prNumber: 99,
            prUrl: 'https://github.com/owner/repo/pull/99',
            branch: 'factory/dev-run-123',
            worktreePath: '/wt/parallel-abc',
            devRunId: 'dev-run-123',
            pipelineRunId: 'pipeline-run-123',
          },
          createdAt: '',
        },
      ]);
      mockRun.mockResolvedValueOnce(makePassResult());
      const runTests = vi.fn().mockResolvedValue(sampleTestRun);

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', { runTests });

      expect(runTests).toHaveBeenCalledWith('/wt/parallel-abc', expect.any(String));
      const spec = mockRun.mock.calls[0][0] as { workspaceDir?: string };
      expect(spec.workspaceDir).toBe('/wt/parallel-abc');
    });

    it('emits qa.completed with pipelineRunId from a legacy fix-issue pr.opened payload', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: {
            prNumber: 99,
            prUrl: 'https://github.com/owner/repo/pull/99',
            branch: 'factory/legacy-dev-run',
            worktreePath: '/wt/legacy',
            devRunId: 'legacy-dev-run',
            pipelineRunId: 'legacy-dev-run',
          },
          createdAt: '',
        },
      ]);
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      const completed = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([event]) => event.kind === 'qa.completed');
      expect(completed?.[0].payload).toMatchObject({ pipelineRunId: 'legacy-dev-run' });
    });

    it('runs executable AC checks and preserves pipelineRunId on qa.completed', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      const worktree = mkdtempSync(join(tmpdir(), 'qa-executable-checks-'));
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: {
            prNumber: 99,
            prUrl: 'https://github.com/owner/repo/pull/99',
            worktreePath: worktree,
            pipelineRunId: 'pipeline-run-criteria',
          },
          createdAt: '',
        },
      ]);
      mockRun.mockResolvedValueOnce(makePassResult());

      try {
        const { runQaWorkflow } = await import('./workflow.js');
        const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
        await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
          executableChecks: [
            {
              criterionId: 'AC-1',
              checkId: 'AC-1-check-1',
              ac: 'Command prints expected output',
              command: 'printf expected',
              expectedExitCodes: [0],
              outputExpectation: { mode: 'exact', value: 'expected' },
            },
          ],
        });

        const completed = vi
          .mocked(eventStore.appendEvent)
          .mock.calls.find(([event]) => event.kind === 'qa.completed');
        expect(completed?.[0].payload).toMatchObject({
          pipelineRunId: 'pipeline-run-criteria',
          criteriaResults: [
            {
              criterionId: 'AC-1',
              checkId: 'AC-1-check-1',
              passed: true,
              exitCode: 0,
            },
          ],
        });
      } finally {
        rmSync(worktree, { recursive: true, force: true });
      }
    });

    it('uses workflow-owned executable AC results when the QA agent returns a malformed copy', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      const worktree = mkdtempSync(join(tmpdir(), 'qa-executable-checks-agent-copy-'));
      const qaResult = makePassResult();
      qaResult.output = {
        ...(qaResult.output as Record<string, unknown>),
        criteriaResults: [
          {
            criterionId: 'AC-1',
            checkId: 'AC-1-check-1',
            ac: 'Command prints expected output',
            command: 'printf expected',
            expectedExitCodes: [0],
            exitCode: 0,
            passed: true,
          },
        ],
      };
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: {
            worktreePath: worktree,
            pipelineRunId: 'pipeline-run-agent-copy',
          },
          createdAt: '',
        },
      ]);
      mockRun.mockResolvedValueOnce(qaResult);

      try {
        const { runQaWorkflow } = await import('./workflow.js');
        const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
        await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
          executableChecks: [
            {
              criterionId: 'AC-1',
              checkId: 'AC-1-check-1',
              ac: 'Command prints expected output',
              command: 'printf expected',
              expectedExitCodes: [0],
            },
          ],
        });

        const completed = vi
          .mocked(eventStore.appendEvent)
          .mock.calls.find(([event]) => event.kind === 'qa.completed');
        expect(completed?.[0].payload).toMatchObject({
          pipelineRunId: 'pipeline-run-agent-copy',
          criteriaResults: [
            {
              criterionId: 'AC-1',
              checkId: 'AC-1-check-1',
              actual: 'expected',
              passed: true,
              exitCode: 0,
            },
          ],
        });
        expect(source.transitionState).toHaveBeenCalledWith(
          '42',
          'factory:needs-qa',
          'factory:needs-review',
        );
        expect(
          vi
            .mocked(eventStore.appendEvent)
            .mock.calls.some(
              ([event]) =>
                event.kind === 'agent.log' &&
                (event.payload as { metric?: string }).metric ===
                  'criteria_results_agent_copy_replaced',
            ),
        ).toBe(true);
      } finally {
        rmSync(worktree, { recursive: true, force: true });
      }
    });

    it('fails executable AC checks when the worktree is unavailable', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { pipelineRunId: 'pipeline-run-no-worktree' },
          createdAt: '',
        },
      ]);
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        executableChecks: [
          {
            criterionId: 'AC-1',
            checkId: 'AC-1-check-1',
            ac: 'Command must run',
            command: 'printf expected',
            expectedExitCodes: [0],
          },
        ],
      });

      const completed = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([event]) => event.kind === 'qa.completed');
      expect(completed?.[0].payload).toMatchObject({
        pipelineRunId: 'pipeline-run-no-worktree',
        verdict: 'fail',
        criteriaResults: [
          {
            criterionId: 'AC-1',
            checkId: 'AC-1-check-1',
            passed: false,
            exitCode: null,
            error: 'workspaceDir unavailable; executable check was not run',
          },
        ],
      });
    });

    it('preserves deprecated output expectations without enforcing them', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      const worktree = mkdtempSync(join(tmpdir(), 'qa-executable-checks-output-'));
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: {
            worktreePath: worktree,
            pipelineRunId: 'pipeline-run-output',
          },
          createdAt: '',
        },
      ]);
      mockRun.mockResolvedValueOnce(makePassResult());

      try {
        const { runQaWorkflow } = await import('./workflow.js');
        const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
        await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
          executableChecks: [
            {
              criterionId: 'AC-1',
              checkId: 'AC-1-check-1',
              ac: 'Long output contains early token',
              command: "node -e \"process.stdout.write('needle' + 'x'.repeat(5000))\"",
              expectedExitCodes: [0],
              outputExpectation: { mode: 'contains', value: 'needle' },
            },
          ],
        });

        const completed = vi
          .mocked(eventStore.appendEvent)
          .mock.calls.find(([event]) => event.kind === 'qa.completed');
        const result = (
          completed?.[0].payload as { criteriaResults?: Array<{ actual: string; passed: boolean }> }
        ).criteriaResults?.[0];
        expect(result?.passed).toBe(true);
        expect(result?.actual).toHaveLength(4000);
        expect(result?.actual).not.toContain('needle');

        const spec = mockRun.mock.calls[0][0] as {
          context: { criteriaResults?: Array<{ actual: string }> };
        };
        expect(spec.context.criteriaResults?.[0]?.actual).toHaveLength(1000);
      } finally {
        rmSync(worktree, { recursive: true, force: true });
      }
    });

    it('fails suite-only Vitest evidence checks when the matched suite did not pass', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      const worktree = mkdtempSync(join(tmpdir(), 'qa-executable-checks-vitest-'));
      const report = {
        numTotalTests: 1,
        numPassedTests: 0,
        numFailedTests: 1,
        success: false,
        testResults: [
          {
            name: 'src/failing.test.ts',
            status: 'failed',
            assertionResults: [{ title: 'breaks', status: 'failed', duration: 1 }],
          },
        ],
      };
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: {
            worktreePath: worktree,
            pipelineRunId: 'pipeline-run-vitest-evidence',
          },
          createdAt: '',
        },
      ]);
      mockRun.mockResolvedValueOnce(makePassResult());

      try {
        const { runQaWorkflow } = await import('./workflow.js');
        const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
        await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
          executableChecks: [
            {
              criterionId: 'AC-1',
              checkId: 'AC-1-check-1',
              ac: 'Vitest suite must pass',
              command: `node -e 'process.stdout.write(${JSON.stringify(JSON.stringify(report))})'`,
              expectedExitCodes: [0],
              evidenceExpectation: {
                type: 'vitest-json',
                suite: 'failing.test.ts',
                expectedStatus: 'passed',
              },
            },
          ],
        });

        const completed = vi
          .mocked(eventStore.appendEvent)
          .mock.calls.find(([event]) => event.kind === 'qa.completed');
        const result = (
          completed?.[0].payload as {
            criteriaResults?: Array<{
              passed: boolean;
              evidenceArtifact?: { artifactStatus: string; matchedSuites: string[] };
            }>;
          }
        ).criteriaResults?.[0];
        expect(result).toMatchObject({
          passed: false,
          evidenceArtifact: {
            artifactStatus: 'not-found',
            matchedSuites: ['failing.test.ts'],
          },
        });
        expect(source.transitionState).toHaveBeenCalledWith(
          '42',
          'factory:needs-qa',
          'factory:qa-failed',
        );
      } finally {
        rmSync(worktree, { recursive: true, force: true });
      }
    });

    it('does not feed non-node stack test commands through the Vitest JSON runner', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockGetProjectBySlug.mockReturnValue({
        id: 'test-project',
        stack: {
          runtime: 'go',
          packageManager: 'go-modules',
          testCommand: 'go test ./...',
          detectedAt: '',
        },
      });
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: '/wt/abc' },
          createdAt: '',
        },
      ]);
      mockRun.mockResolvedValueOnce(makePassResult());
      const runTests = vi.fn();

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', { runTests });

      expect(runTests).not.toHaveBeenCalled();
      const spec = mockRun.mock.calls[0][0] as {
        context: {
          projectCommands: Record<string, unknown>;
          verificationSummary: {
            commands: { test: { command?: string; status?: string; error?: string } };
            testRun?: unknown;
          };
        };
      };
      expect(spec.context.projectCommands.testCommand).toBe('go test ./...');
      expect(spec.context.verificationSummary.commands.test).toMatchObject({
        command: 'go test ./...',
        status: 'skipped',
      });
      expect(spec.context.verificationSummary.commands.test.error).toContain(
        'structured test capture requires a Vitest-compatible Node command',
      );
      expect(spec.context.verificationSummary.testRun).toBeUndefined();
    });

    it('keeps raw testRun out of the agent context while preserving compact verificationSummary', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: '/wt/abc' },
          createdAt: '',
        },
      ]);
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn().mockResolvedValue(sampleTestRun),
      });

      const spec = mockRun.mock.calls[0][0] as {
        context: { testRun?: unknown; verificationSummary?: { testRun?: unknown } };
        contextAllowlist: string[];
      };
      expect(spec.context.testRun).toBeUndefined();
      expect(spec.contextAllowlist).not.toContain('testRun');
      expect(spec.context.verificationSummary?.testRun).toMatchObject({
        total: sampleTestRun.total,
        passed: sampleTestRun.passed,
        failed: sampleTestRun.failed,
      });
    });

    it('includes testRun in the qa.completed payload when present', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: '/wt/abc' },
          createdAt: '',
        },
      ]);
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn().mockResolvedValue(sampleTestRun),
      });

      const completed = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'qa.completed');
      const payload = completed?.[0].payload as Record<string, unknown>;
      expect(payload.testRun).toEqual(sampleTestRun);
    });

    it('omits testRun from qa.completed when the runner returns null', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: '/wt/abc' },
          createdAt: '',
        },
      ]);
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn().mockResolvedValue(null),
      });

      const completed = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'qa.completed');
      const payload = completed?.[0].payload as Record<string, unknown>;
      expect(payload.testRun).toBeUndefined();
    });

    it('skips the test runner entirely when no worktree is available', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      // No pr.opened event => findDevWorktreePath returns undefined
      mockReplay.mockReturnValue([]);
      mockRun.mockResolvedValueOnce(makePassResult());
      const runTests = vi.fn();

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', { runTests });

      expect(runTests).not.toHaveBeenCalled();
      const spec = mockRun.mock.calls[0][0] as { context: { testRun?: unknown } };
      expect(spec.context.testRun).toBeUndefined();
    });
  });

  describe('partial verdict', () => {
    it('transitions to factory:needs-review when partial score >= 70', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makePartialHighResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:needs-review',
      );
    });

    it('transitions to factory:qa-failed when partial score < 70', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makePartialLowResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:qa-failed',
      );
    });
  });

  describe('retry-and-escalate', () => {
    it('transitions to factory:needs-human and emits agent.retry-escalated when qa-fail count >= maxRetries', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeFailResult());
      // Simulate 2 prior qa.completed fail events already in the store
      mockReplay.mockReturnValue([
        { kind: 'qa.completed', payload: JSON.stringify({ verdict: 'fail', overallScore: 40 }) },
        { kind: 'qa.completed', payload: JSON.stringify({ verdict: 'fail', overallScore: 35 }) },
      ]);

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:needs-human',
      );
      expect(eventStore.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'agent.retry-escalated',
          payload: expect.objectContaining({ stage: 'qa' }),
        }),
      );
    });

    it('transitions to factory:qa-failed when qa-fail count < maxRetries', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockRun.mockResolvedValueOnce(makeFailResult());
      // Only 1 prior qa.completed fail event — under the maxRetries threshold
      mockReplay.mockReturnValue([
        { kind: 'qa.completed', payload: JSON.stringify({ verdict: 'fail', overallScore: 40 }) },
      ]);

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:qa-failed',
      );
    });
  });

  describe('evidenceCommentUrl propagation', () => {
    it('passes evidenceCommentUrl into context and allowlist when evidence.posted event is present', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        { id: 1, kind: 'pr.opened', payload: { worktreePath: '/wt/abc' }, createdAt: '' },
        {
          id: 2,
          kind: 'evidence.posted',
          payload: { commentUrl: 'https://github.com/owner/repo/issues/42#issuecomment-123' },
          createdAt: '',
        },
      ]);
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      const spec = mockRun.mock.calls[0][0] as {
        context: Record<string, unknown>;
        contextAllowlist: string[];
      };
      expect(spec.context.evidenceCommentUrl).toBe(
        'https://github.com/owner/repo/issues/42#issuecomment-123',
      );
      expect(spec.contextAllowlist).toContain('evidenceCommentUrl');
    });

    it('omits evidenceCommentUrl from context and allowlist when no evidence.posted event is present', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([]);
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      const spec = mockRun.mock.calls[0][0] as {
        context: Record<string, unknown>;
        contextAllowlist: string[];
      };
      expect(spec.context.evidenceCommentUrl).toBeUndefined();
      expect(spec.contextAllowlist).not.toContain('evidenceCommentUrl');
    });
  });

  describe('devTestsRun propagation (#467)', () => {
    it('prefers observed factory-tools test audit paths over implement-complete payload', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockImplementation((filter = {}) => {
        if ((filter as { runId?: string; kind?: string }).runId === 'dev-run-1') {
          return [
            {
              id: 3,
              kind: 'agent.tool-call',
              payload: {
                tool_name: 'run_tests',
                tool_input: {
                  command: 'pnpm test --reporter=json apps/web/src/foo.test.ts',
                  path: 'src/foo.test.ts',
                },
                canonical_path: {
                  path: 'apps/web/src/foo.test.ts',
                  root: 'worktree',
                  packageRoot: 'apps/web',
                  normalizedFrom: 'src/foo.test.ts',
                },
              },
              runId: 'dev-run-1',
              createdAt: '',
            },
          ];
        }
        return [
          {
            id: 1,
            kind: 'pr.opened',
            payload: { worktreePath: '/wt/abc', devRunId: 'dev-run-1' },
            createdAt: '',
          },
          {
            id: 2,
            kind: 'agent.implement-complete',
            payload: {
              testsRun: {
                command: 'pnpm test ',
                paths: ['src/foo.test.ts'],
              },
            },
            createdAt: '',
          },
        ];
      });
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      const spec = mockRun.mock.calls[0][0] as {
        context: Record<string, unknown>;
        contextAllowlist: string[];
      };
      expect(spec.context.devTestsRun).toEqual({
        command: 'pnpm test --reporter=json apps/web/src/foo.test.ts',
        paths: ['apps/web/src/foo.test.ts'],
      });
      expect(spec.contextAllowlist).toContain('devTestsRun');
    });

    it('keeps observed dev test command and paths from the same run_tests event', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockImplementation((filter = {}) => {
        if ((filter as { runId?: string; kind?: string }).runId === 'dev-run-1') {
          return [
            {
              id: 3,
              kind: 'agent.tool-call',
              payload: {
                tool_name: 'run_tests',
                tool_input: {
                  command: 'pnpm test --reporter=json apps/web/src/foo.test.ts',
                  path: 'src/foo.test.ts',
                },
                canonical_path: {
                  path: 'apps/web/src/foo.test.ts',
                  root: 'worktree',
                  packageRoot: 'apps/web',
                  normalizedFrom: 'src/foo.test.ts',
                },
              },
              runId: 'dev-run-1',
              createdAt: '',
            },
            {
              id: 4,
              kind: 'agent.tool-call',
              payload: {
                tool_name: 'run_tests',
                tool_input: {
                  command: 'pnpm test --reporter=json',
                },
              },
              runId: 'dev-run-1',
              createdAt: '',
            },
          ];
        }
        return [
          {
            id: 1,
            kind: 'pr.opened',
            payload: { worktreePath: '/wt/abc', devRunId: 'dev-run-1' },
            createdAt: '',
          },
        ];
      });
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      const spec = mockRun.mock.calls[0][0] as {
        context: Record<string, unknown>;
        contextAllowlist: string[];
      };
      expect(spec.context.devTestsRun).toEqual({
        command: 'pnpm test --reporter=json apps/web/src/foo.test.ts',
        paths: ['apps/web/src/foo.test.ts'],
      });
      expect(spec.contextAllowlist).toContain('devTestsRun');
    });

    it('reads testsRun from agent.implement-complete and passes it as devTestsRun in context', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        { id: 1, kind: 'pr.opened', payload: { worktreePath: '/wt/abc' }, createdAt: '' },
        {
          id: 2,
          kind: 'agent.implement-complete',
          payload: {
            filesWritten: 2,
            testsWritten: 1,
            confidence: 'high',
            testsRun: {
              command: 'pnpm test ',
              paths: ['core/foo/bar.test.ts'],
            },
          },
          createdAt: '',
        },
      ]);
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      const spec = mockRun.mock.calls[0][0] as {
        context: Record<string, unknown>;
        contextAllowlist: string[];
      };
      expect(spec.context.devTestsRun).toEqual({
        command: 'pnpm test ',
        paths: ['core/foo/bar.test.ts'],
      });
      expect(spec.contextAllowlist).toContain('devTestsRun');
    });

    it('omits devTestsRun from context when no agent.implement-complete event exists', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        { id: 1, kind: 'pr.opened', payload: { worktreePath: '/wt/abc' }, createdAt: '' },
      ]);
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      const spec = mockRun.mock.calls[0][0] as {
        context: Record<string, unknown>;
        contextAllowlist: string[];
      };
      expect(spec.context.devTestsRun).toBeUndefined();
      expect(spec.contextAllowlist).not.toContain('devTestsRun');
    });

    it('omits devTestsRun when implement-complete payload is malformed', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        { id: 1, kind: 'pr.opened', payload: { worktreePath: '/wt/abc' }, createdAt: '' },
        {
          id: 2,
          kind: 'agent.implement-complete',
          payload: {
            filesWritten: 2,
            testsWritten: 1,
            confidence: 'high',
            testsRun: { command: 'x' },
          },
          createdAt: '',
        },
      ]);
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      const spec = mockRun.mock.calls[0][0] as {
        context: Record<string, unknown>;
        contextAllowlist: string[];
      };
      expect(spec.context.devTestsRun).toBeUndefined();
    });
  });

  describe('non-Error thrown (line 174 branch)', () => {
    it('wraps non-Error thrown value as Error and transitions to needs-human', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      // Throw a string instead of an Error object — covers line 174
      // eslint-disable-next-line prefer-promise-reject-errors
      mockRun.mockRejectedValueOnce('string error from qa runtime');

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:needs-human',
      );
      expect(source.comment).toHaveBeenCalledWith(
        '42',
        expect.stringContaining('string error from qa runtime'),
      );
    });
  });

  // ─── M19.19: deterministic 3-tier verify before QA agent ──────────────────
  describe('deterministic 3-tier verify (M19.19)', () => {
    function makeSpecRow() {
      return {
        spec: {
          objective: 'Test',
          userJourneys: [],
          functionalRequirements: [],
          architecture: { current: 'a', new: 'b', decisionRationale: 'r' },
          schemaChanges: { ddl: [], migrations: [] },
          interfaceContracts: [],
          workPackages: [
            {
              id: 'WP1',
              filesOwned: ['src/x.ts'],
              changes: 'x',
              dependsOn: [],
              builderTier: 'sonnet',
            },
          ],
          executionOrder: [{ batch: 0, wpIds: ['WP1'] }],
          verificationTooling: [],
          acceptanceCriteria: [
            {
              id: 'AC1',
              statement: 'ok',
              executableChecks: [{ id: 'AC1-check-1', command: 'pnpm test' }],
              crossCutting: true,
            },
          ],
          constraints: [],
          riskRegister: [],
          decisionSummaries: [{ kind: 'PLAN', summary: 'test' }],
        },
      };
    }

    function makePassingTier(tier: 1 | 2 | 3) {
      return { tier, passed: true, evidence: [], findings: [] };
    }
    function makeFailingTier(tier: 1 | 2 | 3) {
      return {
        tier,
        passed: false,
        evidence: [],
        findings: [
          {
            message: `tier ${tier} broke something`,
            severity: 'error' as const,
          },
        ],
      };
    }
    function makeInfrastructureFailingTier(tier: 1 | 2 | 3) {
      return {
        tier,
        passed: false,
        evidence: [],
        findings: [
          {
            message:
              "Verification tool 'bad-path' failed (command: apps/web/src/foo.test.ts): Permission denied",
            severity: 'error' as const,
            category: 'verification-infrastructure' as const,
            code: 'malformed-verification-command',
          },
        ],
      };
    }

    it('runs deterministic tiers before invoking the QA agent when spec + worktree are present', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: '/wt/abc', devRunId: 'dev-run-1' },
          createdAt: '',
        },
      ]);
      mockGetEngineeringSpec.mockReturnValue(makeSpecRow());
      mockRun.mockResolvedValueOnce(makePassResult());

      const runTierImpl = vi.fn(
        async (tier: 1 | 2 | 3, _spec: unknown, _artifacts: unknown, _deps?: unknown) =>
          makePassingTier(tier),
      );

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn().mockResolvedValue(null),
        runTierImpl,
      });

      expect(runTierImpl).toHaveBeenCalledTimes(3);
      // runTier was called before the agent.run (mockRun)
      const tierCallOrder = runTierImpl.mock.invocationCallOrder[0];
      const agentCallOrder = mockRun.mock.invocationCallOrder[0];
      expect(tierCallOrder).toBeLessThan(agentCallOrder);
      // Spec, projectId, worktreePath threaded through
      const firstCall = runTierImpl.mock.calls[0];
      expect(firstCall[0]).toBe(1);
      expect((firstCall[2] as { runId: string }).runId).toBe('dev-run-1');
      expect((firstCall[2] as { worktreePath: string }).worktreePath).toBe('/wt/abc');
    });

    it('passes deterministicTierResults into the agent context and allowlist on all-pass', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: '/wt/abc', devRunId: 'dev-run-1' },
          createdAt: '',
        },
      ]);
      mockGetEngineeringSpec.mockReturnValue(makeSpecRow());
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn().mockResolvedValue(null),
        runTierImpl: vi.fn(
          async (tier: 1 | 2 | 3, _spec: unknown, _artifacts: unknown, _deps?: unknown) =>
            makePassingTier(tier),
        ),
      });

      const spec = mockRun.mock.calls[0][0] as {
        context: Record<string, unknown>;
        contextAllowlist: string[];
      };
      expect(spec.context.deterministicTierResults).toBeDefined();
      expect(spec.contextAllowlist).toContain('deterministicTierResults');
    });

    it('short-circuits on tier 1 fail — synthetic qa.completed emitted, agent NOT called', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: '/wt/abc', devRunId: 'dev-run-1' },
          createdAt: '',
        },
      ]);
      mockGetEngineeringSpec.mockReturnValue(makeSpecRow());

      const runTierImpl = vi.fn(
        async (tier: 1 | 2 | 3, _spec: unknown, _artifacts: unknown, _deps?: unknown) =>
          tier === 1 ? makeFailingTier(1) : makePassingTier(tier),
      );

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn().mockResolvedValue(null),
        runTierImpl,
      });

      expect(mockRun).not.toHaveBeenCalled();
      expect(runTierImpl).toHaveBeenCalledTimes(1);

      const completed = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'qa.completed');
      expect(completed).toBeDefined();
      const payload = completed?.[0].payload as Record<string, unknown>;
      expect(payload.verdict).toBe('fail');
      expect(payload.overallScore).toBe(0);
      expect(payload.agentSkipped).toBe(true);
      expect(payload.deterministic).toBe(true);
      expect(payload.failureCategory).toBe('spec-contract');

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:qa-failed',
      );
    });

    it('short-circuits on tier 2 fail with synthetic qa.completed → factory:qa-failed', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: '/wt/abc', devRunId: 'dev-run-1' },
          createdAt: '',
        },
      ]);
      mockGetEngineeringSpec.mockReturnValue(makeSpecRow());

      const runTierImpl = vi.fn(
        async (tier: 1 | 2 | 3, _spec: unknown, _artifacts: unknown, _deps?: unknown) =>
          tier === 2 ? makeFailingTier(2) : makePassingTier(tier),
      );

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn().mockResolvedValue(null),
        runTierImpl,
      });

      expect(mockRun).not.toHaveBeenCalled();
      expect(runTierImpl).toHaveBeenCalledTimes(2);
      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:qa-failed',
      );
    });

    it('routes verification infrastructure failures to needs-human without qa.completed or retry escalation', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: '/wt/abc', devRunId: 'dev-run-1' },
          createdAt: '',
        },
        {
          id: 2,
          kind: 'qa.completed',
          payload: { verdict: 'fail', overallScore: 0 },
          createdAt: '',
        },
        {
          id: 3,
          kind: 'qa.completed',
          payload: { verdict: 'fail', overallScore: 0 },
          createdAt: '',
        },
      ]);
      mockGetEngineeringSpec.mockReturnValue(makeSpecRow());

      const runTierImpl = vi.fn(
        async (tier: 1 | 2 | 3, _spec: unknown, _artifacts: unknown, _deps?: unknown) =>
          tier === 2 ? makeInfrastructureFailingTier(2) : makePassingTier(tier),
      );

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn().mockResolvedValue(null),
        runTierImpl,
      });

      expect(mockRun).not.toHaveBeenCalled();
      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:needs-human',
      );
      expect(
        vi.mocked(eventStore.appendEvent).mock.calls.some(([e]) => e.kind === 'qa.completed'),
      ).toBe(false);
      expect(
        vi
          .mocked(eventStore.appendEvent)
          .mock.calls.some(([e]) => e.kind === 'agent.retry-escalated'),
      ).toBe(false);
      const blocked = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'qa.verification-blocked');
      expect(blocked).toBeDefined();
      expect(blocked?.[0].payload).toMatchObject({
        failedTier: 2,
        reason: 'malformed-verification-command',
        agentSkipped: true,
        failureCategory: 'verification-infrastructure',
      });
    });

    it('tier 3 fail with regressionPolicy=ignore continues to the agent', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: '/wt/abc', devRunId: 'dev-run-1' },
          createdAt: '',
        },
      ]);
      mockGetEngineeringSpec.mockReturnValue(makeSpecRow());
      mockRun.mockResolvedValueOnce(makePassResult());

      // verifyRegression itself flips the tier-3 result to passed=true under
      // 'ignore', so we simulate that here — tier 3 returns passed:true with
      // warning findings.
      const tier3Result = {
        tier: 3 as const,
        passed: true,
        evidence: [],
        findings: [{ message: 'Regression [ignore]: FAIL x', severity: 'warning' as const }],
      };
      const runTierImpl = vi.fn(
        async (tier: 1 | 2 | 3, _spec: unknown, _artifacts: unknown, _deps?: unknown) =>
          tier === 3 ? tier3Result : makePassingTier(tier),
      );

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn().mockResolvedValue(null),
        runTierImpl,
      });

      // Agent did run because tier 3 logically passed under 'ignore'
      expect(mockRun).toHaveBeenCalledTimes(1);
    });

    it('treats unrelated full-suite regression failures as advisory when targeted tiers pass', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: '/wt/abc', devRunId: 'dev-run-1' },
          createdAt: '',
        },
      ]);
      mockGetEngineeringSpec.mockReturnValue(makeSpecRow());
      mockRun.mockResolvedValueOnce(makePassResult());
      source.getPrDiff = vi
        .fn()
        .mockResolvedValue(
          [
            'diff --git a/src/x.ts b/src/x.ts',
            '--- a/src/x.ts',
            '+++ b/src/x.ts',
            '@@ -1 +1 @@',
            '-old',
            '+new',
          ].join('\n'),
        );

      const runTierImpl = vi.fn(
        async (tier: 1 | 2 | 3, _spec: unknown, _artifacts: unknown, _deps?: unknown) =>
          tier === 3
            ? {
                tier,
                passed: false,
                evidence: [],
                findings: [
                  {
                    message: 'Regression [escalate]: FAIL apps/web/e2e/bootstrap-wizard.spec.ts',
                    severity: 'error' as const,
                  },
                ],
              }
            : makePassingTier(tier),
      );

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn().mockResolvedValue(null),
        runTierImpl,
      });

      expect(mockRun).toHaveBeenCalledTimes(1);
      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:needs-review',
      );
      const completed = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'qa.completed');
      const payload = completed?.[0].payload as {
        tierResults?: {
          regression?: { passed: boolean; findings: Array<{ description?: string }> };
        };
      };
      expect(payload.tierResults?.regression?.passed).toBe(true);
      expect(payload.tierResults?.regression?.findings[0]?.description).toContain(
        'Unrelated regression [advisory]',
      );
      expect(
        vi
          .mocked(eventStore.appendEvent)
          .mock.calls.some(
            ([e]) =>
              e.kind === 'agent.log' &&
              (e.payload as { metric?: string }).metric === 'regression_unrelated',
          ),
      ).toBe(true);
    });

    it('rejects QA disagreement with deterministic tier verdict → factory:needs-human', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: '/wt/abc', devRunId: 'dev-run-1' },
          createdAt: '',
        },
      ]);
      mockGetEngineeringSpec.mockReturnValue(makeSpecRow());

      // Deterministic ground truth: all tiers pass.
      const runTierImpl = vi.fn(
        async (tier: 1 | 2 | 3, _spec: unknown, _artifacts: unknown, _deps?: unknown) =>
          makePassingTier(tier),
      );

      // Agent fabricates tier 1 failure.
      const lying: AgentResult = {
        output: {
          ...(makePassResult().output as object),
          verdict: 'fail',
          tierResults: {
            structural: {
              passed: false,
              findings: [
                {
                  tier: 'structural',
                  severity: 'error',
                  description: 'made-up failure',
                  disposition: 'fixed',
                  dispositionRef: 'abc',
                },
              ],
            },
            functional: { passed: true, findings: [] },
            regression: { passed: true, findings: [] },
          },
        },
        decisionSummaries: [],
        events: [],
      };
      mockRun.mockResolvedValueOnce(lying);

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn().mockResolvedValue(null),
        runTierImpl,
      });

      const disagreement = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'qa.tier-disagreement');
      expect(disagreement).toBeDefined();
      const payload = disagreement?.[0].payload as { disagreements: unknown[] };
      expect(payload.disagreements.length).toBeGreaterThan(0);

      // Disagreement is treated as a runtime failure → needs-human.
      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:needs-human',
      );
    });

    it('skips deterministic verify when no engineering spec exists (legacy path)', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: '/wt/abc' },
          createdAt: '',
        },
      ]);
      mockGetEngineeringSpec.mockReturnValue(null); // no spec persisted
      mockRun.mockResolvedValueOnce(makePassResult());

      const runTierImpl = vi.fn();

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn().mockResolvedValue(null),
        runTierImpl,
      });

      expect(runTierImpl).not.toHaveBeenCalled();
      expect(mockRun).toHaveBeenCalledTimes(1);
      const spec = mockRun.mock.calls[0][0] as {
        context: Record<string, unknown>;
        contextAllowlist: string[];
      };
      expect(spec.context.deterministicTierResults).toBeUndefined();
      expect(spec.contextAllowlist).not.toContain('deterministicTierResults');
    });

    it('skips deterministic verify when no worktree is available', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([]); // no pr.opened → no worktreePath
      mockGetEngineeringSpec.mockReturnValue(makeSpecRow());
      mockRun.mockResolvedValueOnce(makePassResult());

      const runTierImpl = vi.fn();

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn().mockResolvedValue(null),
        runTierImpl,
      });

      expect(runTierImpl).not.toHaveBeenCalled();
      expect(mockRun).toHaveBeenCalledTimes(1);
    });

    it('emits qa.completed payload with ground-truth tier results on agree-and-pass', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: '/wt/abc', devRunId: 'dev-run-1' },
          createdAt: '',
        },
      ]);
      mockGetEngineeringSpec.mockReturnValue(makeSpecRow());
      mockRun.mockResolvedValueOnce(makePassResult());

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn().mockResolvedValue(null),
        runTierImpl: vi.fn(
          async (tier: 1 | 2 | 3, _spec: unknown, _artifacts: unknown, _deps?: unknown) =>
            makePassingTier(tier),
        ),
      });

      const completed = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'qa.completed');
      expect(completed).toBeDefined();
      const payload = completed?.[0].payload as Record<string, unknown>;
      expect(payload.deterministic).toBe(true);
      expect((payload.tierResults as { structural: { passed: boolean } }).structural.passed).toBe(
        true,
      );
    });

    it('uses devRunId from pr.opened as the implRunId for tier-3 carry-forward', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: '/wt/abc', devRunId: 'impl-run-xyz' },
          createdAt: '',
        },
      ]);
      mockGetEngineeringSpec.mockReturnValue(makeSpecRow());
      mockRun.mockResolvedValueOnce(makePassResult());

      const runTierImpl = vi.fn(
        async (tier: 1 | 2 | 3, _spec: unknown, _artifacts: unknown, _deps?: unknown) =>
          makePassingTier(tier),
      );

      const { runQaWorkflow } = await import('./workflow.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn().mockResolvedValue(null),
        runTierImpl,
      });

      for (const call of runTierImpl.mock.calls) {
        expect((call[2] as { runId: string }).runId).toBe('impl-run-xyz');
      }
    });

    it('emits deterministic tier events under the QA runId, not implRunId', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: '/wt/abc', devRunId: 'impl-run-xyz' },
          createdAt: '',
        },
      ]);
      mockGetEngineeringSpec.mockReturnValue(makeSpecRow());
      mockRun.mockResolvedValueOnce(makePassResult());

      // runTierImpl that calls the injected appendEvent (mirrors the real
      // runTier signature: deps.appendEvent emits per-tier events).
      const runTierImpl = vi.fn(
        async (tier: 1 | 2 | 3, _spec: unknown, artifacts: unknown, callDeps?: unknown) => {
          const a = artifacts as {
            projectId: string;
            workItemId?: string | null;
            runId: string;
          };
          const ce = callDeps as { appendEvent?: (input: unknown) => unknown } | undefined;
          ce?.appendEvent?.({
            projectId: a.projectId,
            workItemId: a.workItemId ?? null,
            kind:
              tier === 1
                ? 'qa.structural-passed'
                : tier === 2
                  ? 'qa.functional-passed'
                  : 'qa.regression-passed',
            payload: { tier, runId: a.runId },
            runId: a.runId,
          });
          return makePassingTier(tier);
        },
      );

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn().mockResolvedValue(null),
        runTierImpl,
      });

      const tierEvents = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.filter(([e]) =>
          ['qa.structural-passed', 'qa.functional-passed', 'qa.regression-passed'].includes(e.kind),
        );
      expect(tierEvents.length).toBe(3);
      // Event-row runId must NOT be the impl run; should be a fresh UUID.
      for (const [event] of tierEvents) {
        expect(event.runId).not.toBe('impl-run-xyz');
        expect(typeof event.runId).toBe('string');
      }
    });

    it('routes getEngineeringSpec failure through the QA error path', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: '/wt/abc', devRunId: 'dev-run-1' },
          createdAt: '',
        },
      ]);
      mockGetEngineeringSpec.mockImplementation(() => {
        throw new Error('bad spec JSON');
      });

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn().mockResolvedValue(null),
        runTierImpl: vi.fn(),
      });

      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:needs-human',
      );
      const failed = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'agent.run-failed');
      expect(failed).toBeDefined();
    });

    it('routes runTier failure through the QA error path', async () => {
      const item = makeWorkItem();
      const source = makeMockSource();
      mockReplay.mockReturnValue([
        {
          id: 1,
          kind: 'pr.opened',
          payload: { worktreePath: '/wt/abc', devRunId: 'dev-run-1' },
          createdAt: '',
        },
      ]);
      mockGetEngineeringSpec.mockReturnValue(makeSpecRow());

      const runTierImpl = vi.fn(async () => {
        throw new Error('tier 1 carry-forward query exploded');
      });

      const { runQaWorkflow } = await import('./workflow.js');
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      await runQaWorkflow(item, source, 'test-project', 'owner/repo', {
        runTests: vi.fn().mockResolvedValue(null),
        runTierImpl,
      });

      expect(mockRun).not.toHaveBeenCalled();
      expect(source.transitionState).toHaveBeenCalledWith(
        '42',
        'factory:needs-qa',
        'factory:needs-human',
      );
      const failed = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'agent.run-failed');
      expect(failed).toBeDefined();
      const payload = failed?.[0].payload as { error: string };
      expect(payload.error).toContain('carry-forward');
    });
  });

  // ─── M19.19: synthetic output unit checks ─────────────────────────────────
  describe('buildSyntheticQaOutput (M19.19)', () => {
    it('produces a QA-schema-valid payload for tier 1 fail', async () => {
      const { buildSyntheticQaOutput } = await import('./synthetic-output.js');
      const { QaOutputSchema } = await import('@goose-hub/skills/qa/schema.js');
      const synthetic = buildSyntheticQaOutput({
        tierResults: {
          1: {
            tier: 1,
            passed: false,
            evidence: [],
            findings: [{ message: 'file missing', severity: 'error' }],
          },
          2: null,
          3: null,
        },
        failedTier: 1,
      });
      const parsed = QaOutputSchema.safeParse(synthetic);
      expect(parsed.success).toBe(true);
      expect(synthetic.verdict).toBe('fail');
      expect(synthetic.overallScore).toBe(0);
      // Synthetic error finding carries needs-fix so fix-feedback can repair it.
      const errorFinding = synthetic.findings.find((f) => f.severity === 'error');
      expect(errorFinding?.disposition).toBe('needs-fix');
      expect(errorFinding?.dispositionRef).toBe('deterministic-verification');
    });

    it('uses the correct DecisionKind per failed tier', async () => {
      const { buildSyntheticQaOutput } = await import('./synthetic-output.js');
      const makeT = (tier: 1 | 2 | 3) => ({
        tier,
        passed: false,
        evidence: [],
        findings: [],
      });
      expect(
        buildSyntheticQaOutput({
          tierResults: { 1: makeT(1), 2: null, 3: null },
          failedTier: 1,
        }).decisionSummaries[0].kind,
      ).toBe('STRUCTURAL_CHECK');
      expect(
        buildSyntheticQaOutput({
          tierResults: { 1: null, 2: makeT(2), 3: null },
          failedTier: 2,
        }).decisionSummaries[0].kind,
      ).toBe('FUNCTIONAL_CHECK');
      expect(
        buildSyntheticQaOutput({
          tierResults: { 1: null, 2: null, 3: makeT(3) },
          failedTier: 3,
          regressionPolicy: 'escalate',
        }).decisionSummaries[0].kind,
      ).toBe('REGRESSION_CHECK');
    });
  });
});
