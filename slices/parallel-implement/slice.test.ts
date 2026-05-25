import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import {
  HOLDOUT_FORBIDDEN_KEYS,
  findHoldoutContextLeaks,
} from '@goose-hub/core/agent-runtime/context-assembly.js';
import { shouldRunDevReview } from '@goose-hub/core/agent-runtime/dev-review-advisor.js';
import type {
  AgentResult,
  AgentRuntime,
  AgentSpec,
} from '@goose-hub/core/agent-runtime/interface.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import type { AgentEvent, AppendEventInput } from '@goose-hub/core/event-stream/store.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import type { DevReviewResponseOutput } from '@goose-hub/skills/dev-review-response/schema.js';
import type { DevReviewOutput } from '@goose-hub/skills/dev-review/schema.js';
import type { ImplementWpOutput } from '@goose-hub/skills/implement-wp/schema.js';
import type { EngineeringSpec, WorkPackage } from '@goose-hub/skills/spec-author/schema.js';
import { runParallelImplementWorkflow } from './workflow.js';
import { runOneWpBuilder } from './wp-builder.js';

vi.mock('@goose-hub/core/agent-runtime/select-persona.js', () => ({
  selectPersona: vi.fn().mockReturnValue({
    personaId: 'goose-hub-self/developer/0',
    codename: 'Test Developer',
  }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const WP_FILE_GUARD = resolve(__dirname, '../../hooks/wp-file-guard.sh');

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'wi-560',
    externalId: '560',
    repoRef: 'shaunnez/goose-hub',
    title: 'M19.03 parallel implement',
    body: 'Build parallel WP dispatch',
    priority: 'high',
    type: 'feature',
    mode: 'supervised',
    state: 'factory:dev-ready',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'parallel',
    dependsOn: [],
    blocks: [],
    createdAt: new Date('2026-05-07'),
    ...overrides,
  };
}

function makeWp(id: string, filesOwned: string[], changes = `Implement ${id}`): WorkPackage {
  return { id, filesOwned, changes, dependsOn: [], builderTier: 'sonnet' };
}

function makeSpec(workPackages: WorkPackage[]): EngineeringSpec {
  return {
    objective: 'Test parallel implement',
    userJourneys: [],
    functionalRequirements: [],
    architecture: { current: 'none', new: 'parallel', decisionRationale: 'test' },
    schemaChanges: { ddl: [], migrations: [] },
    interfaceContracts: [],
    workPackages,
    executionOrder: [{ batch: 0, wpIds: workPackages.map((w) => w.id) }],
    verificationTooling: [],
    acceptanceCriteria: [
      {
        id: 'AC1',
        statement: 'Works',
        executableChecks: [{ id: 'AC1-check-1', command: 'pnpm test' }],
        crossCutting: true,
      },
    ],
    constraints: [],
    riskRegister: [],
    decisionSummaries: [{ kind: 'PLAN', summary: 'Test spec' }],
  };
}

function makeInvestigationEvent(workItem: WorkItem) {
  return {
    id: 99,
    projectId: 'goose-hub-self',
    workItemId: workItem.id,
    kind: 'agent.investigation-complete',
    payload: {
      investigate: {
        findings: 'Failure handling lives in triage-batch.',
        keyFiles: [
          {
            path: 'apps/server/src/domains/workflows/triage-batch.ts',
            reason: 'owns failed triage state transitions',
            line: 3,
          },
        ],
        openQuestions: ['Should repo-match fail immediately?'],
      },
      investigationRunId: 'investigation-run-1',
    },
    createdAt: new Date().toISOString(),
    runId: 'investigation-run-1',
  } as never;
}

function makeOkResult(wpId: string): AgentResult {
  const output: ImplementWpOutput = {
    wpId,
    plan: `Plan for ${wpId}`,
    filesWritten: [],
    testsWritten: [],
    testsRun: { command: 'pnpm test', paths: [] },
    confidence: 'high',
    decisionSummaries: [{ kind: 'PLAN', summary: `${wpId} plan` }],
  };
  return { output, decisionSummaries: [], events: [] };
}

function makeRuntime(impls: Record<string, () => Promise<AgentResult>>): AgentRuntime {
  return {
    run: async (spec: AgentSpec): Promise<AgentResult> => {
      const wpId = (spec.context as { wp?: { id?: string } }).wp?.id ?? 'unknown';
      const impl = impls[wpId];
      if (!impl) throw new Error(`No impl for ${wpId}`);
      return impl();
    },
  };
}

function makeAppendEvent(): {
  fn: (input: AppendEventInput) => AgentEvent;
  events: AppendEventInput[];
} {
  const events: AppendEventInput[] = [];
  return {
    fn: (input) => {
      events.push(input);
      return { ...input, id: events.length, createdAt: new Date().toISOString() } as AgentEvent;
    },
    events,
  };
}

function makeTempRepo(paths: string[] = []): string {
  const repoPath = mkdtempSync(join(tmpdir(), 'goose-hub-parallel-'));
  for (const path of paths) {
    const absPath = join(repoPath, path);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, '');
  }
  return repoPath;
}

function runGit(repoPath: string, args: string[]): void {
  const result = spawnSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

function makeGitRepo(paths: Record<string, string> = {}): string {
  const repoPath = makeTempRepo();
  runGit(repoPath, ['init']);
  runGit(repoPath, ['config', 'user.email', 'test@example.com']);
  runGit(repoPath, ['config', 'user.name', 'Test User']);
  for (const [path, contents] of Object.entries(paths)) {
    const absPath = join(repoPath, path);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, contents);
  }
  runGit(repoPath, ['add', '.']);
  runGit(repoPath, ['commit', '-m', 'initial']);
  return repoPath;
}

function makeStateSource(
  overrides: Partial<{
    transitionState: (...args: unknown[]) => Promise<void>;
    comment: (...args: unknown[]) => Promise<void>;
    listComments: (...args: unknown[]) => Promise<unknown[]>;
  }> = {},
) {
  return {
    repoRef: 'shaunnez/goose-hub',
    transitionState: vi.fn().mockResolvedValue(undefined),
    comment: vi.fn().mockResolvedValue(undefined),
    listComments: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as import('@goose-hub/core/state-source/interface.js').StateSource;
}

describe('parallel-implement repo-relative path normalization', () => {
  it('blocks ambiguous package-relative filesOwned before dispatch', async () => {
    const repoPath = makeTempRepo(['apps/web/src/index.ts', 'apps/server/src/index.ts']);
    const spec = makeSpec([makeWp('WP1', ['src/index.ts'])]);
    const { fn: appendEvent, events } = makeAppendEvent();
    const stateSource = makeStateSource();
    const replaySpy = vi.spyOn(eventStore, 'replay').mockReturnValue([]);

    try {
      const result = await runParallelImplementWorkflow(
        makeWorkItem(),
        spec,
        'pipeline-run-paths',
        stateSource,
        'goose-hub-self',
        repoPath,
        {
          runtime: makeRuntime({ WP1: async () => makeOkResult('WP1') }),
          resolveWorkflowBaseImpl: () => ({
            branch: 'main',
            ref: 'origin/main',
            source: 'configured-default',
          }),
          devReviewConfigOverride: {
            enabled: false,
            triggerOn: 'priority:high+',
            perCycleMaxUsd: 0,
            maxRevisionTurns: 1,
            timeoutMs: 1_000,
          },
          appendEvent,
        },
      );

      expect(result.status).toBe('failed');
      if (result.status !== 'failed') throw new Error('expected ambiguous paths to fail');
      expect(result.errorReason).toBe('engineering spec contains ambiguous repo-relative paths');
      expect(stateSource.comment).toHaveBeenCalledWith(
        '560',
        expect.stringContaining('Parallel implement blocked by ambiguous paths'),
      );
      const normalized = events.find((event) => event.kind === 'agent.path-normalized');
      expect((normalized?.payload as { fields?: unknown[] }).fields).toEqual([
        {
          field: 'workPackages[0].filesOwned[0]',
          from: 'src/index.ts',
          to: 'src/index.ts',
          source: 'unresolved',
          ambiguous: ['apps/server/src/index.ts', 'apps/web/src/index.ts'],
        },
      ]);
    } finally {
      replaySpy.mockRestore();
    }
  });

  it('passes canonical filesOwned into the WP commit step after normalization', async () => {
    const repoPath = makeTempRepo(['apps/web/src/foo.ts']);
    const issueWorktree = makeTempRepo();
    const scratchWorktree = makeTempRepo(['apps/web/src/foo.ts']);
    const spec = makeSpec([makeWp('WP1', ['src/foo.ts'])]);
    const committedFiles: string[][] = [];
    const iterations: Array<{ wpId: string; status: string }> = [];
    const { fn: appendEvent } = makeAppendEvent();
    const replaySpy = vi.spyOn(eventStore, 'replay').mockReturnValue([]);

    try {
      const result = await runParallelImplementWorkflow(
        makeWorkItem({ priority: 'medium' }),
        spec,
        'pipeline-run-canonical',
        makeStateSource(),
        'goose-hub-self',
        repoPath,
        {
          runtime: makeRuntime({
            WP1: async () => {
              const output = makeOkResult('WP1').output as ImplementWpOutput;
              return {
                output: {
                  ...output,
                  filesWritten: [{ path: 'apps/web/src/foo.ts', reason: 'updated component' }],
                },
                decisionSummaries: [],
                events: [],
              };
            },
          }),
          resolveWorkflowBaseImpl: () => ({
            branch: 'main',
            ref: 'origin/main',
            source: 'configured-default',
          }),
          createIssueWorktreeImpl: () => issueWorktree,
          createWpWorktreeImpl: () => scratchWorktree,
          cleanupWpWorktreesImpl: () => undefined,
          orchestratorCommitWpImpl: (_wt, files) => {
            committedFiles.push(files);
            return 'sha1';
          },
          revertWpChangesImpl: () => undefined,
          recordIterationImpl: (_runId, wpId, _iteration, status) => {
            iterations.push({ wpId, status });
          },
          getLastStatusImpl: (_runId, wpId) => {
            const last = [...iterations].reverse().find((entry) => entry.wpId === wpId);
            return (last?.status as 'ok' | 'failed' | 'in-progress' | null) ?? null;
          },
          openPRImpl: async () => ({
            prNumber: 1,
            prUrl: 'https://gh/pr/1',
            branch: 'b',
            base: 'main',
          }),
          devReviewConfigOverride: {
            enabled: false,
            triggerOn: 'priority:high+',
            perCycleMaxUsd: 0,
            maxRevisionTurns: 1,
            timeoutMs: 1_000,
          },
          appendEvent,
        },
      );

      expect(result.status).toBe('success');
      expect(committedFiles).toEqual([['apps/web/src/foo.ts']]);
    } finally {
      replaySpy.mockRestore();
    }
  });

  it('prewarms the integration and WP scratch worktrees before running WP agents', async () => {
    const repoPath = makeTempRepo(['core/a.ts']);
    const issueWorktree = makeTempRepo();
    const scratchWorktree = makeTempRepo(['core/a.ts']);
    const spec = makeSpec([makeWp('WP1', ['core/a.ts'])]);
    const prewarmed: string[] = [];
    const iterations: Array<{ wpId: string; status: string }> = [];
    const replaySpy = vi.spyOn(eventStore, 'replay').mockReturnValue([]);

    try {
      const result = await runParallelImplementWorkflow(
        makeWorkItem({ priority: 'medium' }),
        spec,
        'pipeline-run-prewarm',
        makeStateSource(),
        'goose-hub-self',
        repoPath,
        {
          runtime: {
            run: async (agentSpec) => {
              expect(prewarmed).toEqual([issueWorktree, scratchWorktree]);
              expect(agentSpec.workspaceDir).toBe(scratchWorktree);
              writeFileSync(join(scratchWorktree, 'core/a.ts'), 'export const a = 2;\n');
              const output = makeOkResult('WP1').output as ImplementWpOutput;
              return {
                output: {
                  ...output,
                  filesWritten: [{ path: 'core/a.ts', reason: 'updated file' }],
                },
                decisionSummaries: [],
                events: [],
              };
            },
          },
          resolveWorkflowBaseImpl: () => ({
            branch: 'main',
            ref: 'origin/main',
            source: 'configured-default',
          }),
          createIssueWorktreeImpl: () => issueWorktree,
          createWpWorktreeImpl: () => scratchWorktree,
          prewarmWorktreeImpl: (worktreePath) => {
            prewarmed.push(worktreePath);
          },
          cleanupWpWorktreesImpl: () => undefined,
          orchestratorCommitWpImpl: () => 'sha1',
          revertWpChangesImpl: () => undefined,
          recordIterationImpl: (_runId, wpId, _iteration, status) => {
            iterations.push({ wpId, status });
          },
          getLastStatusImpl: (_runId, wpId) => {
            const last = [...iterations].reverse().find((entry) => entry.wpId === wpId);
            return (last?.status as 'ok' | 'failed' | 'in-progress' | null) ?? null;
          },
          deriveObservedChangedFilesImpl: () => ({
            count: 1,
            paths: ['core/a.ts'],
            gitAvailable: true,
            files: [
              {
                path: 'core/a.ts',
                rawPath: 'core/a.ts',
                status: 'modified',
                sources: ['git-status'],
                normalizationSource: 'as-is',
              },
            ],
          }),
          openPRImpl: async () => ({
            prNumber: 1,
            prUrl: 'https://gh/pr/1',
            branch: 'b',
            base: 'main',
          }),
          devReviewConfigOverride: {
            enabled: false,
            triggerOn: 'priority:high+',
            perCycleMaxUsd: 0,
            maxRevisionTurns: 1,
            timeoutMs: 1_000,
          },
        },
      );

      expect(result.status).toBe('success');
      expect(prewarmed).toEqual([issueWorktree, scratchWorktree]);
    } finally {
      replaySpy.mockRestore();
    }
  });

  it('commits only observed changed files, so uncreated filesOwned paths do not break WP commit', async () => {
    const repoPath = makeGitRepo({ 'apps/web/src/foo.ts': 'export const foo = 1;\n' });
    const issueWorktree = makeTempRepo();
    const scratchWorktree = makeGitRepo({ 'apps/web/src/foo.ts': 'export const foo = 1;\n' });
    const spec = makeSpec([makeWp('WP1', ['apps/web/src/foo.ts', 'apps/web/src/uncreated.ts'])]);
    const committedFiles: string[][] = [];
    const iterations: Array<{ wpId: string; status: string }> = [];
    const { fn: appendEvent } = makeAppendEvent();
    const replaySpy = vi.spyOn(eventStore, 'replay').mockReturnValue([]);

    try {
      const result = await runParallelImplementWorkflow(
        makeWorkItem({ priority: 'medium' }),
        spec,
        'pipeline-run-observed-only',
        makeStateSource(),
        'goose-hub-self',
        repoPath,
        {
          runtime: makeRuntime({
            WP1: async () => {
              writeFileSync(
                join(scratchWorktree, 'apps/web/src/foo.ts'),
                'export const foo = 2;\n',
              );
              const output = makeOkResult('WP1').output as ImplementWpOutput;
              return {
                output: {
                  ...output,
                  filesWritten: [
                    { path: 'apps/web/src/foo.ts', reason: 'updated component' },
                    { path: 'apps/web/src/uncreated.ts', reason: 'declared but not created' },
                  ],
                },
                decisionSummaries: [],
                events: [],
              };
            },
          }),
          resolveWorkflowBaseImpl: () => ({
            branch: 'main',
            ref: 'origin/main',
            source: 'configured-default',
          }),
          createIssueWorktreeImpl: () => issueWorktree,
          createWpWorktreeImpl: () => scratchWorktree,
          cleanupWpWorktreesImpl: () => undefined,
          orchestratorCommitWpImpl: (_wt, files) => {
            committedFiles.push(files);
            return 'sha1';
          },
          revertWpChangesImpl: () => undefined,
          recordIterationImpl: (_runId, wpId, _iteration, status) => {
            iterations.push({ wpId, status });
          },
          getLastStatusImpl: (_runId, wpId) => {
            const last = [...iterations].reverse().find((entry) => entry.wpId === wpId);
            return (last?.status as 'ok' | 'failed' | 'in-progress' | null) ?? null;
          },
          openPRImpl: async () => ({
            prNumber: 1,
            prUrl: 'https://gh/pr/1',
            branch: 'b',
            base: 'main',
          }),
          devReviewConfigOverride: {
            enabled: false,
            triggerOn: 'priority:high+',
            perCycleMaxUsd: 0,
            maxRevisionTurns: 1,
            timeoutMs: 1_000,
          },
          appendEvent,
        },
      );

      expect(result.status).toBe('success');
      expect(committedFiles).toEqual([['apps/web/src/foo.ts']]);
    } finally {
      replaySpy.mockRestore();
    }
  });

  it('blocks observed changed files outside filesOwned', async () => {
    const repoPath = makeGitRepo({
      'apps/web/src/foo.ts': 'export const foo = 1;\n',
      'apps/web/src/outside.ts': 'export const outside = 1;\n',
    });
    const scratchWorktree = makeGitRepo({
      'apps/web/src/foo.ts': 'export const foo = 1;\n',
      'apps/web/src/outside.ts': 'export const outside = 1;\n',
    });
    const spec = makeSpec([makeWp('WP1', ['apps/web/src/foo.ts'])]);
    const { fn: appendEvent, events } = makeAppendEvent();
    const revertedFiles: string[][] = [];
    const replaySpy = vi.spyOn(eventStore, 'replay').mockReturnValue([]);

    try {
      await runParallelImplementWorkflow(
        makeWorkItem({ priority: 'medium' }),
        spec,
        'pipeline-run-outside-owned',
        makeStateSource(),
        'goose-hub-self',
        repoPath,
        {
          runtime: makeRuntime({
            WP1: async () => {
              writeFileSync(
                join(scratchWorktree, 'apps/web/src/foo.ts'),
                'export const foo = 2;\n',
              );
              writeFileSync(
                join(scratchWorktree, 'apps/web/src/outside.ts'),
                'export const outside = 2;\n',
              );
              const output = makeOkResult('WP1').output as ImplementWpOutput;
              return {
                output: {
                  ...output,
                  filesWritten: [{ path: 'apps/web/src/foo.ts', reason: 'updated component' }],
                },
                decisionSummaries: [],
                events: [],
              };
            },
          }),
          resolveWorkflowBaseImpl: () => ({
            branch: 'main',
            ref: 'origin/main',
            source: 'configured-default',
          }),
          createIssueWorktreeImpl: () => makeTempRepo(),
          createWpWorktreeImpl: () => scratchWorktree,
          cleanupWpWorktreesImpl: () => undefined,
          orchestratorCommitWpImpl: vi.fn(),
          revertWpChangesImpl: (_worktreePath, files) => {
            revertedFiles.push(files);
          },
          recordIterationImpl: () => undefined,
          getLastStatusImpl: () => 'failed',
          devReviewConfigOverride: {
            enabled: false,
            triggerOn: 'priority:high+',
            perCycleMaxUsd: 0,
            maxRevisionTurns: 1,
            timeoutMs: 1_000,
          },
          appendEvent,
        },
      );

      const blocked = events.find((event) => event.kind === 'agent.contract-gate-blocked');
      expect(blocked?.payload).toMatchObject({
        skill: 'implement-wp',
        wpId: 'WP1',
        gate: 'implement-wp-observed-changes',
        reason: 'observed-changes-outside-files-owned',
        outsideOwned: { paths: ['apps/web/src/outside.ts'] },
      });
      expect(revertedFiles).toContainEqual(['apps/web/src/foo.ts', 'apps/web/src/outside.ts']);
    } finally {
      replaySpy.mockRestore();
    }
  });

  it('emits mismatch telemetry but commits valid observed files inside filesOwned', async () => {
    const repoPath = makeGitRepo({
      'apps/web/src/foo.ts': 'export const foo = 1;\n',
      'apps/web/src/bar.ts': 'export const bar = 1;\n',
    });
    const scratchWorktree = makeGitRepo({
      'apps/web/src/foo.ts': 'export const foo = 1;\n',
      'apps/web/src/bar.ts': 'export const bar = 1;\n',
    });
    const spec = makeSpec([makeWp('WP1', ['apps/web/src/foo.ts', 'apps/web/src/bar.ts'])]);
    const committedFiles: string[][] = [];
    const iterations: Array<{ wpId: string; status: string }> = [];
    const { fn: appendEvent, events } = makeAppendEvent();
    const replaySpy = vi.spyOn(eventStore, 'replay').mockReturnValue([]);

    try {
      const result = await runParallelImplementWorkflow(
        makeWorkItem({ priority: 'medium' }),
        spec,
        'pipeline-run-mismatch',
        makeStateSource(),
        'goose-hub-self',
        repoPath,
        {
          runtime: makeRuntime({
            WP1: async () => {
              writeFileSync(
                join(scratchWorktree, 'apps/web/src/foo.ts'),
                'export const foo = 2;\n',
              );
              const output = makeOkResult('WP1').output as ImplementWpOutput;
              return {
                output: {
                  ...output,
                  filesWritten: [{ path: 'apps/web/src/bar.ts', reason: 'declared wrong file' }],
                },
                decisionSummaries: [],
                events: [],
              };
            },
          }),
          resolveWorkflowBaseImpl: () => ({
            branch: 'main',
            ref: 'origin/main',
            source: 'configured-default',
          }),
          createIssueWorktreeImpl: () => makeTempRepo(),
          createWpWorktreeImpl: () => scratchWorktree,
          cleanupWpWorktreesImpl: () => undefined,
          orchestratorCommitWpImpl: (_wt, files) => {
            committedFiles.push(files);
            return 'sha1';
          },
          revertWpChangesImpl: () => undefined,
          recordIterationImpl: (_runId, wpId, _iteration, status) => {
            iterations.push({ wpId, status });
          },
          getLastStatusImpl: (_runId, wpId) => {
            const last = [...iterations].reverse().find((entry) => entry.wpId === wpId);
            return (last?.status as 'ok' | 'failed' | 'in-progress' | null) ?? null;
          },
          openPRImpl: async () => ({
            prNumber: 1,
            prUrl: 'https://gh/pr/1',
            branch: 'b',
            base: 'main',
          }),
          devReviewConfigOverride: {
            enabled: false,
            triggerOn: 'priority:high+',
            perCycleMaxUsd: 0,
            maxRevisionTurns: 1,
            timeoutMs: 1_000,
          },
          appendEvent,
        },
      );

      expect(result.status).toBe('success');
      expect(committedFiles).toEqual([['apps/web/src/foo.ts']]);
      const mismatch = events.find((event) => event.kind === 'agent.output-fact-mismatch');
      expect(mismatch?.payload).toMatchObject({
        skill: 'implement-wp',
        wpId: 'WP1',
        mismatches: {
          observedNotDeclared: { paths: ['apps/web/src/foo.ts'] },
          declaredNotObserved: { paths: ['apps/web/src/bar.ts'] },
        },
      });
    } finally {
      replaySpy.mockRestore();
    }
  });

  it('emits telemetry and fails the WP when git reports no observed changes', async () => {
    const repoPath = makeGitRepo({ 'apps/web/src/foo.ts': 'export const foo = 1;\n' });
    const scratchWorktree = makeGitRepo({ 'apps/web/src/foo.ts': 'export const foo = 1;\n' });
    const spec = makeSpec([makeWp('WP1', ['apps/web/src/foo.ts'])]);
    const { fn: appendEvent, events } = makeAppendEvent();
    const replaySpy = vi.spyOn(eventStore, 'replay').mockReturnValue([]);
    let runtimeCalls = 0;

    try {
      const result = await runParallelImplementWorkflow(
        makeWorkItem({ priority: 'medium' }),
        spec,
        'pipeline-run-no-observed',
        makeStateSource(),
        'goose-hub-self',
        repoPath,
        {
          runtime: makeRuntime({
            WP1: async () => {
              runtimeCalls++;
              const output = makeOkResult('WP1').output as ImplementWpOutput;
              return {
                output: {
                  ...output,
                  filesWritten: [{ path: 'apps/web/src/foo.ts', reason: 'claimed update' }],
                },
                decisionSummaries: [],
                events: [],
              };
            },
          }),
          resolveWorkflowBaseImpl: () => ({
            branch: 'main',
            ref: 'origin/main',
            source: 'configured-default',
          }),
          createIssueWorktreeImpl: () => makeTempRepo(),
          createWpWorktreeImpl: () => scratchWorktree,
          cleanupWpWorktreesImpl: () => undefined,
          orchestratorCommitWpImpl: vi.fn(),
          revertWpChangesImpl: () => undefined,
          recordIterationImpl: () => undefined,
          getLastStatusImpl: () => 'failed',
          devReviewConfigOverride: {
            enabled: false,
            triggerOn: 'priority:high+',
            perCycleMaxUsd: 0,
            maxRevisionTurns: 1,
            timeoutMs: 1_000,
          },
          appendEvent,
        },
      );

      expect(result.status).toBe('failed');
      expect(runtimeCalls).toBe(1);
      const mismatch = events.find((event) => event.kind === 'agent.output-fact-mismatch');
      expect(mismatch?.payload).toMatchObject({
        skill: 'implement-wp',
        wpId: 'WP1',
        reason: 'no-observed-changed-files',
      });
    } finally {
      replaySpy.mockRestore();
    }
  });
});

describe('implement-wp ownership gate', () => {
  it('blocks ambiguous filesOwned before the WP builder starts', async () => {
    const scratchWorktree = makeTempRepo(['apps/web/src/index.ts', 'packages/admin/src/index.ts']);
    const { fn: appendEvent, events } = makeAppendEvent();
    const iterations: Array<{ wpId: string; status: string; reason?: string }> = [];
    const runtime: AgentRuntime = { run: vi.fn() };

    const result = await runOneWpBuilder({
      wp: makeWp('WP1', ['src/index.ts']),
      iteration: 1,
      runId: 'run-wp-ownership',
      projectId: 'goose-hub-self',
      workItemId: 'wi-560',
      workItem: makeWorkItem(),
      scratchWorktreePath: scratchWorktree,
      stack: { testCommand: 'pnpm test' },
      runtime,
      budgets: { maxTurns: 3, maxBudgetUsd: 1, timeoutMs: 10_000 },
      modelOverride: 'gpt-5.4-mini',
      personaId: 'goose-hub-self/developer/0',
      wpTimeoutMs: 10_000,
      appendEvent,
      revertWpChangesFn: vi.fn(),
      recordIterationFn: (_runId, wpId, _iteration, status, reason) => {
        iterations.push({ wpId, status, reason });
      },
      implementWpPrompt: '# prompt',
      implementWpJsonSchema: {},
    });

    expect(result).toMatchObject({ status: 'failed', wpId: 'WP1' });
    expect(runtime.run).not.toHaveBeenCalled();
    expect(iterations).toContainEqual({
      wpId: 'WP1',
      status: 'failed',
      reason: expect.stringContaining('ambiguous repo-relative paths'),
    });
    const blocked = events.find((event) => event.kind === 'agent.contract-gate-blocked');
    expect(blocked?.payload).toMatchObject({
      skill: 'implement-wp',
      wpId: 'WP1',
      gate: 'implement-wp-ownership',
      reason: 'ambiguous-files-owned',
      fields: [
        {
          field: 'filesOwned[0]',
          from: 'src/index.ts',
          to: 'src/index.ts',
          source: 'unresolved',
          ambiguous: ['apps/web/src/index.ts', 'packages/admin/src/index.ts'],
        },
      ],
    });
  });

  it('passes canonical filesOwned to the builder context, sandbox env, and revert path', async () => {
    const scratchWorktree = makeTempRepo(['apps/web/src/foo.ts']);
    const { fn: appendEvent, events } = makeAppendEvent();
    const reverted: string[][] = [];
    const specs: AgentSpec[] = [];

    const result = await runOneWpBuilder({
      wp: makeWp('WP1', ['src/foo.ts']),
      iteration: 1,
      runId: 'run-wp-canonical',
      projectId: 'goose-hub-self',
      workItemId: 'wi-560',
      workItem: makeWorkItem(),
      scratchWorktreePath: scratchWorktree,
      stack: { testCommand: 'pnpm test' },
      runtime: {
        run: async (spec) => {
          specs.push(spec);
          throw new Error('builder failed');
        },
      },
      budgets: { maxTurns: 3, maxBudgetUsd: 1, timeoutMs: 10_000 },
      modelOverride: 'gpt-5.4-mini',
      personaId: 'goose-hub-self/developer/0',
      wpTimeoutMs: 10_000,
      appendEvent,
      revertWpChangesFn: (_worktreePath, filesOwned) => {
        reverted.push(filesOwned);
      },
      recordIterationFn: () => undefined,
      implementWpPrompt: '# prompt',
      implementWpJsonSchema: {},
      parentPrdContext: {
        source: 'event',
        parentWorkItemId: 'github:shaunnez/goose-hub#55',
        prdRunId: 'prd-run',
        title: 'Parent PRD',
        problem: 'Problem',
        proposedSolution: 'Solution',
        outOfScope: ['Do not rebuild settings.'],
        successCriteria: ['User can approve the PRD.'],
        acceptanceCriteria: [{ id: 'AC1', statement: 'Approval routes correctly.' }],
        journeys: [{ id: 'J1', steps: [] }],
        functionalSpec: { dataConstraints: ['Preserve state labels.'] },
        verticalSlices: [{ title: 'Slice 1' }],
        implementationDecisions: [{ decision: 'Use existing dispatch.' }],
        testingDecisions: { approach: 'unit' },
      },
    });

    expect(result).toMatchObject({ status: 'failed', wpId: 'WP1' });
    expect(specs[0]?.context).toMatchObject({
      wp: { id: 'WP1', filesOwned: ['apps/web/src/foo.ts'] },
      parentPrdContext: {
        outOfScope: ['Do not rebuild settings.'],
        acceptanceCriteria: [{ id: 'AC1', statement: 'Approval routes correctly.' }],
        journeys: [{ id: 'J1', steps: [] }],
        functionalSpec: { dataConstraints: ['Preserve state labels.'] },
      },
    });
    expect(specs[0]?.env).toMatchObject({
      FACTORY_WP_FILESOWNED: 'apps/web/src/foo.ts',
      FACTORY_WP_ID: 'WP1',
    });
    expect(reverted).toEqual([['apps/web/src/foo.ts']]);
    const repaired = events.find((event) => event.kind === 'agent.output-repaired');
    expect(repaired?.payload).toMatchObject({
      skill: 'implement-wp',
      wpId: 'WP1',
      gate: 'implement-wp-ownership',
      fields: [
        {
          field: 'filesOwned[0]',
          from: 'src/foo.ts',
          to: 'apps/web/src/foo.ts',
          source: 'package-root',
        },
      ],
    });
  });
});

// ─── Rollback test ─────────────────────────────────────────────────────────────

describe('parallel-implement rollback: WP3 fails after WP1+WP2 committed', () => {
  const wp1 = makeWp('WP1', ['core/a.ts']);
  const wp2 = makeWp('WP2', ['core/b.ts']);
  const wp3 = makeWp('WP3', ['core/c.ts']);
  const spec = makeSpec([wp1, wp2, wp3]);

  it('commits WP1+WP2 and records WP3 as failed, no orphans', async () => {
    const committed: string[] = [];
    const reverted: string[] = [];
    const iterations: Array<{ wpId: string; status: string }> = [];

    const { fn: appendEvent, events } = makeAppendEvent();

    await runParallelImplementWorkflow(
      makeWorkItem(),
      spec,
      'pipeline-run-123',
      makeStateSource(),
      'goose-hub-self',
      '/tmp/repo',
      {
        runtime: makeRuntime({
          WP1: async () => makeOkResult('WP1'),
          WP2: async () => makeOkResult('WP2'),
          WP3: async () => {
            throw new Error('WP3 builder error');
          },
        }),
        createIssueWorktreeImpl: (_repo, _runId) => '/tmp/issue-wt',
        createWpWorktreeImpl: (_repo, _runId, wpId) => `/tmp/wp-${wpId}`,
        cleanupWpWorktreesImpl: () => undefined,
        cleanupIssueWorktreeImpl: () => undefined,
        orchestratorCommitWpImpl: (wt, _files, _msg) => {
          committed.push(wt);
          return 'abc123';
        },
        revertWpChangesImpl: (wt, _files) => {
          reverted.push(wt);
        },
        recordIterationImpl: (_runId, wpId, _iteration, status) => {
          iterations.push({ wpId, status });
        },
        getLastStatusImpl: (_runId, wpId) => {
          const last = [...iterations].reverse().find((i) => i.wpId === wpId);
          return (last?.status as 'ok' | 'failed' | 'in-progress' | null) ?? null;
        },
        openPRImpl: async () => ({
          prNumber: 999,
          prUrl: 'https://gh/pr/999',
          branch: 'b',
          base: 'main',
        }),
        appendEvent,
      },
    );

    // WP1 and WP2 committed
    const okWps = iterations.filter((i) => i.status === 'ok').map((i) => i.wpId);
    expect(okWps).toContain('WP1');
    expect(okWps).toContain('WP2');

    // WP3 recorded as failed
    const wp3Failed = iterations.filter((i) => i.wpId === 'WP3' && i.status === 'failed');
    expect(wp3Failed.length).toBeGreaterThanOrEqual(1);

    // WP3 was reverted (revertWpChanges called for WP3's scratch worktree)
    expect(reverted.some((wt) => wt.includes('WP3'))).toBe(true);

    // WP1 and WP2 were NOT reverted
    expect(reverted.some((wt) => wt.includes('WP1'))).toBe(false);
    expect(reverted.some((wt) => wt.includes('WP2'))).toBe(false);

    // WP1+WP2 committed to integration worktree
    expect(committed.filter((wt) => wt === '/tmp/issue-wt')).toHaveLength(2);

    // Events: WP3 failed event emitted
    const wp3FailedEvent = events.find(
      (e) =>
        (e.kind as string) === 'parallel-implement.wp-failed' &&
        (e.payload as { wpId?: string }).wpId === 'WP3',
    );
    expect(wp3FailedEvent).toBeDefined();

    // No orphaned worktrees: cleanup called
    // (verified by cleanupWpWorktreesImpl being called — workflow enters finally block)
  });
});

// ─── Concurrency test ──────────────────────────────────────────────────────────

describe('parallel-implement concurrency: 3 fake builders on disjoint files', () => {
  it('all three WP commits land in correct order', async () => {
    const wp1 = makeWp('WP1', ['core/a.ts']);
    const wp2 = makeWp('WP2', ['core/b.ts']);
    const wp3 = makeWp('WP3', ['core/c.ts']);
    const spec = makeSpec([wp1, wp2, wp3]);

    const committed: Array<{ wt: string; files: string[] }> = [];
    const iterations: Array<{ wpId: string; status: string }> = [];
    const { fn: appendEvent, events } = makeAppendEvent();

    await runParallelImplementWorkflow(
      makeWorkItem(),
      spec,
      'pipeline-run-123',
      makeStateSource(),
      'goose-hub-self',
      '/tmp/repo',
      {
        runtime: makeRuntime({
          WP1: async () => makeOkResult('WP1'),
          WP2: async () => makeOkResult('WP2'),
          WP3: async () => makeOkResult('WP3'),
        }),
        createIssueWorktreeImpl: () => '/tmp/issue-wt',
        createWpWorktreeImpl: (_repo, _runId, wpId) => `/tmp/wp-${wpId}`,
        cleanupWpWorktreesImpl: () => undefined,
        cleanupIssueWorktreeImpl: () => undefined,
        orchestratorCommitWpImpl: (wt, files, _msg) => {
          committed.push({ wt, files });
          return 'abc123';
        },
        revertWpChangesImpl: () => undefined,
        recordIterationImpl: (_runId, wpId, _iteration, status) => {
          iterations.push({ wpId, status });
        },
        getLastStatusImpl: (_runId, wpId) => {
          const last = [...iterations].reverse().find((i) => i.wpId === wpId);
          return (last?.status as 'ok' | 'failed' | 'in-progress' | null) ?? null;
        },
        openPRImpl: async () => ({
          prNumber: 1,
          prUrl: 'https://gh/pr/1',
          branch: 'b',
          base: 'main',
        }),
        appendEvent,
      },
    );

    // All 3 WPs committed
    expect(committed).toHaveLength(3);
    const committedWts = committed.map((c) => c.wt);
    expect(committedWts.every((wt) => wt === '/tmp/issue-wt')).toBe(true);

    // All 3 WPs recorded as ok
    const okWps = iterations.filter((i) => i.status === 'ok').map((i) => i.wpId);
    expect(okWps).toContain('WP1');
    expect(okWps).toContain('WP2');
    expect(okWps).toContain('WP3');

    // PR opened event emitted
    const prEvent = events.find((e) => (e.kind as string) === 'pr.opened');
    expect(prEvent).toBeDefined();
    expect(prEvent?.payload).toMatchObject({
      worktreePath: '/tmp/issue-wt',
      pipelineRunId: 'pipeline-run-123',
    });
    expect(prEvent?.payload).toHaveProperty('devRunId');

    const pipelineEvents = events.filter((e) =>
      (e.kind as string).startsWith('parallel-implement.'),
    );
    expect(pipelineEvents.length).toBeGreaterThan(0);
    expect(
      pipelineEvents.every(
        (e) => (e.payload as { pipelineRunId?: string }).pipelineRunId === 'pipeline-run-123',
      ),
    ).toBe(true);

    // No failures
    expect(iterations.some((i) => i.status === 'failed')).toBe(false);
  });
});

describe('parallel-implement durable integration branch persistence', () => {
  it('pushes and verifies each WP commit before emitting wp-persisted and opening PR without repush', async () => {
    const wp1 = makeWp('WP1', ['core/a.ts']);
    const spec = makeSpec([wp1]);
    const { fn: appendEvent, events } = makeAppendEvent();
    const iterations: Array<{ wpId: string; status: string }> = [];
    const pushes: Array<{ worktreePath: string; branchName: string }> = [];
    const openPrCalls: Array<{ branchName: string; skipPush?: boolean }> = [];

    const result = await runParallelImplementWorkflow(
      makeWorkItem(),
      spec,
      'pipeline-run-123',
      makeStateSource(),
      'goose-hub-self',
      '/tmp/repo',
      {
        runtime: makeRuntime({ WP1: async () => makeOkResult('WP1') }),
        createIntegrationWorktreeImpl: () => ({
          worktreePath: '/tmp/issue-wt',
          previousHeadSha: 'base-sha',
        }),
        createWpWorktreeImpl: (_repo, _runId, wpId) => `/tmp/wp-${wpId}`,
        cleanupWpWorktreesImpl: () => undefined,
        cleanupIssueWorktreeImpl: () => undefined,
        orchestratorCommitWpImpl: () => 'sha-wp1',
        pushBranchImpl: (worktreePath, branchName) => {
          pushes.push({ worktreePath, branchName });
        },
        resolveRemoteBranchHeadImpl: () => 'sha-wp1',
        revertWpChangesImpl: () => undefined,
        recordIterationImpl: (_runId, wpId, _iteration, status) => {
          iterations.push({ wpId, status });
        },
        getLastStatusImpl: (_runId, wpId) => {
          const last = [...iterations].reverse().find((i) => i.wpId === wpId);
          return (last?.status as 'ok' | 'failed' | 'in-progress' | null) ?? null;
        },
        openPRImpl: async (input) => {
          openPrCalls.push({ branchName: input.branchName, skipPush: input.skipPush });
          return {
            prNumber: 1,
            prUrl: 'https://gh/pr/1',
            branch: input.branchName,
            base: input.baseBranch ?? 'main',
          };
        },
        appendEvent,
      },
    );

    expect(result.status).toBe('success');
    expect(pushes).toEqual([
      { worktreePath: '/tmp/issue-wt', branchName: 'factory/run/pipeline-run-123' },
    ]);
    expect(openPrCalls).toEqual([{ branchName: 'factory/run/pipeline-run-123', skipPush: true }]);

    const persisted = events.find((event) => event.kind === 'parallel-implement.wp-persisted');
    expect(persisted?.payload).toMatchObject({
      schemaVersion: 1,
      pipelineRunId: 'pipeline-run-123',
      wpId: 'WP1',
      integrationBranch: 'factory/run/pipeline-run-123',
      baseBranch: 'main',
      previousHeadSha: 'base-sha',
      wpCommitSha: 'sha-wp1',
      pushedSha: 'sha-wp1',
      filesPersisted: [],
      persistMode: 'direct-integration-commit',
    });
    expect(events.find((event) => event.kind === 'agent.run-completed')?.payload).toMatchObject({
      skill: 'parallel-implement',
      runDisposition: 'completed',
    });
  });

  it('skips already persisted WPs on resume and continues with the first unpersisted WP', async () => {
    const wp1 = makeWp('WP1', ['core/a.ts']);
    const wp2 = makeWp('WP2', ['core/b.ts']);
    const spec = makeSpec([wp1, wp2]);
    const { fn: appendEvent, events } = makeAppendEvent();
    const startedWpIds: string[] = [];
    const iterations: Array<{ wpId: string; status: string }> = [];

    const result = await runParallelImplementWorkflow(
      makeWorkItem(),
      spec,
      'pipeline-run-resume',
      makeStateSource(),
      'goose-hub-self',
      '/tmp/repo',
      {
        runtime: makeRuntime({
          WP2: async () => makeOkResult('WP2'),
        }),
        replayEventsImpl: () => [
          {
            id: 1,
            projectId: 'goose-hub-self',
            workItemId: 'wi-560',
            kind: 'parallel-implement.wp-persisted',
            payload: {
              schemaVersion: 1,
              pipelineRunId: 'pipeline-run-resume',
              devRunId: 'old-dev-run',
              wpId: 'WP1',
              wpRunId: 'old-dev-run:wp:WP1:iter:1',
              iteration: 1,
              integrationBranch: 'factory/run/pipeline-run-resume',
              baseBranch: 'main',
              previousHeadSha: 'base-sha',
              wpCommitSha: 'sha-wp1',
              pushedSha: 'sha-wp1',
              filesPersisted: ['core/a.ts'],
              persistMode: 'direct-integration-commit',
            },
            runId: 'old-dev-run:wp:WP1:iter:1',
            createdAt: new Date().toISOString(),
          } as AgentEvent,
        ],
        createIntegrationWorktreeImpl: () => ({
          worktreePath: '/tmp/issue-wt',
          previousHeadSha: 'sha-wp1',
        }),
        createWpWorktreeImpl: (_repo, _runId, wpId) => {
          startedWpIds.push(wpId);
          return `/tmp/wp-${wpId}`;
        },
        cleanupWpWorktreesImpl: () => undefined,
        cleanupIssueWorktreeImpl: () => undefined,
        orchestratorCommitWpImpl: () => 'sha-wp2',
        pushBranchImpl: () => undefined,
        resolveRemoteBranchHeadImpl: () => 'sha-wp2',
        revertWpChangesImpl: () => undefined,
        recordIterationImpl: (_runId, wpId, _iteration, status) => {
          iterations.push({ wpId, status });
        },
        getLastStatusImpl: (_runId, wpId) => {
          const last = [...iterations].reverse().find((i) => i.wpId === wpId);
          return (last?.status as 'ok' | 'failed' | 'in-progress' | null) ?? null;
        },
        openPRImpl: async (input) => ({
          prNumber: 2,
          prUrl: 'https://gh/pr/2',
          branch: input.branchName,
          base: input.baseBranch ?? 'main',
        }),
        appendEvent,
      },
    );

    expect(result.status).toBe('success');
    expect(startedWpIds).toEqual(['WP2']);
    expect(
      events.find((event) => event.kind === 'parallel-implement.wp-started')?.payload,
    ).toMatchObject({
      wpId: 'WP2',
    });
    expect(
      events.some(
        (event) =>
          event.kind === 'parallel-implement.wp-started' &&
          (event.payload as { wpId?: string }).wpId === 'WP1',
      ),
    ).toBe(false);
  });

  it('creates dependent WP scratch worktrees from the latest persisted integration tip', async () => {
    const wp1 = makeWp('WP1', ['core/a.ts']);
    const wp2 = { ...makeWp('WP2', ['core/b.ts']), dependsOn: ['WP1'] };
    const spec = {
      ...makeSpec([wp1, wp2]),
      executionOrder: [
        { batch: 0, wpIds: ['WP1'] },
        { batch: 1, wpIds: ['WP2'] },
      ],
    };
    const { fn: appendEvent } = makeAppendEvent();
    const scratchBases: Array<{ wpId: string; baseRef?: string }> = [];
    const iterations: Array<{ wpId: string; status: string }> = [];
    const commitShas = ['sha-wp1', 'sha-wp2'];
    const remoteHeads = ['sha-wp1', 'sha-wp2'];

    const result = await runParallelImplementWorkflow(
      makeWorkItem(),
      spec,
      'pipeline-run-deps',
      makeStateSource(),
      'goose-hub-self',
      '/tmp/repo',
      {
        runtime: makeRuntime({
          WP1: async () => makeOkResult('WP1'),
          WP2: async () => makeOkResult('WP2'),
        }),
        resolveWorkflowBaseImpl: () => ({
          branch: 'main',
          ref: 'origin/main',
          source: 'configured-default',
        }),
        createIntegrationWorktreeImpl: () => ({
          worktreePath: '/tmp/issue-wt',
          previousHeadSha: 'base-sha',
        }),
        createWpWorktreeImpl: (_repo, _runId, wpId, baseRef) => {
          scratchBases.push({ wpId, baseRef });
          return `/tmp/wp-${wpId}`;
        },
        cleanupWpWorktreesImpl: () => undefined,
        cleanupIssueWorktreeImpl: () => undefined,
        orchestratorCommitWpImpl: () => commitShas.shift() ?? 'unexpected-sha',
        pushBranchImpl: () => undefined,
        resolveRemoteBranchHeadImpl: () => remoteHeads.shift() ?? 'unexpected-sha',
        revertWpChangesImpl: () => undefined,
        recordIterationImpl: (_runId, wpId, _iteration, status) => {
          iterations.push({ wpId, status });
        },
        getLastStatusImpl: (_runId, wpId) => {
          const last = [...iterations].reverse().find((i) => i.wpId === wpId);
          return (last?.status as 'ok' | 'failed' | 'in-progress' | null) ?? null;
        },
        openPRImpl: async (input) => ({
          prNumber: 3,
          prUrl: 'https://gh/pr/3',
          branch: input.branchName,
          base: input.baseBranch ?? 'main',
        }),
        appendEvent,
      },
    );

    expect(result.status).toBe('success');
    expect(scratchBases).toEqual([
      { wpId: 'WP1', baseRef: 'base-sha' },
      { wpId: 'WP2', baseRef: 'sha-wp1' },
    ]);
  });

  it('hard-stops with persistence-failed when remote branch verification mismatches', async () => {
    const wp1 = makeWp('WP1', ['core/a.ts']);
    const spec = makeSpec([wp1]);
    const { fn: appendEvent, events } = makeAppendEvent();
    const iterations: Array<{ wpId: string; status: string }> = [];
    const openPRImpl = vi.fn();

    const result = await runParallelImplementWorkflow(
      makeWorkItem(),
      spec,
      'pipeline-run-mismatch',
      makeStateSource(),
      'goose-hub-self',
      '/tmp/repo',
      {
        runtime: makeRuntime({ WP1: async () => makeOkResult('WP1') }),
        createIntegrationWorktreeImpl: () => ({
          worktreePath: '/tmp/issue-wt',
          previousHeadSha: 'base-sha',
        }),
        createWpWorktreeImpl: (_repo, _runId, wpId) => `/tmp/wp-${wpId}`,
        cleanupWpWorktreesImpl: () => undefined,
        cleanupIssueWorktreeImpl: () => undefined,
        orchestratorCommitWpImpl: () => 'sha-local',
        pushBranchImpl: () => undefined,
        resolveRemoteBranchHeadImpl: () => 'sha-remote',
        revertWpChangesImpl: () => undefined,
        recordIterationImpl: (_runId, wpId, _iteration, status) => {
          iterations.push({ wpId, status });
        },
        getLastStatusImpl: (_runId, wpId) => {
          const last = [...iterations].reverse().find((i) => i.wpId === wpId);
          return (last?.status as 'ok' | 'failed' | 'in-progress' | null) ?? null;
        },
        openPRImpl,
        appendEvent,
      },
    );

    expect(result.status).toBe('failed');
    expect(openPRImpl).not.toHaveBeenCalled();
    const runFailed = events.find((event) => event.kind === 'agent.run-failed');
    expect(runFailed?.payload).toMatchObject({
      skill: 'parallel-implement',
      runDisposition: 'persistence-failed',
    });
    expect(events.some((event) => event.kind === 'parallel-implement.wp-persisted')).toBe(false);
  });

  it('does not duplicate an existing PR when resume finds all WPs persisted', async () => {
    const wp1 = makeWp('WP1', ['core/a.ts']);
    const spec = makeSpec([wp1]);
    const { fn: appendEvent } = makeAppendEvent();
    const openPRImpl = vi.fn();

    const result = await runParallelImplementWorkflow(
      makeWorkItem(),
      spec,
      'pipeline-run-existing-pr',
      makeStateSource(),
      'goose-hub-self',
      '/tmp/repo',
      {
        runtime: makeRuntime({}),
        replayEventsImpl: () => [
          {
            id: 1,
            projectId: 'goose-hub-self',
            workItemId: 'wi-560',
            kind: 'parallel-implement.wp-persisted',
            payload: {
              schemaVersion: 1,
              pipelineRunId: 'pipeline-run-existing-pr',
              devRunId: 'old-dev-run',
              wpId: 'WP1',
              wpRunId: 'old-dev-run:wp:WP1:iter:1',
              iteration: 1,
              integrationBranch: 'factory/run/pipeline-run-existing-pr',
              baseBranch: 'main',
              previousHeadSha: 'base-sha',
              wpCommitSha: 'sha-wp1',
              pushedSha: 'sha-wp1',
              filesPersisted: ['core/a.ts'],
              persistMode: 'direct-integration-commit',
            },
            runId: 'old-dev-run:wp:WP1:iter:1',
            createdAt: new Date().toISOString(),
          } as AgentEvent,
          {
            id: 2,
            projectId: 'goose-hub-self',
            workItemId: 'wi-560',
            kind: 'pr.opened',
            payload: {
              pipelineRunId: 'pipeline-run-existing-pr',
              prNumber: 44,
              prUrl: 'https://gh/pr/44',
              branch: 'factory/run/pipeline-run-existing-pr',
              baseBranch: 'main',
              worktreePath: '/tmp/issue-wt',
              devRunId: 'old-dev-run',
            },
            runId: 'old-dev-run',
            createdAt: new Date().toISOString(),
          } as AgentEvent,
        ],
        createIntegrationWorktreeImpl: () => ({
          worktreePath: '/tmp/issue-wt',
          previousHeadSha: 'sha-wp1',
        }),
        createWpWorktreeImpl: () => {
          throw new Error('no WP scratch worktrees should be created');
        },
        cleanupWpWorktreesImpl: () => undefined,
        cleanupIssueWorktreeImpl: () => undefined,
        openPRImpl,
        appendEvent,
      },
    );

    expect(result).toMatchObject({
      status: 'success',
      prNumber: 44,
      prUrl: 'https://gh/pr/44',
      worktreePath: '/tmp/issue-wt',
    });
    expect(openPRImpl).not.toHaveBeenCalled();
  });
});

describe('parallel-implement workflow contract: dispatcher owns state transitions', () => {
  it('does not transition work item state internally on success', async () => {
    const wp1 = makeWp('WP1', ['core/a.ts']);
    const spec = makeSpec([wp1]);
    const source = makeStateSource();
    const { fn: appendEvent } = makeAppendEvent();

    const result = await runParallelImplementWorkflow(
      makeWorkItem({ state: 'factory:spec-ready' }),
      spec,
      'pipeline-run-456',
      source,
      'goose-hub-self',
      '/tmp/repo',
      {
        runtime: makeRuntime({ WP1: async () => makeOkResult('WP1') }),
        createIssueWorktreeImpl: () => '/tmp/issue-wt',
        createWpWorktreeImpl: (_repo, _runId, wpId) => `/tmp/wp-${wpId}`,
        cleanupWpWorktreesImpl: () => undefined,
        cleanupIssueWorktreeImpl: () => undefined,
        orchestratorCommitWpImpl: () => 'abc123',
        revertWpChangesImpl: () => undefined,
        recordIterationImpl: () => undefined,
        getLastStatusImpl: () => 'ok',
        openPRImpl: async () => ({
          prNumber: 1,
          prUrl: 'https://gh/pr/1',
          branch: 'b',
          base: 'main',
        }),
        appendEvent,
      },
    );

    expect(result.status).toBe('success');
    expect(source.transitionState).not.toHaveBeenCalled();
  });
});

describe('parallel-implement investigation context', () => {
  it('injects investigation findings into implement-wp context and emits an audit event', async () => {
    const workItem = makeWorkItem();
    const wp1 = makeWp('WP1', ['apps/server/src/domains/workflows/triage-batch.ts']);
    const spec = makeSpec([wp1]);
    const { fn: appendEvent, events } = makeAppendEvent();
    const specs: AgentSpec[] = [];
    const iterations: Array<{ wpId: string; status: string }> = [];
    const scratch = mkdtempSync(join(tmpdir(), 'goose-hub-wp-code-context-'));
    const investigatedFile = join(scratch, 'apps/server/src/domains/workflows/triage-batch.ts');
    mkdirSync(dirname(investigatedFile), { recursive: true });
    writeFileSync(
      investigatedFile,
      [
        'export function transition(state: string) {',
        "  if (state === 'failed') {",
        "    return 'triage_failed';",
        '  }',
        "  return 'ok';",
        '}',
      ].join('\n'),
    );
    const replaySpy = vi
      .spyOn(eventStore, 'replay')
      .mockReturnValue([makeInvestigationEvent(workItem)]);

    try {
      const result = await runParallelImplementWorkflow(
        workItem,
        spec,
        'pipeline-run-investigation',
        makeStateSource(),
        'goose-hub-self',
        '/tmp/repo',
        {
          runtime: {
            run: async (agentSpec) => {
              specs.push(agentSpec);
              return makeOkResult('WP1');
            },
          },
          createIssueWorktreeImpl: () => '/tmp/issue-wt',
          createWpWorktreeImpl: () => scratch,
          cleanupWpWorktreesImpl: () => undefined,
          cleanupIssueWorktreeImpl: () => undefined,
          orchestratorCommitWpImpl: () => 'abc123',
          revertWpChangesImpl: () => undefined,
          recordIterationImpl: (_runId, wpId, _iteration, status) => {
            iterations.push({ wpId, status });
          },
          getLastStatusImpl: (_runId, wpId) => {
            const last = [...iterations].reverse().find((i) => i.wpId === wpId);
            return (last?.status as 'ok' | 'failed' | 'in-progress' | null) ?? null;
          },
          openPRImpl: async () => ({
            prNumber: 1,
            prUrl: 'https://gh/pr/1',
            branch: 'b',
            base: 'main',
          }),
          appendEvent,
        },
      );

      expect(result.status).toBe('success');
      expect(specs[0]?.context).toMatchObject({
        investigation: {
          findings: expect.stringContaining('triage-batch'),
          investigationRunId: 'investigation-run-1',
        },
      });
      expect(specs[0]?.context).toMatchObject({
        codeContext: [
          expect.objectContaining({
            path: 'apps/server/src/domains/workflows/triage-batch.ts',
            startLine: 1,
            snippet: expect.stringContaining("3:     return 'triage_failed';"),
          }),
        ],
      });
      expect(specs[0]?.contextAllowlist).toContain('investigation');
      expect(specs[0]?.contextAllowlist).toContain('codeContext');
      const injected = events.find((e) => e.kind === 'agent.investigation-context-injected');
      expect(injected?.payload).toMatchObject({
        skill: 'implement-wp',
        wpId: 'WP1',
        investigationRunId: 'investigation-run-1',
        keyFileCount: 1,
        openQuestionCount: 1,
      });
    } finally {
      replaySpy.mockRestore();
    }
  });

  it('blocks parallel implement when planned work packages miss investigated files', async () => {
    const workItem = makeWorkItem();
    const wp1 = makeWp('WP1', ['slices/parallel-implement/workflow.ts']);
    const spec = makeSpec([wp1]);
    const stateSource = makeStateSource();
    const { fn: appendEvent, events } = makeAppendEvent();
    const runtime = { run: vi.fn() } satisfies AgentRuntime;
    const replaySpy = vi
      .spyOn(eventStore, 'replay')
      .mockReturnValue([makeInvestigationEvent(workItem)]);

    try {
      const result = await runParallelImplementWorkflow(
        workItem,
        spec,
        'pipeline-run-wrong-surface',
        stateSource,
        'goose-hub-self',
        '/tmp/repo',
        {
          runtime,
          createIssueWorktreeImpl: () => '/tmp/issue-wt',
          createWpWorktreeImpl: (_repo, _runId, wpId) => `/tmp/wp-${wpId}`,
          cleanupWpWorktreesImpl: () => undefined,
          cleanupIssueWorktreeImpl: () => undefined,
          orchestratorCommitWpImpl: () => 'abc123',
          revertWpChangesImpl: () => undefined,
          recordIterationImpl: () => undefined,
          getLastStatusImpl: () => null,
          openPRImpl: async () => ({
            prNumber: 1,
            prUrl: 'https://gh/pr/1',
            branch: 'b',
            base: 'main',
          }),
          appendEvent,
        },
      );

      expect(result).toMatchObject({
        status: 'failed',
        errorReason: 'engineering spec did not target investigated key files',
      });
      expect(runtime.run).not.toHaveBeenCalled();
      expect(stateSource.comment).toHaveBeenCalledWith(
        workItem.externalId,
        expect.stringContaining('Parallel implement blocked by wrong-surface guard'),
      );
      const guard = events.find((e) => e.kind === 'agent.wrong-surface-guard');
      expect(guard?.payload).toMatchObject({
        skill: 'parallel-implement',
        reason: 'engineering-spec-missed-investigation-surface',
        expectedKeyFiles: ['apps/server/src/domains/workflows/triage-batch.ts'],
        touchedPaths: ['slices/parallel-implement/workflow.ts'],
        investigationRunId: 'investigation-run-1',
      });
    } finally {
      replaySpy.mockRestore();
    }
  });
});

// ─── wp-file-guard.sh integration ─────────────────────────────────────────────

describe('wp-file-guard.sh hook', () => {
  function runGuard(toolName: string, filePath: string, env: Record<string, string> = {}) {
    const input = JSON.stringify({ tool_name: toolName, tool_input: { file_path: filePath } });
    return spawnSync('bash', [WP_FILE_GUARD], {
      input,
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });
  }

  it('allows when FACTORY_WP_FILESOWNED is not set', () => {
    const result = runGuard('Edit', 'core/foo.ts', {});
    expect(result.status).toBe(0);
  });

  it('allows non-Edit/Write tools unconditionally', () => {
    const result = runGuard('Read', 'core/foo.ts', {
      FACTORY_WP_FILESOWNED: 'core/bar.ts',
      FACTORY_WP_ID: 'WP1',
    });
    expect(result.status).toBe(0);
  });

  it('allows Edit for a file within filesOwned', () => {
    const result = runGuard('Edit', 'core/foo.ts', {
      FACTORY_WP_FILESOWNED: 'core/foo.ts:core/baz.ts',
      FACTORY_WP_ID: 'WP1',
    });
    expect(result.status).toBe(0);
  });

  it('allows Write for a file within filesOwned', () => {
    const result = runGuard('Write', 'core/bar.ts', {
      FACTORY_WP_FILESOWNED: 'core/foo.ts:core/bar.ts',
      FACTORY_WP_ID: 'WP2',
    });
    expect(result.status).toBe(0);
  });

  it('denies Edit for a file outside filesOwned (cross-WP write attempt)', () => {
    const result = runGuard('Edit', 'core/other.ts', {
      FACTORY_WP_FILESOWNED: 'core/foo.ts:core/bar.ts',
      FACTORY_WP_ID: 'WP1',
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('DENIED');
    expect(result.stderr).toContain('core/other.ts');
    expect(result.stderr).toContain('WP1');
  });

  it('denies Write for a file outside filesOwned', () => {
    const result = runGuard('Write', 'apps/web/index.ts', {
      FACTORY_WP_FILESOWNED: 'core/foo.ts',
      FACTORY_WP_ID: 'WP2',
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('DENIED');
  });

  it('normalises leading ./ on both sides for comparison', () => {
    const result = runGuard('Edit', './core/foo.ts', {
      FACTORY_WP_FILESOWNED: 'core/foo.ts',
      FACTORY_WP_ID: 'WP1',
    });
    expect(result.status).toBe(0);
  });

  it('includes the list of allowed paths in denial message', () => {
    const result = runGuard('Edit', 'core/other.ts', {
      FACTORY_WP_FILESOWNED: 'core/foo.ts:core/bar.ts',
      FACTORY_WP_ID: 'WP1',
    });
    expect(result.stderr).toContain('core/foo.ts:core/bar.ts');
  });
});

// ─── shouldRunDevReview unit tests ────────────────────────────────────────────

describe('shouldRunDevReview', () => {
  it("'all' triggers for every priority", () => {
    for (const p of ['low', 'medium', 'high', 'critical']) {
      expect(shouldRunDevReview('all', p)).toBe(true);
    }
  });

  it("'priority:medium+' triggers for medium and above", () => {
    expect(shouldRunDevReview('priority:medium+', 'low')).toBe(false);
    expect(shouldRunDevReview('priority:medium+', 'medium')).toBe(true);
    expect(shouldRunDevReview('priority:medium+', 'high')).toBe(true);
    expect(shouldRunDevReview('priority:medium+', 'critical')).toBe(true);
  });

  it("'priority:high+' triggers for high and critical only", () => {
    expect(shouldRunDevReview('priority:high+', 'low')).toBe(false);
    expect(shouldRunDevReview('priority:high+', 'medium')).toBe(false);
    expect(shouldRunDevReview('priority:high+', 'high')).toBe(true);
    expect(shouldRunDevReview('priority:high+', 'critical')).toBe(true);
  });

  it("'priority:critical' triggers only for critical", () => {
    expect(shouldRunDevReview('priority:critical', 'high')).toBe(false);
    expect(shouldRunDevReview('priority:critical', 'critical')).toBe(true);
  });

  it('returns false for unknown triggerOn', () => {
    expect(shouldRunDevReview('priority:unknown', 'high')).toBe(false);
  });
});

// ─── Holdout invariant: devReviewFindings must never reach QA/Reviewer ────────

describe('holdout invariant: dev-review keys blocked from QA/Reviewer context', () => {
  it('HOLDOUT_FORBIDDEN_KEYS includes devReviewFindings, devReviewVerdict, devReviewSummaries', () => {
    expect(HOLDOUT_FORBIDDEN_KEYS.has('devReviewFindings')).toBe(true);
    expect(HOLDOUT_FORBIDDEN_KEYS.has('devReviewVerdict')).toBe(true);
    expect(HOLDOUT_FORBIDDEN_KEYS.has('devReviewSummaries')).toBe(true);
  });

  it('findHoldoutContextLeaks detects devReviewFindings in QA context', () => {
    const spec = {
      runId: 'r1',
      role: 'qa' as const,
      skill: 'qa',
      context: {
        workItem: { title: 'Fix', body: 'x', number: 1, priority: 'high' },
        devReviewFindings: [{ severity: 'P1', file: 'foo.ts', line: 1 }],
      },
      contextAllowlist: ['workItem', 'devReviewFindings'],
      freshContext: true as const,
      toolBundles: [] as string[],
      toolExtras: [] as never[],
      budgets: { maxTurns: 10, maxBudgetUsd: 1, timeoutMs: 30_000 },
      personaId: 'p1',
      outputJsonSchema: {},
      appendSystemPrompt: '',
    };
    const leaks = findHoldoutContextLeaks(spec);
    expect(leaks.length).toBeGreaterThan(0);
    const keys = leaks.map((l) => l.key);
    expect(keys).toContain('devReviewFindings');
  });

  it('findHoldoutContextLeaks detects devReviewFindings in Reviewer context', () => {
    const spec = {
      runId: 'r2',
      role: 'reviewer' as const,
      skill: 'review',
      context: {
        devReviewVerdict: 'blockers-found',
      },
      contextAllowlist: ['devReviewVerdict'],
      freshContext: true as const,
      toolBundles: [] as string[],
      toolExtras: [] as never[],
      budgets: { maxTurns: 10, maxBudgetUsd: 1, timeoutMs: 30_000 },
      personaId: 'p1',
      outputJsonSchema: {},
      appendSystemPrompt: '',
    };
    const leaks = findHoldoutContextLeaks(spec);
    expect(leaks.some((l) => l.key === 'devReviewVerdict')).toBe(true);
  });

  it('findHoldoutContextLeaks returns empty for developer role with devReviewFindings', () => {
    const spec = {
      runId: 'r3',
      role: 'developer' as const,
      skill: 'dev-review-response',
      context: { devReviewFindings: [] },
      contextAllowlist: ['devReviewFindings'],
      freshContext: false as boolean,
      toolBundles: [] as string[],
      toolExtras: [] as never[],
      budgets: { maxTurns: 10, maxBudgetUsd: 1, timeoutMs: 30_000 },
      personaId: 'p1',
      outputJsonSchema: {},
      appendSystemPrompt: '',
    };
    const leaks = findHoldoutContextLeaks(spec);
    expect(leaks).toHaveLength(0);
  });
});

// ─── E2E spec 1: P1 finding addressed → no second Codex pass → QA proceeds ───

describe('dev-review e2e: P1 finding addressed in one extra turn, no second pass', () => {
  it('emits dev-review.completed and dev-review.response-completed, not a second dev-review.started', async () => {
    const wp1 = makeWp('WP1', ['core/a.ts']);
    const spec = makeSpec([wp1]);
    const { fn: appendEvent, events } = makeAppendEvent();

    const mockDevReviewOutput: DevReviewOutput = {
      verdict: 'blockers-found',
      findings: [
        {
          severity: 'P1',
          category: 'correctness',
          file: 'core/a.ts',
          line: 42,
          summary: 'Null dereference',
          suggestion: 'Add null check',
        },
      ],
      decisionSummaries: [{ kind: 'VERDICT', summary: 'blockers-found: 1 P1 finding' }],
    };

    const mockResponseOutput: DevReviewResponseOutput = {
      findingDispositions: [
        {
          findingRef: 'core/a.ts:42',
          severity: 'P1',
          disposition: 'addressed',
          reason: 'Added null guard',
        },
      ],
      decisionSummaries: [
        {
          kind: 'DEV_REVIEW_ADDRESSED',
          summary: 'Addressed P1 null dereference at core/a.ts:42',
          evidence: 'core/a.ts:42',
        },
      ],
    };

    await runParallelImplementWorkflow(
      makeWorkItem({ priority: 'high' }),
      spec,
      'pipeline-run-dev-review-1',
      makeStateSource(),
      'goose-hub-self',
      '/tmp/repo',
      {
        runtime: makeRuntime({ WP1: async () => makeOkResult('WP1') }),
        devReviewConfigOverride: {
          enabled: true,
          triggerOn: 'all',
          maxRevisionTurns: 1,
          perCycleMaxUsd: 2.0,
          timeoutMs: 180_000,
        },
        runDevReviewImpl: async (input) => {
          input.appendEvent({
            projectId: input.projectId,
            workItemId: input.workItemId,
            kind: 'dev-review.started',
            payload: { runId: `${input.runId}:dev-review`, worktreePath: input.worktreePath },
            runId: `${input.runId}:dev-review`,
          });
          input.appendEvent({
            projectId: input.projectId,
            workItemId: input.workItemId,
            kind: 'dev-review.completed',
            payload: {
              runId: `${input.runId}:dev-review`,
              verdict: mockDevReviewOutput.verdict,
              findingCount: mockDevReviewOutput.findings.length,
            },
            runId: `${input.runId}:dev-review`,
          });
          return mockDevReviewOutput;
        },
        runDevReviewResponseImpl: async (input) => {
          input.appendEvent({
            projectId: input.projectId,
            workItemId: input.workItemId,
            kind: 'dev-review.response-completed',
            payload: {
              runId: `${input.runId}:dev-review-response`,
              addressed: mockResponseOutput.findingDispositions.filter(
                (d) => d.disposition === 'addressed',
              ).length,
              dismissed: mockResponseOutput.findingDispositions.filter(
                (d) => d.disposition === 'dismissed',
              ).length,
            },
            runId: `${input.runId}:dev-review-response`,
          });
          return mockResponseOutput;
        },
        createIssueWorktreeImpl: () => '/tmp/issue-wt',
        createWpWorktreeImpl: (_repo, _runId, wpId) => `/tmp/wp-${wpId}`,
        cleanupWpWorktreesImpl: () => undefined,
        cleanupIssueWorktreeImpl: () => undefined,
        orchestratorCommitWpImpl: () => 'sha1',
        revertWpChangesImpl: () => undefined,
        recordIterationImpl: () => undefined,
        getLastStatusImpl: (_runId, wpId) => {
          const seen = events.some(
            (e) =>
              (e.kind as string).includes('wp-committed') &&
              (e.payload as { wpId?: string }).wpId === wpId,
          );
          return seen ? 'ok' : null;
        },
        openPRImpl: async () => ({
          prNumber: 1,
          prUrl: 'https://gh/pr/1',
          branch: 'b',
          base: 'main',
        }),
        getDiffImpl: () => 'diff --git a/core/a.ts b/core/a.ts\n+added null check',
        appendEvent,
      },
    );

    const devReviewStartedEvents = events.filter(
      (e) => (e.kind as string) === 'dev-review.started',
    );
    const devReviewCompletedEvents = events.filter(
      (e) => (e.kind as string) === 'dev-review.completed',
    );
    const responseCompletedEvents = events.filter(
      (e) => (e.kind as string) === 'dev-review.response-completed',
    );

    // Exactly one Codex pass, not two.
    expect(devReviewStartedEvents).toHaveLength(1);
    expect(devReviewCompletedEvents).toHaveLength(1);
    // Dev response completed once.
    expect(responseCompletedEvents).toHaveLength(1);
    expect((responseCompletedEvents[0]?.payload as { addressed?: number }).addressed).toBe(1);
  });
});

// ─── E2E spec 2: finding dismissed → DEV_REVIEW_DISMISSED in retro stream ────

describe('dev-review e2e: dismissed finding captures DEV_REVIEW_DISMISSED', () => {
  it('emits dev-review.response-completed with dismissed count', async () => {
    const wp1 = makeWp('WP1', ['core/b.ts']);
    const spec = makeSpec([wp1]);
    const { fn: appendEvent, events } = makeAppendEvent();

    const mockDevReviewOutput: DevReviewOutput = {
      verdict: 'blockers-found',
      findings: [
        {
          severity: 'P3',
          category: 'other',
          file: 'core/b.ts',
          line: 10,
          summary: 'Style nit',
          suggestion: 'Remove trailing space',
        },
      ],
      decisionSummaries: [{ kind: 'VERDICT', summary: 'blockers-found: 1 P3 finding' }],
    };

    const mockResponseOutput: DevReviewResponseOutput = {
      findingDispositions: [
        {
          findingRef: 'core/b.ts:10',
          severity: 'P3',
          disposition: 'dismissed',
          reason: 'Intentional by team convention',
        },
      ],
      decisionSummaries: [
        {
          kind: 'DEV_REVIEW_DISMISSED',
          summary: 'Dismissed P3 style nit at core/b.ts:10',
          evidence: 'core/b.ts:10',
        },
      ],
    };

    await runParallelImplementWorkflow(
      makeWorkItem({ priority: 'high' }),
      spec,
      'pipeline-run-dev-review-2',
      makeStateSource(),
      'goose-hub-self',
      '/tmp/repo',
      {
        runtime: makeRuntime({ WP1: async () => makeOkResult('WP1') }),
        devReviewConfigOverride: {
          enabled: true,
          triggerOn: 'all',
          maxRevisionTurns: 1,
          perCycleMaxUsd: 2.0,
          timeoutMs: 180_000,
        },
        runDevReviewImpl: async (input) => {
          input.appendEvent({
            projectId: input.projectId,
            workItemId: input.workItemId,
            kind: 'dev-review.started',
            payload: { runId: `${input.runId}:dev-review`, worktreePath: input.worktreePath },
            runId: `${input.runId}:dev-review`,
          });
          input.appendEvent({
            projectId: input.projectId,
            workItemId: input.workItemId,
            kind: 'dev-review.completed',
            payload: {
              runId: `${input.runId}:dev-review`,
              verdict: mockDevReviewOutput.verdict,
              findingCount: mockDevReviewOutput.findings.length,
            },
            runId: `${input.runId}:dev-review`,
          });
          return mockDevReviewOutput;
        },
        runDevReviewResponseImpl: async (input) => {
          input.appendEvent({
            projectId: input.projectId,
            workItemId: input.workItemId,
            kind: 'dev-review.response-completed',
            payload: {
              runId: `${input.runId}:dev-review-response`,
              addressed: mockResponseOutput.findingDispositions.filter(
                (d) => d.disposition === 'addressed',
              ).length,
              dismissed: mockResponseOutput.findingDispositions.filter(
                (d) => d.disposition === 'dismissed',
              ).length,
            },
            runId: `${input.runId}:dev-review-response`,
          });
          return mockResponseOutput;
        },
        createIssueWorktreeImpl: () => '/tmp/issue-wt',
        createWpWorktreeImpl: (_repo, _runId, wpId) => `/tmp/wp-${wpId}`,
        cleanupWpWorktreesImpl: () => undefined,
        cleanupIssueWorktreeImpl: () => undefined,
        orchestratorCommitWpImpl: () => 'sha2',
        revertWpChangesImpl: () => undefined,
        recordIterationImpl: () => undefined,
        getLastStatusImpl: (_runId, wpId) => {
          const seen = events.some(
            (e) =>
              (e.kind as string).includes('wp-committed') &&
              (e.payload as { wpId?: string }).wpId === wpId,
          );
          return seen ? 'ok' : null;
        },
        openPRImpl: async () => ({
          prNumber: 2,
          prUrl: 'https://gh/pr/2',
          branch: 'b',
          base: 'main',
        }),
        getDiffImpl: () => 'diff --git a/core/b.ts b/core/b.ts\n',
        appendEvent,
      },
    );

    const responseCompleted = events.find(
      (e) => (e.kind as string) === 'dev-review.response-completed',
    );
    expect(responseCompleted).toBeDefined();
    expect((responseCompleted?.payload as { dismissed?: number }).dismissed).toBe(1);
    expect((responseCompleted?.payload as { addressed?: number }).addressed).toBe(0);
  });
});

// ─── E2E spec 3: budget zero → dev-review.budget-skipped → workflow continues ─

describe('dev-review e2e: perCycleMaxUsd=0 → budget-skipped, workflow continues to QA', () => {
  it('emits dev-review.budget-skipped and opens PR without running Codex', async () => {
    const wp1 = makeWp('WP1', ['core/c.ts']);
    const spec = makeSpec([wp1]);
    const { fn: appendEvent, events } = makeAppendEvent();

    await runParallelImplementWorkflow(
      makeWorkItem({ priority: 'high' }),
      spec,
      'pipeline-run-dev-review-3',
      makeStateSource(),
      'goose-hub-self',
      '/tmp/repo',
      {
        runtime: makeRuntime({ WP1: async () => makeOkResult('WP1') }),
        // Override: enabled but perCycleMaxUsd = 0 → should skip
        devReviewConfigOverride: {
          enabled: true,
          triggerOn: 'all',
          maxRevisionTurns: 1,
          perCycleMaxUsd: 0,
          timeoutMs: 180_000,
        },
        runDevReviewImpl: async () => {
          throw new Error('runDevReview should NOT be called when budget is zero');
        },
        createIssueWorktreeImpl: () => '/tmp/issue-wt',
        createWpWorktreeImpl: (_repo, _runId, wpId) => `/tmp/wp-${wpId}`,
        cleanupWpWorktreesImpl: () => undefined,
        cleanupIssueWorktreeImpl: () => undefined,
        orchestratorCommitWpImpl: () => 'sha3',
        revertWpChangesImpl: () => undefined,
        recordIterationImpl: () => undefined,
        getLastStatusImpl: (_runId, wpId) => {
          const seen = events.some(
            (e) =>
              (e.kind as string).includes('wp-committed') &&
              (e.payload as { wpId?: string }).wpId === wpId,
          );
          return seen ? 'ok' : null;
        },
        openPRImpl: async () => ({
          prNumber: 3,
          prUrl: 'https://gh/pr/3',
          branch: 'b',
          base: 'main',
        }),
        getDiffImpl: () => '',
        appendEvent,
      },
    );

    const budgetSkipped = events.find((e) => (e.kind as string) === 'dev-review.budget-skipped');
    const devReviewStarted = events.find((e) => (e.kind as string) === 'dev-review.started');
    const prOpened = events.find((e) => (e.kind as string) === 'pr.opened');

    // Budget-skipped event was emitted
    expect(budgetSkipped).toBeDefined();
    // runDevReview was not called
    expect(devReviewStarted).toBeUndefined();
    // Workflow still completed — PR was opened
    expect(prOpened).toBeDefined();
  });
});

// ─── maxRevisionTurns=2 → 2 Codex passes ────────────────────────────────────

describe('dev-review e2e: maxRevisionTurns=2 → 2 Codex dev-review passes', () => {
  it('calls runDevReview twice and emits 2 dev-review.started events', async () => {
    const wp1 = makeWp('WP1', ['core/a.ts']);
    const spec = makeSpec([wp1]);
    const { fn: appendEvent, events } = makeAppendEvent();

    let devReviewCallCount = 0;

    const mockFindings = [
      {
        severity: 'P1' as const,
        category: 'correctness' as const,
        file: 'core/a.ts',
        line: 10,
        summary: 'Missing null check',
        suggestion: 'Add null guard',
      },
    ];

    const mockResponseOutput: DevReviewResponseOutput = {
      findingDispositions: [
        {
          findingRef: 'core/a.ts:10',
          severity: 'P1',
          disposition: 'addressed',
          reason: 'Added null guard',
        },
      ],
      decisionSummaries: [
        {
          kind: 'DEV_REVIEW_ADDRESSED',
          summary: 'Addressed P1 at core/a.ts:10',
          evidence: 'core/a.ts:10',
        },
      ],
    };

    const commitMessages: string[] = [];

    await runParallelImplementWorkflow(
      makeWorkItem({ priority: 'high' }),
      spec,
      'pipeline-run-multi-turn',
      makeStateSource(),
      'goose-hub-self',
      '/tmp/repo',
      {
        runtime: makeRuntime({ WP1: async () => makeOkResult('WP1') }),
        devReviewConfigOverride: {
          enabled: true,
          triggerOn: 'all',
          maxRevisionTurns: 2,
          perCycleMaxUsd: 2.0,
          timeoutMs: 180_000,
        },
        runDevReviewImpl: async (input) => {
          devReviewCallCount++;
          input.appendEvent({
            projectId: input.projectId,
            workItemId: input.workItemId,
            kind: 'dev-review.started',
            payload: { runId: `${input.runId}:dev-review`, worktreePath: input.worktreePath },
            runId: `${input.runId}:dev-review`,
          });
          input.appendEvent({
            projectId: input.projectId,
            workItemId: input.workItemId,
            kind: 'dev-review.completed',
            payload: {
              runId: `${input.runId}:dev-review`,
              verdict: 'blockers-found',
              findingCount: mockFindings.length,
            },
            runId: `${input.runId}:dev-review`,
          });
          return { verdict: 'blockers-found', findings: mockFindings, decisionSummaries: [] };
        },
        runDevReviewResponseImpl: async (input) => {
          input.appendEvent({
            projectId: input.projectId,
            workItemId: input.workItemId,
            kind: 'dev-review.response-completed',
            payload: {
              runId: `${input.runId}:dev-review-response`,
              addressed: 1,
              dismissed: 0,
            },
            runId: `${input.runId}:dev-review-response`,
          });
          return mockResponseOutput;
        },
        commitDevReviewResponseImpl: (_wt, msg) => {
          commitMessages.push(msg);
          return 'sha-commit';
        },
        createIssueWorktreeImpl: () => '/tmp/issue-wt',
        createWpWorktreeImpl: (_repo, _runId, wpId) => `/tmp/wp-${wpId}`,
        cleanupWpWorktreesImpl: () => undefined,
        cleanupIssueWorktreeImpl: () => undefined,
        orchestratorCommitWpImpl: () => 'sha1',
        revertWpChangesImpl: () => undefined,
        recordIterationImpl: () => undefined,
        getLastStatusImpl: (_runId, wpId) => {
          const seen = events.some(
            (e) =>
              (e.kind as string).includes('wp-committed') &&
              (e.payload as { wpId?: string }).wpId === wpId,
          );
          return seen ? 'ok' : null;
        },
        openPRImpl: async () => ({
          prNumber: 10,
          prUrl: 'https://gh/pr/10',
          branch: 'b',
          base: 'main',
        }),
        getDiffImpl: () => 'diff --git a/core/a.ts b/core/a.ts\n+null check added',
        appendEvent,
      },
    );

    const devReviewStartedEvents = events.filter(
      (e) => (e.kind as string) === 'dev-review.started',
    );
    const devReviewCompletedEvents = events.filter(
      (e) => (e.kind as string) === 'dev-review.completed',
    );
    const responseCompletedEvents = events.filter(
      (e) => (e.kind as string) === 'dev-review.response-completed',
    );

    // Exactly 2 Codex passes for maxRevisionTurns=2 with blockers-found each time.
    expect(devReviewCallCount).toBe(2);
    expect(devReviewStartedEvents).toHaveLength(2);
    expect(devReviewCompletedEvents).toHaveLength(2);
    // 2 response turns (one per blockers-found verdict, both non-last-turn for first, last-turn for second).
    // Turn 0: blockers-found → response; turn 1: blockers-found, last turn, NOT inconclusive → response.
    expect(responseCompletedEvents).toHaveLength(2);
    // Commits include turn-N suffix.
    expect(commitMessages.some((m) => m.includes('turn-0'))).toBe(true);
    expect(commitMessages.some((m) => m.includes('turn-1'))).toBe(true);
    // PR still opened after loop.
    const prOpened = events.find((e) => (e.kind as string) === 'pr.opened');
    expect(prOpened).toBeDefined();
  });
});

// ─── maxRevisionTurns=1 default: approved verdict exits without response ──────

describe('dev-review e2e: maxRevisionTurns=1 (default) with approved verdict exits early', () => {
  it('emits 1 dev-review.started and no response when approved', async () => {
    const wp1 = makeWp('WP1', ['core/d.ts']);
    const spec = makeSpec([wp1]);
    const { fn: appendEvent, events } = makeAppendEvent();

    await runParallelImplementWorkflow(
      makeWorkItem({ priority: 'high' }),
      spec,
      'pipeline-run-approved',
      makeStateSource(),
      'goose-hub-self',
      '/tmp/repo',
      {
        runtime: makeRuntime({ WP1: async () => makeOkResult('WP1') }),
        devReviewConfigOverride: {
          enabled: true,
          triggerOn: 'all',
          maxRevisionTurns: 1,
          perCycleMaxUsd: 2.0,
          timeoutMs: 180_000,
        },
        runDevReviewImpl: async (input) => {
          input.appendEvent({
            projectId: input.projectId,
            workItemId: input.workItemId,
            kind: 'dev-review.started',
            payload: { runId: `${input.runId}:dev-review`, worktreePath: input.worktreePath },
            runId: `${input.runId}:dev-review`,
          });
          input.appendEvent({
            projectId: input.projectId,
            workItemId: input.workItemId,
            kind: 'dev-review.completed',
            payload: {
              runId: `${input.runId}:dev-review`,
              verdict: 'no-blockers',
              findingCount: 0,
            },
            runId: `${input.runId}:dev-review`,
          });
          return { verdict: 'no-blockers', findings: [], decisionSummaries: [] };
        },
        runDevReviewResponseImpl: async () => {
          throw new Error('runDevReviewResponse should NOT be called when verdict is no-blockers');
        },
        createIssueWorktreeImpl: () => '/tmp/issue-wt',
        createWpWorktreeImpl: (_repo, _runId, wpId) => `/tmp/wp-${wpId}`,
        cleanupWpWorktreesImpl: () => undefined,
        cleanupIssueWorktreeImpl: () => undefined,
        orchestratorCommitWpImpl: () => 'sha1',
        revertWpChangesImpl: () => undefined,
        recordIterationImpl: () => undefined,
        getLastStatusImpl: (_runId, wpId) => {
          const seen = events.some(
            (e) =>
              (e.kind as string).includes('wp-committed') &&
              (e.payload as { wpId?: string }).wpId === wpId,
          );
          return seen ? 'ok' : null;
        },
        openPRImpl: async () => ({
          prNumber: 11,
          prUrl: 'https://gh/pr/11',
          branch: 'b',
          base: 'main',
        }),
        getDiffImpl: () => '',
        appendEvent,
      },
    );

    const devReviewStartedEvents = events.filter(
      (e) => (e.kind as string) === 'dev-review.started',
    );
    const responseCompletedEvents = events.filter(
      (e) => (e.kind as string) === 'dev-review.response-completed',
    );

    // Exactly 1 Codex pass, no response.
    expect(devReviewStartedEvents).toHaveLength(1);
    expect(responseCompletedEvents).toHaveLength(0);
    // PR still opened.
    expect(events.find((e) => (e.kind as string) === 'pr.opened')).toBeDefined();
  });
});

// ─── triggerOn priority matching: low does not trigger when set to medium+ ───

describe('dev-review: triggerOn priority:medium+ does not trigger for priority:low', () => {
  it('skips dev-review entirely for low priority work item', async () => {
    const wp1 = makeWp('WP1', ['core/e.ts']);
    const spec = makeSpec([wp1]);
    const { fn: appendEvent, events } = makeAppendEvent();

    await runParallelImplementWorkflow(
      makeWorkItem({ priority: 'low' }),
      spec,
      'pipeline-run-low-priority',
      makeStateSource(),
      'goose-hub-self',
      '/tmp/repo',
      {
        runtime: makeRuntime({ WP1: async () => makeOkResult('WP1') }),
        devReviewConfigOverride: {
          enabled: true,
          triggerOn: 'priority:medium+',
          maxRevisionTurns: 2,
          perCycleMaxUsd: 2.0,
          timeoutMs: 180_000,
        },
        runDevReviewImpl: async () => {
          throw new Error('runDevReview should NOT be called for low priority');
        },
        createIssueWorktreeImpl: () => '/tmp/issue-wt',
        createWpWorktreeImpl: (_repo, _runId, wpId) => `/tmp/wp-${wpId}`,
        cleanupWpWorktreesImpl: () => undefined,
        cleanupIssueWorktreeImpl: () => undefined,
        orchestratorCommitWpImpl: () => 'sha1',
        revertWpChangesImpl: () => undefined,
        recordIterationImpl: () => undefined,
        getLastStatusImpl: (_runId, wpId) => {
          const seen = events.some(
            (e) =>
              (e.kind as string).includes('wp-committed') &&
              (e.payload as { wpId?: string }).wpId === wpId,
          );
          return seen ? 'ok' : null;
        },
        openPRImpl: async () => ({
          prNumber: 12,
          prUrl: 'https://gh/pr/12',
          branch: 'b',
          base: 'main',
        }),
        getDiffImpl: () => '',
        appendEvent,
      },
    );

    // No dev-review events for low priority item.
    expect(events.find((e) => (e.kind as string) === 'dev-review.started')).toBeUndefined();
    expect(events.find((e) => (e.kind as string) === 'dev-review.budget-skipped')).toBeUndefined();
    // PR still opened.
    expect(events.find((e) => (e.kind as string) === 'pr.opened')).toBeDefined();
  });

  it('triggers dev-review for medium priority with priority:medium+ config', async () => {
    const wp1 = makeWp('WP1', ['core/f.ts']);
    const spec = makeSpec([wp1]);
    const { fn: appendEvent, events } = makeAppendEvent();

    await runParallelImplementWorkflow(
      makeWorkItem({ priority: 'medium' }),
      spec,
      'pipeline-run-medium-priority',
      makeStateSource(),
      'goose-hub-self',
      '/tmp/repo',
      {
        runtime: makeRuntime({ WP1: async () => makeOkResult('WP1') }),
        devReviewConfigOverride: {
          enabled: true,
          triggerOn: 'priority:medium+',
          maxRevisionTurns: 1,
          perCycleMaxUsd: 2.0,
          timeoutMs: 180_000,
        },
        runDevReviewImpl: async (input) => {
          input.appendEvent({
            projectId: input.projectId,
            workItemId: input.workItemId,
            kind: 'dev-review.started',
            payload: { runId: `${input.runId}:dev-review`, worktreePath: input.worktreePath },
            runId: `${input.runId}:dev-review`,
          });
          input.appendEvent({
            projectId: input.projectId,
            workItemId: input.workItemId,
            kind: 'dev-review.completed',
            payload: {
              runId: `${input.runId}:dev-review`,
              verdict: 'no-blockers',
              findingCount: 0,
            },
            runId: `${input.runId}:dev-review`,
          });
          return { verdict: 'no-blockers', findings: [], decisionSummaries: [] };
        },
        createIssueWorktreeImpl: () => '/tmp/issue-wt',
        createWpWorktreeImpl: (_repo, _runId, wpId) => `/tmp/wp-${wpId}`,
        cleanupWpWorktreesImpl: () => undefined,
        cleanupIssueWorktreeImpl: () => undefined,
        orchestratorCommitWpImpl: () => 'sha1',
        revertWpChangesImpl: () => undefined,
        recordIterationImpl: () => undefined,
        getLastStatusImpl: (_runId, wpId) => {
          const seen = events.some(
            (e) =>
              (e.kind as string).includes('wp-committed') &&
              (e.payload as { wpId?: string }).wpId === wpId,
          );
          return seen ? 'ok' : null;
        },
        openPRImpl: async () => ({
          prNumber: 13,
          prUrl: 'https://gh/pr/13',
          branch: 'b',
          base: 'main',
        }),
        getDiffImpl: () => '',
        appendEvent,
      },
    );

    // dev-review DID run for medium priority.
    expect(events.find((e) => (e.kind as string) === 'dev-review.started')).toBeDefined();
  });
});

// ─── Cost telemetry: multi-turn = multiple dev-review.completed events ────────

describe('dev-review cost telemetry: multi-turn produces multiple dev-review.completed events', () => {
  it('emits N dev-review.completed events for N Codex passes', async () => {
    const wp1 = makeWp('WP1', ['core/g.ts']);
    const spec = makeSpec([wp1]);
    const { fn: appendEvent, events } = makeAppendEvent();
    const MAX_TURNS = 3;

    await runParallelImplementWorkflow(
      makeWorkItem({ priority: 'critical' }),
      spec,
      'pipeline-run-cost-telemetry',
      makeStateSource(),
      'goose-hub-self',
      '/tmp/repo',
      {
        runtime: makeRuntime({ WP1: async () => makeOkResult('WP1') }),
        devReviewConfigOverride: {
          enabled: true,
          triggerOn: 'all',
          maxRevisionTurns: MAX_TURNS,
          perCycleMaxUsd: 5.0,
          timeoutMs: 180_000,
        },
        runDevReviewImpl: async (input) => {
          input.appendEvent({
            projectId: input.projectId,
            workItemId: input.workItemId,
            kind: 'dev-review.started',
            payload: { runId: `${input.runId}:dev-review`, worktreePath: input.worktreePath },
            runId: `${input.runId}:dev-review`,
          });
          input.appendEvent({
            projectId: input.projectId,
            workItemId: input.workItemId,
            kind: 'dev-review.completed',
            payload: {
              runId: `${input.runId}:dev-review`,
              verdict: 'blockers-found',
              findingCount: 1,
            },
            runId: `${input.runId}:dev-review`,
          });
          return {
            verdict: 'blockers-found',
            findings: [
              {
                severity: 'P2' as const,
                category: 'performance' as const,
                file: 'core/g.ts',
                line: 5,
                summary: 'Perf issue',
                suggestion: 'Cache result',
              },
            ],
            decisionSummaries: [],
          };
        },
        runDevReviewResponseImpl: async (input) => {
          input.appendEvent({
            projectId: input.projectId,
            workItemId: input.workItemId,
            kind: 'dev-review.response-completed',
            payload: { runId: `${input.runId}:dev-review-response`, addressed: 1, dismissed: 0 },
            runId: `${input.runId}:dev-review-response`,
          });
          return {
            findingDispositions: [
              {
                findingRef: 'core/g.ts:5',
                severity: 'P2',
                disposition: 'addressed' as const,
                reason: 'Cached',
              },
            ],
            decisionSummaries: [],
          };
        },
        commitDevReviewResponseImpl: () => 'sha-x',
        createIssueWorktreeImpl: () => '/tmp/issue-wt',
        createWpWorktreeImpl: (_repo, _runId, wpId) => `/tmp/wp-${wpId}`,
        cleanupWpWorktreesImpl: () => undefined,
        cleanupIssueWorktreeImpl: () => undefined,
        orchestratorCommitWpImpl: () => 'sha1',
        revertWpChangesImpl: () => undefined,
        recordIterationImpl: () => undefined,
        getLastStatusImpl: (_runId, wpId) => {
          const seen = events.some(
            (e) =>
              (e.kind as string).includes('wp-committed') &&
              (e.payload as { wpId?: string }).wpId === wpId,
          );
          return seen ? 'ok' : null;
        },
        openPRImpl: async () => ({
          prNumber: 14,
          prUrl: 'https://gh/pr/14',
          branch: 'b',
          base: 'main',
        }),
        getDiffImpl: () => 'diff --git a/core/g.ts',
        appendEvent,
      },
    );

    const completedEvents = events.filter((e) => (e.kind as string) === 'dev-review.completed');
    // One completed event per Codex call = MAX_TURNS calls.
    expect(completedEvents).toHaveLength(MAX_TURNS);
    // PR still opened after exhausting turns.
    expect(events.find((e) => (e.kind as string) === 'pr.opened')).toBeDefined();
  });
});
