import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDbInsert, mockRecordCost, mockEventStore, mockExecFileSync, mockSpawn } = vi.hoisted(
  () => ({
    mockDbInsert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({ run: vi.fn() }),
    })),
    mockRecordCost: vi.fn(),
    mockEventStore: { appendEvent: vi.fn(), replay: vi.fn().mockReturnValue([]) },
    mockExecFileSync: vi.fn().mockReturnValue('/usr/local/bin/claude\n'),
    mockSpawn: vi.fn(),
  }),
);

vi.mock('../db/db.js', () => ({ db: { insert: mockDbInsert } }));
vi.mock('../cost/repository.js', () => ({ recordCost: mockRecordCost }));
vi.mock('../event-stream/store.js', () => ({ eventStore: mockEventStore }));
vi.mock('../cost/extract.js', () => ({ costFromCliEnvelope: vi.fn().mockReturnValue(null) }));
vi.mock('../cost/skill-stage.js', () => ({ stageForSkill: vi.fn().mockReturnValue('develop') }));
vi.mock('../tool-layer/allowlist.js', () => ({ computeAllowlist: vi.fn().mockReturnValue([]) }));
vi.mock('../tool-layer/pre-tool-use-hook.js', () => ({ deployHooks: vi.fn() }));
vi.mock('../tool-layer/sandbox.js', () => ({ writeWorkspaceSandbox: vi.fn() }));
vi.mock('./context-assembly.js', () => ({
  assembleSpawnContext: vi.fn().mockReturnValue({ contextXml: '<task></task>' }),
}));
vi.mock('./models.js', () => ({
  defaultModelForTier: vi.fn().mockReturnValue('claude-sonnet-4-6'),
}));
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
  spawn: mockSpawn,
}));

import { ClaudeCliRuntime } from './claude-cli.js';

function makeSpec(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-abc',
    role: 'developer' as const,
    skill: 'fix-issue',
    context: { projectId: 'test-project', workItemId: 'github:owner/repo#1' },
    contextAllowlist: [],
    freshContext: false as const,
    toolBundles: [] as string[],
    toolExtras: [] as string[],
    budgets: { maxTurns: 10, maxBudgetUsd: 1, timeoutMs: 5000 },
    personaId: 'test-project/developer/0',
    workItemId: 'github:owner/repo#1',
    ...overrides,
  };
}

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function makeChild(exitCode: number, stdout: string): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  setTimeout(() => {
    child.stdout.emit('data', Buffer.from(stdout));
    child.emit('close', exitCode);
  }, 0);
  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecFileSync.mockReturnValue('/usr/local/bin/claude\n');
  mockDbInsert.mockImplementation(() => ({
    values: vi.fn().mockReturnValue({ run: vi.fn() }),
  }));
  mockEventStore.replay.mockReturnValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ClaudeCliRuntime — agentRuns write path', () => {
  it('inserts a success row when CLI exits with valid envelope', async () => {
    const valuesRun = vi.fn();
    const values = vi.fn().mockReturnValue({ run: valuesRun });
    mockDbInsert.mockReturnValue({ values });

    const envelope = JSON.stringify({ is_error: false, result: '{"ok":true}' });
    mockSpawn.mockReturnValue(makeChild(0, envelope));

    const runtime = new ClaudeCliRuntime();
    await runtime.run(makeSpec());

    expect(mockDbInsert).toHaveBeenCalled();
    const row = values.mock.calls[0][0];
    expect(row.runId).toBe('run-abc');
    expect(row.personaId).toBe('test-project/developer/0');
    expect(row.outcome).toBe('success');
    expect(row.projectId).toBe('test-project');
    expect(row.role).toBe('developer');
    expect(row.skill).toBe('fix-issue');
    expect(row.workItemId).toBe('github:owner/repo#1');
  });

  it('inserts a failure row when CLI reports is_error=true', async () => {
    const valuesRun = vi.fn();
    const values = vi.fn().mockReturnValue({ run: valuesRun });
    mockDbInsert.mockReturnValue({ values });

    const envelope = JSON.stringify({ is_error: true, result: 'budget exceeded' });
    mockSpawn.mockReturnValue(makeChild(0, envelope));

    const runtime = new ClaudeCliRuntime();
    await runtime.run(makeSpec()).catch(() => {});

    expect(mockDbInsert).toHaveBeenCalled();
    const row = values.mock.calls[0][0];
    expect(row.outcome).toBe('failure');
  });

  it('inserts a failure row when CLI exits non-zero with no envelope', async () => {
    const valuesRun = vi.fn();
    const values = vi.fn().mockReturnValue({ run: valuesRun });
    mockDbInsert.mockReturnValue({ values });

    mockSpawn.mockReturnValue(makeChild(1, 'not json'));

    const runtime = new ClaudeCliRuntime();
    await runtime.run(makeSpec()).catch(() => {});

    expect(mockDbInsert).toHaveBeenCalled();
    const row = values.mock.calls[0][0];
    expect(row.outcome).toBe('failure');
  });
});
