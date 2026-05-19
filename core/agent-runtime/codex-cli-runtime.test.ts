import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEventStore, mockRecordCost, mockSpawn } = vi.hoisted(() => ({
  mockEventStore: { appendEvent: vi.fn(), replay: vi.fn().mockReturnValue([]) },
  mockRecordCost: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock('../cost/repository.js', () => ({ recordCost: mockRecordCost }));
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
import { buildCodexArgv } from './codex-config.js';

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
});

describe('CodexCliRuntime timeout handling', () => {
  async function runSuccessfulCodexSpec(overrides: Record<string, unknown> = {}) {
    const child = makeHangingChild();
    mockSpawn.mockReturnValue(child);

    const runtime = new CodexCliRuntime();
    const run = runtime.run(makeSpec(overrides));

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

    await expect(run).resolves.toMatchObject({ output: { ok: true } });
  }

  it('uses danger-full-access and never-approval for evidence validate runs', async () => {
    await runSuccessfulCodexSpec({ skill: 'playwright-repro', toolBundles: ['validate'] });

    expect(buildCodexArgv).toHaveBeenCalledWith(
      expect.objectContaining({
        commandSandbox: 'danger-full-access',
        approvalPolicy: 'never',
      }),
    );
  });

  it('includes the Factory workspace-only instruction in Codex system instructions', async () => {
    await runSuccessfulCodexSpec({ appendSystemPrompt: 'skill prompt body' });

    const call = vi.mocked(buildCodexArgv).mock.calls[0]?.[0];
    expect(call).toEqual(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('Factory agents must not read ~/.codex'),
      }),
    );
    expect(call?.systemPrompt).toContain(
      'All repo exploration must stay under workspaceDir / <worktreePath>.',
    );
    expect(call?.systemPrompt).toContain(
      'If prior context is needed, use only context provided by Factory.',
    );
    expect(call?.systemPrompt).toContain('skill prompt body');
  });

  it('does not use danger-full-access for QA even though QA includes validate', async () => {
    await runSuccessfulCodexSpec({
      skill: 'qa',
      role: 'qa',
      toolBundles: ['read', 'shell', 'validate'],
    });

    const call = vi.mocked(buildCodexArgv).mock.calls[0]?.[0];
    expect(call).toEqual(
      expect.objectContaining({ commandSandbox: undefined, approvalPolicy: undefined }),
    );
  });

  it('fails fast when a streamed Bash command references a /Users path outside the workspace', async () => {
    const child = makeHangingChild();
    mockSpawn.mockReturnValue(child);
    const processKill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const runtime = new CodexCliRuntime();
    const run = runtime.run(makeSpec({ workspaceDir: '/Users/shaunnesbitt/project/worktree' }));
    const rejection = expect(run).rejects.toThrow('outside workspace');

    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          type: 'item.started',
          item: {
            type: 'command_execution',
            command:
              '/bin/zsh -lc "nl -ba /Users/shaunnesbitt/.codex/memories/MEMORY.md | sed -n \'1,20p\'"',
          },
        })}\n`,
      ),
    );

    await rejection;

    expect(processKill).toHaveBeenCalledWith(-4321, 'SIGKILL');
    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.tool-call',
        payload: expect.objectContaining({
          blocked: true,
          block_reason: expect.stringContaining('[REDACTED_PATH]'),
        }),
      }),
    );
    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.run-failed',
        payload: expect.objectContaining({ reason: 'workspace-boundary-violation' }),
      }),
    );

    child.emit('close', 0);
    expect(mockEventStore.appendEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'agent.run-completed' }),
    );
    processKill.mockRestore();
  });

  it('does not use danger-full-access for review even though review includes validate', async () => {
    await runSuccessfulCodexSpec({
      skill: 'review',
      role: 'reviewer',
      toolBundles: ['read', 'validate'],
    });

    const call = vi.mocked(buildCodexArgv).mock.calls[0]?.[0];
    expect(call).toEqual(
      expect.objectContaining({ commandSandbox: undefined, approvalPolicy: undefined }),
    );
  });

  it('emits model and runtime metadata when the run starts', async () => {
    await runSuccessfulCodexSpec({ modelOverride: 'gpt-5.4-mini' });

    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.run-started',
        payload: expect.objectContaining({
          modelId: 'gpt-5.4-mini',
          runtime: 'codex-cli',
        }),
      }),
    );
  });

  it('emits one live decision event from a streamed agent_message marker', async () => {
    const child = makeHangingChild();
    mockSpawn.mockReturnValue(child);

    const runtime = new CodexCliRuntime();
    const run = runtime.run(makeSpec({ skill: 'investigate' }));

    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'msg_1',
            type: 'agent_message',
            text: '[decision] READ: Searching app shell components\n{"ok":true}',
          },
        })}\n`,
      ),
    );

    const decisionCalls = mockEventStore.appendEvent.mock.calls.filter(
      ([e]) => e.kind === 'agent.decision-summary-live',
    );
    expect(decisionCalls).toHaveLength(1);
    expect(decisionCalls[0][0]).toMatchObject({
      projectId: 'test-project',
      workItemId: 'github:owner/repo#1',
      runId: 'run-codex',
      personaId: 'test-project/developer/0',
      payload: {
        run_id: 'run-codex',
        kind: 'READ',
        summary: 'Searching app shell components',
        skill: 'investigate',
        personaId: 'test-project/developer/0',
      },
    });

    child.emit('close', 0);
    await expect(run).resolves.toMatchObject({ output: { ok: true } });
  });

  it('preserves live decision marker order from a single agent_message', async () => {
    const child = makeHangingChild();
    mockSpawn.mockReturnValue(child);

    const runtime = new CodexCliRuntime();
    const run = runtime.run(makeSpec());

    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'msg_1',
            type: 'agent_message',
            text: [
              '[decision] READ: Searching chrome coverage',
              '[decision] UNCERTAINTY: Test target unclear',
              '{"ok":true}',
            ].join('\n'),
          },
        })}\n`,
      ),
    );
    child.emit('close', 0);
    await run;

    const summaries = mockEventStore.appendEvent.mock.calls
      .filter(([e]) => e.kind === 'agent.decision-summary-live')
      .map(([e]) => (e.payload as { summary?: string }).summary);
    expect(summaries).toEqual(['Searching chrome coverage', 'Test target unclear']);
  });

  it('does not double-emit markers when Codex replays cumulative assistant text', async () => {
    const child = makeHangingChild();
    mockSpawn.mockReturnValue(child);

    const runtime = new CodexCliRuntime();
    const run = runtime.run(makeSpec());

    child.stdout.emit(
      'data',
      Buffer.from(
        [
          JSON.stringify({
            type: 'item.updated',
            item: {
              id: 'msg_1',
              type: 'agent_message',
              text: '[decision] READ: Searching files',
            },
          }),
          JSON.stringify({
            type: 'item.updated',
            item: {
              id: 'msg_1',
              type: 'agent_message',
              text: '[decision] READ: Searching files\n[decision] INSIGHT: Found owner\n',
            },
          }),
          JSON.stringify({
            type: 'item.completed',
            item: {
              id: 'msg_1',
              type: 'agent_message',
              text: '[decision] READ: Searching files\n[decision] INSIGHT: Found owner\n{"ok":true}',
            },
          }),
          '',
        ].join('\n'),
      ),
    );
    child.emit('close', 0);
    await run;

    const summaries = mockEventStore.appendEvent.mock.calls
      .filter(([e]) => e.kind === 'agent.decision-summary-live')
      .map(([e]) => (e.payload as { summary?: string }).summary);
    expect(summaries).toEqual(['Searching files', 'Found owner']);
  });

  it('does not emit partial updates or re-emit a marker whose line is later extended', async () => {
    const child = makeHangingChild();
    mockSpawn.mockReturnValue(child);

    const runtime = new CodexCliRuntime();
    const run = runtime.run(makeSpec());

    child.stdout.emit(
      'data',
      Buffer.from(
        [
          JSON.stringify({
            type: 'item.updated',
            item: {
              id: 'msg_1',
              type: 'agent_message',
              text: '[decision] READ: Searching',
            },
          }),
          JSON.stringify({
            type: 'item.updated',
            item: {
              id: 'msg_1',
              type: 'agent_message',
              text: '[decision] READ: Searching files\n',
            },
          }),
          JSON.stringify({
            type: 'item.updated',
            item: {
              id: 'msg_1',
              type: 'agent_message',
              text: '[decision] READ: Searching files and confirming ownership\n',
            },
          }),
          JSON.stringify({
            type: 'item.completed',
            item: {
              id: 'msg_1',
              type: 'agent_message',
              text: '[decision] READ: Searching files and confirming ownership\n{"ok":true}',
            },
          }),
          '',
        ].join('\n'),
      ),
    );
    child.emit('close', 0);
    await run;

    const summaries = mockEventStore.appendEvent.mock.calls
      .filter(([e]) => e.kind === 'agent.decision-summary-live')
      .map(([e]) => (e.payload as { summary?: string }).summary);
    expect(summaries).toEqual(['Searching files']);
  });

  it('ignores raw delta chunks for live decision parsing', async () => {
    const child = makeHangingChild();
    mockSpawn.mockReturnValue(child);

    const runtime = new CodexCliRuntime();
    const run = runtime.run(makeSpec());

    child.stdout.emit(
      'data',
      Buffer.from(
        [
          JSON.stringify({
            type: 'item.delta',
            item: {
              id: 'msg_1',
              type: 'agent_message',
              delta: '[decision] READ: partial chunk',
            },
          }),
          JSON.stringify({
            type: 'item.completed',
            item: { id: 'msg_1', type: 'agent_message', text: '{"ok":true}' },
          }),
          '',
        ].join('\n'),
      ),
    );
    child.emit('close', 0);
    await run;

    expect(
      mockEventStore.appendEvent.mock.calls.filter(
        ([e]) => e.kind === 'agent.decision-summary-live',
      ),
    ).toHaveLength(0);
  });

  it('normalizes invalid live decision marker kinds to UNKNOWN', async () => {
    const child = makeHangingChild();
    mockSpawn.mockReturnValue(child);

    const runtime = new CodexCliRuntime();
    const run = runtime.run(makeSpec());

    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'msg_1',
            type: 'agent_message',
            text: '[decision] NOT_A_KIND: Still surface this progress\n{"ok":true}',
          },
        })}\n`,
      ),
    );
    child.emit('close', 0);
    await run;

    const decisionCall = mockEventStore.appendEvent.mock.calls.find(
      ([e]) => e.kind === 'agent.decision-summary-live',
    );
    expect(decisionCall?.[0].payload).toMatchObject({
      kind: 'UNKNOWN',
      summary: 'Still surface this progress',
    });
  });

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
    processKill.mockRestore();
  });

  it('kills and rejects when streamed tool calls exceed maxTurns', async () => {
    const child = makeHangingChild();
    mockSpawn.mockReturnValue(child);
    const processKill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const runtime = new CodexCliRuntime();
    const run = runtime.run(
      makeSpec({ budgets: { maxTurns: 1, maxBudgetUsd: 1, timeoutMs: 5000 } }),
    );
    const rejection = expect(run).rejects.toThrow('tool-call budget exceeded');

    child.stdout.emit(
      'data',
      Buffer.from(
        [
          JSON.stringify({
            type: 'item.started',
            item: { type: 'command_execution', command: '/bin/zsh -lc pwd' },
          }),
          JSON.stringify({
            type: 'item.started',
            item: { type: 'command_execution', command: '/bin/zsh -lc ls' },
          }),
          '',
        ].join('\n'),
      ),
    );
    await rejection;

    expect(processKill).toHaveBeenCalledWith(-4321, 'SIGKILL');
    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.run-failed',
        payload: expect.objectContaining({
          reason: 'tool-call-budget-exceeded',
          toolCallsUsed: 2,
          maxToolCalls: 1,
        }),
      }),
    );

    child.emit('close', 0);
    expect(mockEventStore.appendEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'agent.run-completed' }),
    );
    processKill.mockRestore();
  });

  it('records cost, emits budget-exceeded and run-failed, and rejects over-budget runs', async () => {
    const child = makeHangingChild();
    mockSpawn.mockReturnValue(child);

    const runtime = new CodexCliRuntime();
    const run = runtime.run(
      makeSpec({ budgets: { maxTurns: 10, maxBudgetUsd: 0.5, timeoutMs: 5000 } }),
    );

    child.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          result: '{"ok":true}',
          usage: { input_tokens: 100, output_tokens: 50 },
          total_cost_usd: 0.75,
        }),
      ),
    );
    child.emit('close', 0);

    await expect(run).rejects.toThrow('exceeded budget');

    expect(mockRecordCost).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-codex',
        costUsd: 0.75,
        inputTokens: 100,
        outputTokens: 50,
      }),
    );
    const calls = mockEventStore.appendEvent.mock.calls;
    const recordCostOrder = mockRecordCost.mock.invocationCallOrder[0];
    const budgetCall = calls.find(([e]) => e.kind === 'agent.budget-exceeded');
    const budgetIndex = calls.findIndex(([e]) => e.kind === 'agent.budget-exceeded');
    const failedCall = calls.find(([e]) => {
      const payload = e.payload as { reason?: string };
      return e.kind === 'agent.run-failed' && payload.reason === 'budget-exceeded';
    });
    expect(budgetCall).toBeDefined();
    expect(budgetCall?.[0].payload).toMatchObject({
      runId: 'run-codex',
      skill: 'fix-issue',
      modelId: 'gpt-5.3-codex',
      costUsd: 0.75,
      budgetUsd: 0.5,
      inputTokens: 100,
      outputTokens: 50,
      overByUsd: 0.25,
    });
    expect(failedCall).toBeDefined();
    expect(budgetIndex).toBeGreaterThanOrEqual(0);
    expect(recordCostOrder).toBeLessThan(
      mockEventStore.appendEvent.mock.invocationCallOrder[budgetIndex],
    );
    expect(mockEventStore.appendEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'agent.run-completed' }),
    );
  });
});
