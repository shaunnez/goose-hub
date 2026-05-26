import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEventStore, mockRecordAgentRun, mockRecordCost, mockRecordToolStatsForRun, mockSpawn } =
  vi.hoisted(() => ({
    mockEventStore: { appendEvent: vi.fn(), replay: vi.fn().mockReturnValue([]) },
    mockRecordAgentRun: vi.fn(),
    mockRecordCost: vi.fn(),
    mockRecordToolStatsForRun: vi.fn(),
    mockSpawn: vi.fn(),
  }));

vi.mock('../cost/repository.js', () => ({
  recordCost: mockRecordCost,
  recordToolStatsForRun: mockRecordToolStatsForRun,
}));
vi.mock('../event-stream/store.js', () => ({ eventStore: mockEventStore }));
vi.mock('../cost/skill-stage.js', () => ({ stageForSkill: vi.fn().mockReturnValue('develop') }));
vi.mock('../db/repositories/project-settings.js', () => ({
  getRecordDecisionTool: vi.fn().mockReturnValue(false),
}));
vi.mock('../tool-layer/allowlist.js', () => ({ computeAllowlist: vi.fn().mockReturnValue([]) }));
vi.mock('../tool-layer/decision-capture-hook.js', () => ({ deployDecisionCaptureHook: vi.fn() }));
vi.mock('../tool-layer/pre-tool-use-hook.js', () => ({ deployHooks: vi.fn() }));
vi.mock('../tool-layer/sandbox.js', () => ({
  writeCodexWorkspaceSandbox: vi.fn(),
  writeWorkspaceSandbox: vi.fn(),
}));
vi.mock('./context-assembly.js', () => ({
  assembleSpawnContext: vi.fn().mockReturnValue({ contextXml: '<task></task>' }),
}));
vi.mock('./models.js', () => ({
  defaultModelForTierAndProvider: vi.fn().mockReturnValue('gpt-5.3-codex'),
  estimateCostUsd: vi.fn().mockReturnValue(0),
}));
vi.mock('./run-record.js', () => ({ recordAgentRun: mockRecordAgentRun }));
vi.mock('./codex-config.js', () => ({
  CodexBinaryNotFoundError: class CodexBinaryNotFoundError extends Error {},
  CodexNotAuthenticatedError: class CodexNotAuthenticatedError extends Error {},
  assertCodexAuthenticated: vi.fn(),
  buildCodexArgv: vi.fn().mockReturnValue(['exec', '--json']),
  buildCodexMcpInlineArgs: vi.fn().mockReturnValue([]),
  codexMcpEnabledToolsForServer: vi.fn().mockReturnValue([]),
  escapeForTomlMultilineBasic: vi.fn((value: string) => value),
  resolveCodexBinary: vi.fn().mockReturnValue('/usr/local/bin/codex'),
}));
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

import { computeAllowlist } from '../tool-layer/allowlist.js';
import { writeCodexWorkspaceSandbox, writeWorkspaceSandbox } from '../tool-layer/sandbox.js';
import { CodexCliRuntime } from './codex-cli.js';
import {
  buildCodexArgv,
  buildCodexMcpInlineArgs,
  codexMcpEnabledToolsForServer,
} from './codex-config.js';
import { estimateCostUsd } from './models.js';

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
  vi.mocked(computeAllowlist).mockReturnValue([]);
  vi.mocked(buildCodexMcpInlineArgs).mockReturnValue([]);
  vi.mocked(codexMcpEnabledToolsForServer).mockReturnValue([]);
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
      'All repo exploration must stay inside the workspace already configured for your tools.',
    );
    expect(call?.systemPrompt).toContain(
      'If prior context is needed, use only context provided by Factory.',
    );
    expect(call?.systemPrompt).toContain('skill prompt body');
  });

  it('forwards AgentSpec effort into Codex argv construction', async () => {
    await runSuccessfulCodexSpec({ effort: 'high' });

    expect(buildCodexArgv).toHaveBeenCalledWith(
      expect.objectContaining({
        effort: 'high',
      }),
    );
  });

  it('writes AgentSpec outputJsonSchema to a per-run file and passes it to Codex', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    await runSuccessfulCodexSpec({
      workspaceDir: '/tmp/factory-worktree',
      outputJsonSchema: { type: 'object', properties: { status: { enum: ['ok'] } } },
    });

    const call = vi.mocked(buildCodexArgv).mock.calls[0]?.[0];
    expect(call?.outputSchemaPath).toMatch(
      /^\/tmp\/factory-worktree\/\.factory\/output-schemas\/[a-f0-9]{16}\.schema\.json$/,
    );
    expect(mkdirSync).toHaveBeenCalledWith('/tmp/factory-worktree/.factory/output-schemas', {
      recursive: true,
    });
    expect(writeFileSync).toHaveBeenCalledWith(
      call?.outputSchemaPath,
      `${JSON.stringify({ type: 'object', properties: { status: { enum: ['ok'] } } }, null, 2)}\n`,
      { flag: 'w' },
    );
  });

  it('writes the Codex workspace hook sandbox for default sandboxed runs', async () => {
    await runSuccessfulCodexSpec({ workspaceDir: '/tmp/factory-worktree' });

    expect(writeWorkspaceSandbox).toHaveBeenCalledWith('/tmp/factory-worktree', {
      role: 'developer',
      recordDecisionTool: false,
    });
    expect(writeCodexWorkspaceSandbox).toHaveBeenCalledWith('/tmp/factory-worktree');
  });

  it('keeps Codex workspace hook sandbox when sandboxMode is preconfigured', async () => {
    await runSuccessfulCodexSpec({
      sandboxMode: 'preconfigured',
      workspaceDir: '/tmp/factory-preconfigured-worktree',
    });

    expect(writeWorkspaceSandbox).not.toHaveBeenCalled();
    expect(writeCodexWorkspaceSandbox).toHaveBeenCalledWith('/tmp/factory-preconfigured-worktree');
  });

  it('uses workspace-write command sandbox for implement dev-tools runs', async () => {
    await runSuccessfulCodexSpec({ skill: 'implement', toolBundles: ['dev-tools'] });

    expect(buildCodexArgv).toHaveBeenCalledWith(
      expect.objectContaining({
        commandSandbox: 'workspace-write',
        approvalPolicy: undefined,
      }),
    );
  });

  it('uses workspace-write command sandbox and preserves WP preconfigured sandbox', async () => {
    await runSuccessfulCodexSpec({
      skill: 'implement-wp',
      toolBundles: ['dev-tools'],
      sandboxMode: 'preconfigured',
      workspaceDir: '/tmp/factory-wp-worktree',
    });

    expect(writeWorkspaceSandbox).not.toHaveBeenCalled();
    expect(writeCodexWorkspaceSandbox).toHaveBeenCalledWith('/tmp/factory-wp-worktree');
    expect(buildCodexArgv).toHaveBeenCalledWith(
      expect.objectContaining({
        commandSandbox: 'workspace-write',
        approvalPolicy: undefined,
      }),
    );
  });

  it('derives Codex MCP enabled_tools from the run allowlist', async () => {
    vi.mocked(computeAllowlist).mockReturnValue([
      'mcp__factory-tools__read_file',
      'mcp__factory-tools__run_tests',
      'Bash',
    ]);
    vi.mocked(codexMcpEnabledToolsForServer).mockReturnValue(['read_file', 'run_tests']);

    await runSuccessfulCodexSpec({ toolBundles: ['dev-tools'] });

    expect(codexMcpEnabledToolsForServer).toHaveBeenCalledWith('factory-tools', [
      'mcp__factory-tools__read_file',
      'mcp__factory-tools__run_tests',
      'Bash',
    ]);
    expect(buildCodexMcpInlineArgs).toHaveBeenCalledWith(
      expect.objectContaining({
        'factory-tools': expect.objectContaining({
          enabledTools: ['read_file', 'run_tests'],
          env: expect.objectContaining({
            FACTORY_SKILL: 'fix-issue',
            FACTORY_PERSONA_ID: 'test-project/developer/0',
            FACTORY_FORBID_MCP_RESOURCES: '1',
          }),
        }),
      }),
    );
  });

  it('asks Codex argv construction to trust Factory-generated hooks', async () => {
    await runSuccessfulCodexSpec();

    expect(buildCodexArgv).toHaveBeenCalledWith(
      expect.objectContaining({
        bypassHookTrust: true,
      }),
    );
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
    vi.mocked(computeAllowlist).mockReturnValue(['Bash']);
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

  it('fails fast when streamed native Bash is not in the run allowlist', async () => {
    const child = makeHangingChild();
    mockSpawn.mockReturnValue(child);
    const processKill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const runtime = new CodexCliRuntime();
    const run = runtime.run(makeSpec({ workspaceDir: '/Users/shaunnesbitt/project/worktree' }));
    const rejection = expect(run).rejects.toThrow('tool not in allowlist: Bash');

    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          type: 'item.started',
          item: { type: 'command_execution', command: '/bin/zsh -lc pwd' },
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
          block_reason: 'tool not in allowlist: Bash',
        }),
      }),
    );
    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.run-failed',
        payload: expect.objectContaining({ reason: 'tool-not-in-allowlist' }),
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

  it('records cached and reasoning tokens with discounted estimated Codex cost', async () => {
    vi.mocked(estimateCostUsd).mockReturnValueOnce(3.55);
    const child = makeHangingChild();
    mockSpawn.mockReturnValue(child);

    const runtime = new CodexCliRuntime();
    const run = runtime.run(
      makeSpec({
        modelOverride: 'gpt-5.4',
        budgets: { maxTurns: 10, maxBudgetUsd: 10, timeoutMs: 5000 },
      }),
    );

    child.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          result: '{"ok":true}',
          usage: {
            input_tokens: 1000,
            cached_input_tokens: 400,
            output_tokens: 100,
            reasoning_output_tokens: 20,
          },
        }),
      ),
    );
    child.emit('close', 0);

    await expect(run).resolves.toMatchObject({ output: { ok: true } });

    expect(estimateCostUsd).toHaveBeenCalledWith('gpt-5.4', 1000, 100, {
      cachedInputTokens: 400,
      reasoningOutputTokens: 20,
    });
    expect(mockRecordCost).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-codex',
        modelId: 'gpt-5.4',
        inputTokens: 1000,
        outputTokens: 100,
        cachedInputTokens: 400,
        reasoningOutputTokens: 20,
        costUsd: 3.55,
      }),
    );
    expect(mockRecordAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-codex',
        outcome: 'success',
        projectId: 'test-project',
        role: 'developer',
        skill: 'fix-issue',
      }),
    );
    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.run-completed',
        payload: expect.objectContaining({
          cost: expect.objectContaining({
            usd: 3.55,
            inputTokens: 1000,
            outputTokens: 100,
            cachedInputTokens: 400,
            reasoningOutputTokens: 20,
          }),
        }),
      }),
    );
  });

  it('emits lightweight prompt/context size telemetry before spawn', async () => {
    await runSuccessfulCodexSpec({ appendSystemPrompt: 'skill prompt body' });

    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.log',
        payload: expect.objectContaining({
          stream: 'telemetry',
          metric: 'prompt_context_size',
          contextChars: '<task></task>'.length,
          totalPromptChars: expect.any(Number),
          estimatedPromptTokens: expect.any(Number),
        }),
      }),
    );
  });

  it('surfaces native Codex patch rejection as a blocked native write attempt', async () => {
    const child = makeHangingChild();
    mockSpawn.mockReturnValue(child);

    const runtime = new CodexCliRuntime();
    const run = runtime.run(makeSpec());

    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: '{"ok":true}' },
        })}\n`,
      ),
    );
    child.stderr.emit(
      'data',
      Buffer.from('patch rejected: writing is blocked by read-only sandbox\n'),
    );
    child.emit('close', 0);

    await expect(run).resolves.toMatchObject({ output: { ok: true } });
    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.tool-call',
        payload: expect.objectContaining({
          tool_name: 'apply_patch',
          blocked: true,
          block_reason: 'native-write-blocked',
          status: 'failed',
        }),
        personaId: 'test-project/developer/0',
      }),
    );
  });

  it('records resources/read failed as a non-fatal advisory event', async () => {
    const child = makeHangingChild();
    mockSpawn.mockReturnValue(child);

    const runtime = new CodexCliRuntime();
    const run = runtime.run(makeSpec({ skill: 'scout-code-path' }));

    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: '{"ok":true}' },
        })}\n`,
      ),
    );
    child.stderr.emit('data', Buffer.from('resources/read failed: file://memory\n'));
    child.emit('close', 0);

    await expect(run).resolves.toMatchObject({ output: { ok: true } });

    const calls: Parameters<typeof mockEventStore.appendEvent>[0][] =
      mockEventStore.appendEvent.mock.calls.map((c: unknown[]) => c[0]);

    const advisory = calls.find(
      (e) =>
        e.kind === 'agent.runtime-advisory' &&
        (e.payload as { surface: string }).surface === 'resources/read failed',
    );
    expect(advisory).toBeDefined();
    expect((advisory?.payload as { blocked?: unknown }).blocked).toBeUndefined();
    expect(advisory?.payload as { stderr?: string; toolName?: string }).toMatchObject({
      stderr: 'resources/read failed: file://memory',
      toolName: 'resources/read',
    });
    expect(advisory?.personaId).toBe('test-project/developer/0');

    // No agent.run-blocked event for this surface.
    expect(calls.some((e) => e.kind === 'agent.run-blocked')).toBe(false);

    // No blocked tool-call for resources/read.
    expect(
      calls.some(
        (e) =>
          e.kind === 'agent.tool-call' &&
          (e.payload as { tool_name?: string; blocked?: boolean }).tool_name === 'resources/read' &&
          (e.payload as { blocked?: boolean }).blocked === true,
      ),
    ).toBe(false);

    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'agent.run-completed' }),
    );
  });

  it('dedupes repeated resources/read advisories and filters them from stderr logs', async () => {
    const child = makeHangingChild();
    mockSpawn.mockReturnValue(child);

    const runtime = new CodexCliRuntime();
    const run = runtime.run(makeSpec({ skill: 'scout-test-inventory' }));

    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: '{"ok":true}' },
        })}\n`,
      ),
    );
    child.stderr.emit(
      'data',
      Buffer.from(
        [
          'Reading additional input from stdin...',
          'resources/read failed: noop',
          'resources/read failed: noop2',
          'resources/read failed: noop3',
          '',
        ].join('\n'),
      ),
    );
    child.emit('close', 0);

    await expect(run).resolves.toMatchObject({ output: { ok: true } });

    const calls: Parameters<typeof mockEventStore.appendEvent>[0][] =
      mockEventStore.appendEvent.mock.calls.map((c: unknown[]) => c[0]);
    const advisories = calls.filter((e) => e.kind === 'agent.runtime-advisory');
    expect(advisories).toHaveLength(1);
    expect(advisories[0].payload as { stderr?: string }).toMatchObject({
      stderr: 'resources/read failed: noop',
    });

    const stderrLog = calls.find(
      (e) => e.kind === 'agent.log' && (e.payload as { stream?: string }).stream === 'stderr',
    );
    expect(stderrLog?.payload as { text?: string }).toMatchObject({
      text: 'Reading additional input from stdin...',
    });
  });

  it('records resources/list failed as a non-fatal advisory and filters it from stderr logs', async () => {
    const child = makeHangingChild();
    mockSpawn.mockReturnValue(child);

    const runtime = new CodexCliRuntime();
    const run = runtime.run(makeSpec());

    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: '{"ok":true}' },
        })}\n`,
      ),
    );
    child.stderr.emit('data', Buffer.from('resources/list failed: startup probe\n'));
    child.emit('close', 0);

    await expect(run).resolves.toMatchObject({ output: { ok: true } });
    const calls: Parameters<typeof mockEventStore.appendEvent>[0][] =
      mockEventStore.appendEvent.mock.calls.map((c: unknown[]) => c[0]);
    expect(
      calls.some(
        (e) =>
          e.kind === 'agent.runtime-advisory' &&
          (e.payload as { surface?: string }).surface === 'resources/list failed',
      ),
    ).toBe(true);
    expect(
      calls.some(
        (e) =>
          e.kind === 'agent.log' &&
          (e.payload as { stream?: string; text?: string }).stream === 'stderr' &&
          (e.payload as { text?: string }).text?.includes('resources/list failed'),
      ),
    ).toBe(false);
    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'agent.run-completed' }),
    );
  });

  it('records resources/templates/list failed as a non-fatal advisory and filters it from stderr logs', async () => {
    const child = makeHangingChild();
    mockSpawn.mockReturnValue(child);

    const runtime = new CodexCliRuntime();
    const run = runtime.run(makeSpec());

    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: '{"ok":true}' },
        })}\n`,
      ),
    );
    child.stderr.emit(
      'data',
      Buffer.from('resources/templates/list failed: startup template probe\n'),
    );
    child.emit('close', 0);

    await expect(run).resolves.toMatchObject({ output: { ok: true } });
    const calls: Parameters<typeof mockEventStore.appendEvent>[0][] =
      mockEventStore.appendEvent.mock.calls.map((c: unknown[]) => c[0]);
    expect(
      calls.some(
        (e) =>
          e.kind === 'agent.runtime-advisory' &&
          (e.payload as { surface?: string }).surface === 'resources/templates/list failed',
      ),
    ).toBe(true);
    expect(
      calls.some(
        (e) =>
          e.kind === 'agent.log' &&
          (e.payload as { stream?: string; text?: string }).stream === 'stderr' &&
          (e.payload as { text?: string }).text?.includes('resources/templates/list failed'),
      ),
    ).toBe(false);
    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'agent.run-completed' }),
    );
  });

  it('logs normal Codex stderr without failing the run', async () => {
    const child = makeHangingChild();
    mockSpawn.mockReturnValue(child);

    const runtime = new CodexCliRuntime();
    const run = runtime.run(makeSpec());

    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: '{"ok":true}' },
        })}\n`,
      ),
    );
    child.stderr.emit('data', Buffer.from('Reading additional input from stdin...\n'));
    child.emit('close', 0);

    await expect(run).resolves.toMatchObject({ output: { ok: true } });
    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.log',
        payload: expect.objectContaining({
          stream: 'stderr',
          text: 'Reading additional input from stdin...',
        }),
      }),
    );
    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'agent.run-completed' }),
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

  it('records a failed agent run when the Codex child process emits an error', async () => {
    const child = makeHangingChild();
    mockSpawn.mockReturnValue(child);

    const runtime = new CodexCliRuntime();
    const run = runtime.run(makeSpec());

    child.emit('error', new Error('spawn ENOENT'));

    await expect(run).rejects.toThrow('spawn ENOENT');
    expect(mockRecordAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-codex',
        outcome: 'failure',
        projectId: 'test-project',
        role: 'developer',
        skill: 'fix-issue',
      }),
    );
    expect(mockEventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent.run-failed',
        payload: expect.objectContaining({
          runId: 'run-codex',
          skill: 'fix-issue',
          reason: 'spawn-error',
          error: 'spawn ENOENT',
        }),
      }),
    );

    child.emit('close', 0);
    expect(mockEventStore.appendEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'agent.run-completed' }),
    );
  });

  it('kills and rejects when streamed tool calls exceed maxTurns', async () => {
    vi.mocked(computeAllowlist).mockReturnValue(['Bash']);
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
    expect(mockRecordToolStatsForRun).toHaveBeenCalledWith('run-codex');
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

  it('can return valid terminal output after post-run budget exceeded when policy opts in', async () => {
    const child = makeHangingChild();
    mockSpawn.mockReturnValue(child);

    const runtime = new CodexCliRuntime();
    const run = runtime.run(
      makeSpec({
        skill: 'implement-wp',
        budgetPolicy: { onPostRunExceeded: 'return-output' },
        budgets: { maxTurns: 10, maxBudgetUsd: 0.5, timeoutMs: 5000 },
      }),
    );

    child.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          result: '{"wpId":"WP1","confidence":"high"}',
          usage: { input_tokens: 100, output_tokens: 50 },
          total_cost_usd: 0.75,
        }),
      ),
    );
    child.emit('close', 0);

    await expect(run).resolves.toMatchObject({
      output: { wpId: 'WP1', confidence: 'high' },
      budgetExceeded: { costUsd: 0.75, budgetUsd: 0.5, overByUsd: 0.25 },
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
});
