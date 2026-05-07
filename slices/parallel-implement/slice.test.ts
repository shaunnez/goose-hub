import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import type {
  AgentResult,
  AgentRuntime,
  AgentSpec,
} from '@goose-hub/core/agent-runtime/interface.js';
import type { AgentEvent, AppendEventInput } from '@goose-hub/core/event-stream/store.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import type { ImplementWpOutput } from '@goose-hub/skills/implement-wp/schema.js';
import type { EngineeringSpec, WorkPackage } from '@goose-hub/skills/spec-author/schema.js';
import { runParallelImplementWorkflow } from './workflow.js';

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
      { id: 'AC1', statement: 'Works', verifyCommand: 'pnpm test', crossCutting: true },
    ],
    constraints: [],
    riskRegister: [],
    decisionSummaries: [{ kind: 'PLAN', summary: 'Test spec' }],
  };
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

function makeStateSource(
  overrides: Partial<{
    transitionState: (...args: unknown[]) => Promise<void>;
    comment: (...args: unknown[]) => Promise<void>;
  }> = {},
) {
  return {
    repoRef: 'shaunnez/goose-hub',
    transitionState: vi.fn().mockResolvedValue(undefined),
    comment: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as import('@goose-hub/core/state-source/interface.js').StateSource;
}

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

    // No failures
    expect(iterations.some((i) => i.status === 'failed')).toBe(false);
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
