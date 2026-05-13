import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEventStore, mockSpawn } = vi.hoisted(() => ({
  mockEventStore: { appendEvent: vi.fn(), replay: vi.fn().mockReturnValue([]) },
  mockSpawn: vi.fn(),
}));

vi.mock('../cost/repository.js', () => ({ recordCost: vi.fn() }));
vi.mock('../event-stream/store.js', () => ({ eventStore: mockEventStore }));
vi.mock('../cost/skill-stage.js', () => ({ stageForSkill: vi.fn().mockReturnValue('develop') }));
vi.mock('../db/repositories/project-settings.js', () => ({
  getRecordDecisionTool: vi.fn().mockReturnValue(false),
}));
vi.mock('../tool-layer/allowlist.js', () => ({ computeAllowlist: vi.fn().mockReturnValue([]) }));
vi.mock('../tool-layer/decision-capture-hook.js', () => ({ deployDecisionCaptureHook: vi.fn() }));
vi.mock('../tool-layer/pre-tool-use-hook.js', () => ({ deployHooks: vi.fn() }));
vi.mock('../tool-layer/sandbox.js', () => ({ writeWorkspaceSandbox: vi.fn() }));
vi.mock('./context-assembly.js', () => ({
  assembleSpawnContext: vi.fn().mockReturnValue({ contextXml: '<task></task>' }),
}));
vi.mock('./models.js', () => ({
  defaultModelForTierAndProvider: vi.fn().mockReturnValue('gpt-5.3-codex'),
  estimateCostUsd: vi.fn().mockReturnValue(0),
}));
vi.mock('./codex-config.js', () => ({
  CodexBinaryNotFoundError: class CodexBinaryNotFoundError extends Error {},
  CodexNotAuthenticatedError: class CodexNotAuthenticatedError extends Error {},
  assertCodexAuthenticated: vi.fn(),
  buildCodexArgv: vi.fn().mockReturnValue(['exec', '--json']),
  escapeForTomlMultilineBasic: vi.fn((value: string) => value),
  resolveCodexBinary: vi.fn().mockReturnValue('/usr/local/bin/codex'),
}));
vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

import { CodexCliRuntime } from './codex-cli.js';

function makeSpec(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-codex',
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
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function makeHangingChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = 4321;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEventStore.replay.mockReturnValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CodexCliRuntime timeout handling', () => {
  it('emits timeout and failed events, kills the process group, rejects, and ignores late close', async () => {
    vi.useFakeTimers();
    const child = makeHangingChild();
    mockSpawn.mockReturnValue(child);
    const processKill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const runtime = new CodexCliRuntime();
    const run = runtime.run(
      makeSpec({ budgets: { maxTurns: 10, maxBudgetUsd: 1, timeoutMs: 25 } }),
    );
    const rejection = expect(run).rejects.toThrow('timed out after 25ms');

    await vi.advanceTimersByTimeAsync(25);
    await rejection;

    expect(processKill).toHaveBeenCalledWith(-4321, 'SIGKILL');
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
      Buffer.from(
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: '{"ok":true}' },
        }),
      ),
    );
    child.emit('close', 0);

    expect(mockEventStore.appendEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'agent.run-completed' }),
    );
  });
});
