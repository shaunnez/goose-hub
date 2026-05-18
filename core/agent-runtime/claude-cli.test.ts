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
vi.mock('../db/repositories/project-settings.js', () => ({
  getRecordDecisionTool: vi.fn().mockReturnValue(false),
}));
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

import { costFromCliEnvelope } from '../cost/extract.js';
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
  pid?: number;
  stdin: { end: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function makeChild(exitCode: number, stdout: string): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin = { end: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  setTimeout(() => {
    child.stdout.emit('data', Buffer.from(stdout));
    child.emit('close', exitCode);
  }, 0);
  return child;
}

function makeHangingChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = 1234;
  child.stdin = { end: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecFileSync.mockReturnValue('/usr/local/bin/claude\n');
  vi.mocked(costFromCliEnvelope).mockReturnValue(null);
  mockDbInsert.mockImplementation(() => ({
    values: vi.fn().mockReturnValue({ run: vi.fn() }),
  }));
  mockEventStore.replay.mockReturnValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ClaudeCliRuntime — agentRuns write path', () => {
  it('passes the rendered prompt through stdin when using --print', async () => {
    const envelope = JSON.stringify({ is_error: false, result: '{"ok":true}' });
    const child = makeChild(0, envelope);
    mockSpawn.mockReturnValue(child);

    const runtime = new ClaudeCliRuntime();
    await runtime.run(makeSpec());

    const argv = mockSpawn.mock.calls[0][1] as string[];
    expect(argv).toContain('--print');
    expect(argv).not.toContain('<task></task>');
    expect(child.stdin.end).toHaveBeenCalledWith('<task></task>');
  });

  it('includes the Factory workspace-only instruction in Claude system prompt', async () => {
    const envelope = JSON.stringify({ is_error: false, result: '{"ok":true}' });
    mockSpawn.mockReturnValue(makeChild(0, envelope));

    const runtime = new ClaudeCliRuntime();
    await runtime.run(makeSpec({ appendSystemPrompt: 'skill prompt body' }));

    const argv = mockSpawn.mock.calls[0][1] as string[];
    const promptIndex = argv.indexOf('--system-prompt');
    expect(promptIndex).toBeGreaterThanOrEqual(0);
    const systemPrompt = argv[promptIndex + 1];
    expect(systemPrompt).toContain('Factory agents must not read ~/.codex');
    expect(systemPrompt).toContain(
      'All repo exploration must stay under workspaceDir / <worktreePath>.',
    );
    expect(systemPrompt).toContain(
      'If prior context is needed, use only context provided by Factory.',
    );
    expect(systemPrompt).toContain('skill prompt body');
  });

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

  it('emits run-completed on an under-budget successful run', async () => {
    vi.mocked(costFromCliEnvelope).mockReturnValue({
      inputTokens: 20,
      outputTokens: 10,
      costUsd: 0.25,
      costLabel: 'estimated',
    });
    const envelope = JSON.stringify({ is_error: false, result: '{"ok":true}' });
    mockSpawn.mockReturnValue(makeChild(0, envelope));

    const runtime = new ClaudeCliRuntime();
    await runtime.run(makeSpec({ budgets: { maxTurns: 10, maxBudgetUsd: 1, timeoutMs: 5000 } }));

    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.run-completed',
        payload: expect.objectContaining({
          runId: 'run-abc',
          skill: 'fix-issue',
          cost: expect.objectContaining({ usd: 0.25 }),
        }),
      }),
    );
  });

  it('uses top-level workItemId for events and costs when context omits it', async () => {
    const envelope = JSON.stringify({ is_error: false, result: '{"ok":true}' });
    mockSpawn.mockReturnValue(makeChild(0, envelope));

    const runtime = new ClaudeCliRuntime();
    await runtime.run(
      makeSpec({
        context: { projectId: 'test-project' },
        workItemId: 'github:owner/repo#1',
      }),
    );

    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.run-started',
        workItemId: 'github:owner/repo#1',
      }),
    );
    expect(mockRecordCost).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: 'github:owner/repo#1',
      }),
    );
  });

  it('emits model and runtime metadata when the run starts', async () => {
    const envelope = JSON.stringify({ is_error: false, result: '{"ok":true}' });
    mockSpawn.mockReturnValue(makeChild(0, envelope));

    const runtime = new ClaudeCliRuntime();
    await runtime.run(makeSpec({ modelOverride: 'claude-haiku-4-5-20251001' }));

    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.run-started',
        payload: expect.objectContaining({
          modelId: 'claude-haiku-4-5-20251001',
          runtime: 'claude-cli',
        }),
      }),
    );
  });

  it('records cost, emits budget-exceeded and run-failed, and rejects over-budget runs', async () => {
    vi.mocked(costFromCliEnvelope).mockReturnValue({
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 1.25,
      costLabel: 'estimated',
    });
    const envelope = JSON.stringify({ is_error: false, result: '{"ok":true}' });
    mockSpawn.mockReturnValue(makeChild(0, envelope));

    const runtime = new ClaudeCliRuntime();
    await expect(
      runtime.run(makeSpec({ budgets: { maxTurns: 10, maxBudgetUsd: 1, timeoutMs: 5000 } })),
    ).rejects.toThrow('exceeded budget');

    expect(mockRecordCost).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-abc',
        costUsd: 1.25,
        inputTokens: 100,
        outputTokens: 50,
      }),
    );

    const calls = mockEventStore.appendEvent.mock.calls;
    const budgetIndex = calls.findIndex(([e]) => e.kind === 'agent.budget-exceeded');
    const budgetCall = calls[budgetIndex];
    const failedCall = calls.find(([e]) => {
      const payload = e.payload as { reason?: string };
      return e.kind === 'agent.run-failed' && payload.reason === 'budget-exceeded';
    });
    expect(budgetCall?.[0].payload).toMatchObject({
      runId: 'run-abc',
      skill: 'fix-issue',
      modelId: 'claude-sonnet-4-6',
      costUsd: 1.25,
      budgetUsd: 1,
      inputTokens: 100,
      outputTokens: 50,
      overByUsd: 0.25,
    });
    expect(failedCall).toBeDefined();
    expect(mockRecordCost.mock.invocationCallOrder[0]).toBeLessThan(
      mockEventStore.appendEvent.mock.invocationCallOrder[budgetIndex],
    );
    expect(mockEventStore.appendEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'agent.run-completed' }),
    );
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

  it('timeout emits failure events, kills the process group, rejects, and ignores late close', async () => {
    vi.useFakeTimers();
    const child = makeHangingChild();
    mockSpawn.mockReturnValue(child);
    const processKill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const runtime = new ClaudeCliRuntime();
    const run = runtime.run(
      makeSpec({ budgets: { maxTurns: 10, maxBudgetUsd: 1, timeoutMs: 25 } }),
    );
    const rejection = expect(run).rejects.toThrow('timed out after 25ms');

    await vi.advanceTimersByTimeAsync(25);
    await rejection;

    expect(processKill).toHaveBeenCalledWith(-1234, 'SIGKILL');
    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'tool.timeout' }),
    );
    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.run-failed',
        payload: expect.objectContaining({ error: 'timed out after 25ms', timeoutMs: 25 }),
      }),
    );

    child.stdout.emit(
      'data',
      Buffer.from(JSON.stringify({ is_error: false, result: '{"ok":true}' })),
    );
    child.emit('close', 0);

    expect(mockEventStore.appendEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'agent.run-completed' }),
    );
    processKill.mockRestore();
  });
});
