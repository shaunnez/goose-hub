import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBindToolsForAgentSpec,
  mockRecordAgentRun,
  mockRecordCost,
  mockRecordToolStatsForRun,
  mockEventStore,
  mockExecFileSync,
  mockSpawn,
} = vi.hoisted(() => ({
  mockBindToolsForAgentSpec: vi.fn().mockReturnValue({
    allowlist: [],
    enabledToolsByServer: {},
    nativeTools: [],
    mcpServerBundles: [],
    mcpServerNames: [],
    sandboxMode: 'read-only',
    warnings: [],
    fingerprints: {
      toolBindingHash: 'binding-hash',
      toolAllowlistHash: 'allowlist-hash',
      mcpServerSetHash: 'server-hash',
    },
  }),
  mockRecordAgentRun: vi.fn(),
  mockRecordCost: vi.fn(),
  mockRecordToolStatsForRun: vi.fn(),
  mockEventStore: { appendEvent: vi.fn(), replay: vi.fn().mockReturnValue([]) },
  mockExecFileSync: vi.fn().mockReturnValue('/usr/local/bin/claude\n'),
  mockSpawn: vi.fn(),
}));

vi.mock('../cost/repository.js', () => ({
  recordCost: mockRecordCost,
  recordToolStatsForRun: mockRecordToolStatsForRun,
}));
vi.mock('../event-stream/store.js', () => ({ eventStore: mockEventStore }));
vi.mock('../cost/extract.js', () => ({ costFromCliEnvelope: vi.fn().mockReturnValue(null) }));
vi.mock('../cost/skill-stage.js', () => ({ stageForSkill: vi.fn().mockReturnValue('develop') }));
vi.mock('../db/repositories/project-settings.js', () => ({
  getRecordDecisionTool: vi.fn().mockReturnValue(false),
}));
vi.mock('../tool-layer/tool-binding.js', () => ({
  bindToolsForAgentSpec: mockBindToolsForAgentSpec,
}));
vi.mock('../tool-layer/pre-tool-use-hook.js', () => ({ deployHooks: vi.fn() }));
vi.mock('../tool-layer/sandbox.js', () => ({ writeWorkspaceSandbox: vi.fn() }));
vi.mock('./context-assembly.js', () => ({
  assembleSpawnContext: vi.fn().mockReturnValue({ contextXml: '<task></task>' }),
}));
vi.mock('./models.js', () => ({
  defaultModelForTier: vi.fn().mockReturnValue('claude-sonnet-4-6'),
}));
vi.mock('./run-record.js', () => ({ recordAgentRun: mockRecordAgentRun }));
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
  spawn: mockSpawn,
}));

import { costFromCliEnvelope } from '../cost/extract.js';
import { bindToolsForAgentSpec } from '../tool-layer/tool-binding.js';
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
  vi.mocked(bindToolsForAgentSpec).mockReturnValue({
    allowlist: [],
    enabledToolsByServer: {},
    nativeTools: [],
    mcpServerBundles: [],
    mcpServerNames: [],
    sandboxMode: 'read-only',
    warnings: [],
    fingerprints: {
      toolBindingHash: 'binding-hash',
      toolAllowlistHash: 'allowlist-hash',
      mcpServerSetHash: 'server-hash',
    },
  });
  mockExecFileSync.mockReturnValue('/usr/local/bin/claude\n');
  vi.mocked(costFromCliEnvelope).mockReturnValue(null);
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
      'All repo exploration must stay inside the workspace already configured for your tools.',
    );
    expect(systemPrompt).toContain(
      'If prior context is needed, use only context provided by Factory.',
    );
    expect(systemPrompt).toContain('skill prompt body');
  });

  it('passes Claude-safe MCP tool names while preserving canonical env allowlist', async () => {
    const envelope = JSON.stringify({ is_error: false, result: '{"ok":true}' });
    mockSpawn.mockReturnValue(makeChild(0, envelope));
    vi.mocked(bindToolsForAgentSpec).mockReturnValueOnce({
      allowlist: [
        'mcp__factory-tools__read_file',
        'mcp__factory-tools__repo_intel.query',
        'mcp__factory-tools__search_text',
      ],
      enabledToolsByServer: {
        'factory-tools': ['read_file', 'repo_intel.query', 'search_text'],
      },
      nativeTools: [],
      mcpServerBundles: [],
      mcpServerNames: ['factory-tools'],
      sandboxMode: 'read-only',
      warnings: [],
      fingerprints: {
        toolBindingHash: 'binding-hash',
        toolAllowlistHash: 'allowlist-hash',
        mcpServerSetHash: 'server-hash',
      },
    });

    const runtime = new ClaudeCliRuntime();
    await runtime.run(makeSpec({ toolBundles: ['read'] }));

    const argv = mockSpawn.mock.calls[0][1] as string[];
    const allowedTools = argv[argv.indexOf('--allowedTools') + 1];
    expect(allowedTools).toContain('mcp__factory-tools__repo_intel_query');
    expect(allowedTools).not.toContain('mcp__factory-tools__repo_intel.query');

    const env = (mockSpawn.mock.calls[0][2] as { env: Record<string, string> }).env;
    expect(env.FACTORY_RUN_ALLOWLIST).toContain('mcp__factory-tools__repo_intel.query');
    expect(env.FACTORY_RUN_ALLOWLIST).not.toContain('mcp__factory-tools__repo_intel_query');
  });

  it('inserts a success row when CLI exits with valid envelope', async () => {
    const envelope = JSON.stringify({ is_error: false, result: '{"ok":true}' });
    mockSpawn.mockReturnValue(makeChild(0, envelope));

    const runtime = new ClaudeCliRuntime();
    await runtime.run(makeSpec());

    expect(mockRecordAgentRun).toHaveBeenCalledWith({
      runId: 'run-abc',
      personaId: 'test-project/developer/0',
      outcome: 'success',
      projectId: 'test-project',
      role: 'developer',
      skill: 'fix-issue',
      workItemId: 'github:owner/repo#1',
    });
  });

  it('emits run-completed on an under-budget successful run', async () => {
    vi.mocked(costFromCliEnvelope).mockReturnValue({
      inputTokens: 20,
      outputTokens: 10,
      cachedInputTokens: 5,
      cacheCreationInputTokens: 3,
      reasoningOutputTokens: 2,
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
          cost: expect.objectContaining({ usd: 0.25, cacheCreationInputTokens: 3 }),
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
    expect(mockRecordToolStatsForRun).toHaveBeenCalledWith('run-abc');
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
          toolBindingHash: 'binding-hash',
          toolAllowlistHash: 'allowlist-hash',
          mcpServerSetHash: 'server-hash',
          nativeToolCount: 0,
          mcpServerNames: [],
          toolBindingWarningCount: 0,
          toolBindingWarnings: [],
        }),
      }),
    );
  });

  it('emits tool binding warnings on run-started and telemetry log events', async () => {
    const envelope = JSON.stringify({ is_error: false, result: '{"ok":true}' });
    mockSpawn.mockReturnValue(makeChild(0, envelope));
    vi.mocked(bindToolsForAgentSpec).mockReturnValueOnce({
      allowlist: [],
      enabledToolsByServer: {},
      nativeTools: [],
      mcpServerBundles: [],
      mcpServerNames: [],
      sandboxMode: 'read-only',
      warnings: [{ kind: 'unknown-bundle', name: 'legacy' }],
      fingerprints: {
        toolBindingHash: 'binding-hash',
        toolAllowlistHash: 'allowlist-hash',
        mcpServerSetHash: 'server-hash',
      },
    });

    const runtime = new ClaudeCliRuntime();
    await runtime.run(makeSpec());

    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.run-started',
        payload: expect.objectContaining({
          toolBindingWarningCount: 1,
          toolBindingWarnings: [{ kind: 'unknown-bundle', name: 'legacy' }],
        }),
      }),
    );
    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.log',
        payload: expect.objectContaining({
          metric: 'tool_binding_warnings',
          warningCount: 1,
          warnings: [{ kind: 'unknown-bundle', name: 'legacy' }],
        }),
      }),
    );
  });

  it('records cost, emits budget-exceeded and run-failed, and rejects over-budget runs', async () => {
    vi.mocked(costFromCliEnvelope).mockReturnValue({
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 10,
      cacheCreationInputTokens: 4,
      reasoningOutputTokens: 5,
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
        cachedInputTokens: 10,
        cacheCreationInputTokens: 4,
        reasoningOutputTokens: 5,
      }),
    );
    expect(mockRecordToolStatsForRun).toHaveBeenCalledWith('run-abc');

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

  it('can return valid terminal output after post-run budget exceeded when policy opts in', async () => {
    vi.mocked(costFromCliEnvelope).mockReturnValue({
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      reasoningOutputTokens: 0,
      costUsd: 1.25,
      costLabel: 'exact',
    });
    const envelope = JSON.stringify({
      is_error: false,
      result: '{"wpId":"WP1","confidence":"high"}',
    });
    mockSpawn.mockReturnValue(makeChild(0, envelope));

    const runtime = new ClaudeCliRuntime();
    const run = runtime.run(
      makeSpec({
        skill: 'implement-wp',
        budgetPolicy: { onPostRunExceeded: 'return-output' },
        budgets: { maxTurns: 10, maxBudgetUsd: 1, timeoutMs: 5000 },
      }),
    );

    await expect(run).resolves.toMatchObject({
      output: { wpId: 'WP1', confidence: 'high' },
      budgetExceeded: { costUsd: 1.25, budgetUsd: 1, overByUsd: 0.25 },
    });

    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'agent.budget-exceeded' }),
    );
    expect(mockEventStore.appendEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'agent.run-completed' }),
    );
    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.run-failed',
        payload: expect.objectContaining({ reason: 'budget-exceeded' }),
      }),
    );
  });

  it('inserts a failure row when CLI reports is_error=true', async () => {
    const envelope = JSON.stringify({ is_error: true, result: 'budget exceeded' });
    mockSpawn.mockReturnValue(makeChild(0, envelope));

    const runtime = new ClaudeCliRuntime();
    await runtime.run(makeSpec()).catch(() => {});

    expect(mockRecordAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure' }),
    );
  });

  it('inserts a failure row when CLI exits non-zero with no envelope', async () => {
    mockSpawn.mockReturnValue(makeChild(1, 'not json'));

    const runtime = new ClaudeCliRuntime();
    await runtime.run(makeSpec()).catch(() => {});

    expect(mockRecordAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure' }),
    );
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
