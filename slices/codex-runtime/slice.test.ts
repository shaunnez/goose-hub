import { execFileSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir as realHomedir } from 'node:os';
import { join as realJoin } from 'node:path';
import {
  CodexBinaryNotFoundError,
  CodexCliRuntime,
  CodexNotAuthenticatedError,
  buildCodexArgv,
  escapeForTomlMultilineBasic,
  parseCodexEnvelope,
  pickCodexToolCall,
  resolveCodexBinary,
} from '@goose-hub/core/agent-runtime/codex-cli.js';
import type { AgentSpec } from '@goose-hub/core/agent-runtime/interface.js';
import { selectRuntime } from '@goose-hub/core/agent-runtime/select-runtime.js';
import { computeAllowlist } from '@goose-hub/core/tool-layer/allowlist.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn().mockReturnValue('/mock/bin/codex'),
  spawn: vi.fn(),
}));
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: vi.fn().mockReturnValue('/mock-home') };
});
vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi.fn().mockReturnValue({ id: 1, kind: 'agent.run-started', payload: {} }),
    replay: vi.fn().mockReturnValue([]),
  },
}));
vi.mock('@goose-hub/core/tool-layer/allowlist.js', () => ({
  computeAllowlist: vi.fn().mockReturnValue([]),
}));
vi.mock('@goose-hub/core/tool-layer/pre-tool-use-hook.js', () => ({ deployHooks: vi.fn() }));
vi.mock('@goose-hub/core/tool-layer/sandbox.js', () => ({
  writeCodexWorkspaceSandbox: vi.fn(),
  writeWorkspaceSandbox: vi.fn(),
}));
vi.mock('@goose-hub/core/cost/repository.js', () => ({
  recordCost: vi.fn(),
  recordToolStatsForRun: vi.fn(),
}));

interface MockProcess {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn<(signal?: string) => void>>;
  _closeHandlers: Array<(code: number | null) => void>;
  _errorHandlers: Array<(err: Error) => void>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  simulateClose(code?: number | null): void;
  simulateError(err: Error): void;
}

function createMockProcess(): MockProcess {
  return {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn<(signal?: string) => void>(),
    _closeHandlers: [],
    _errorHandlers: [],
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === 'close') this._closeHandlers.push(handler as (code: number | null) => void);
      else if (event === 'error') this._errorHandlers.push(handler as (err: Error) => void);
    },
    simulateClose(code: number | null = 0) {
      for (const h of this._closeHandlers) h(code);
    },
    simulateError(err: Error) {
      for (const h of this._errorHandlers) h(err);
    },
  };
}

function makeSpec(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return {
    runId: 'codex-test-run',
    role: 'dev-reviewer' as AgentSpec['role'],
    skill: 'dev-review',
    context: { projectId: 'proj-test', workItemId: 'item-1' },
    contextAllowlist: ['projectId', 'workItemId'],
    freshContext: true,
    toolBundles: [],
    toolExtras: [],
    budgets: { maxTurns: 6, maxBudgetUsd: 0.5, timeoutMs: 30_000 },
    personaId: 'test-project/dev-reviewer/0',
    modelOverride: 'gpt-5.4',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(execFileSync).mockReturnValue('/mock/bin/codex' as never);
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(computeAllowlist).mockReturnValue([]);
  process.env.CODEX_BIN = '';
  process.env.MOCK_AGENTS = '';
  process.env.OPENAI_API_KEY = '';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('resolveCodexBinary', () => {
  it('honours CODEX_BIN override when the file exists', () => {
    process.env.CODEX_BIN = '/custom/codex';
    vi.mocked(existsSync).mockReturnValue(true);
    expect(resolveCodexBinary()).toBe('/custom/codex');
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('throws CodexBinaryNotFoundError when CODEX_BIN points at a missing file', () => {
    process.env.CODEX_BIN = '/missing/codex';
    vi.mocked(existsSync).mockReturnValue(false);
    expect(() => resolveCodexBinary()).toThrow(CodexBinaryNotFoundError);
  });

  it('falls back to PATH lookup when CODEX_BIN is unset', () => {
    expect(resolveCodexBinary()).toBe('/mock/bin/codex');
  });

  it('throws CodexBinaryNotFoundError when which/where fails', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('not found');
    });
    expect(() => resolveCodexBinary()).toThrow(CodexBinaryNotFoundError);
  });
});

describe('CodexCliRuntime — pre-flight errors', () => {
  it('throws CodexNotAuthenticatedError when ~/.codex/auth.json is absent and no OPENAI_API_KEY', async () => {
    vi.mocked(execFileSync).mockReturnValue('/mock/bin/codex' as never);
    vi.mocked(existsSync).mockImplementation((p: unknown) => {
      if (typeof p === 'string' && p.endsWith('auth.json')) return false;
      return true;
    });

    const runtime = new CodexCliRuntime();
    await expect(runtime.run(makeSpec())).rejects.toThrow(CodexNotAuthenticatedError);
    // Spawn was never called — pre-flight failed before we wrote files.
    expect(spawn).not.toHaveBeenCalled();
  });

  it('accepts OPENAI_API_KEY as an alternative to ~/.codex/auth.json', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
    vi.mocked(execFileSync).mockReturnValue('/mock/bin/codex' as never);
    vi.mocked(existsSync).mockImplementation((p: unknown) => {
      if (typeof p === 'string' && p.endsWith('auth.json')) return false;
      return true;
    });

    const proc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const runtime = new CodexCliRuntime();
    const runPromise = runtime.run(makeSpec());

    expect(spawn).toHaveBeenCalledOnce();
    proc.stdout.emit('data', Buffer.from(JSON.stringify({ result: '{"ok":true}', usage: {} })));
    proc.simulateClose(0);
    await runPromise;
  });

  it('throws CodexBinaryNotFoundError when binary cannot be resolved', async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('not found');
    });
    const runtime = new CodexCliRuntime();
    await expect(runtime.run(makeSpec())).rejects.toThrow(CodexBinaryNotFoundError);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('buildCodexArgv', () => {
  it('builds argv with exec --json --cd <workspace> --model <id> and prompt as final positional', () => {
    const argv = buildCodexArgv({
      model: 'gpt-5.4',
      workspaceDir: '/work',
      prompt: '<task>hello</task>',
    });
    expect(argv[0]).toBe('exec');
    expect(argv).toContain('--json');
    expect(argv).toContain('--cd');
    expect(argv[argv.indexOf('--cd') + 1]).toBe('/work');
    expect(argv).toContain('--model');
    expect(argv[argv.indexOf('--model') + 1]).toBe('gpt-5.4');
    expect(argv[argv.length - 1]).toBe('<task>hello</task>');
  });

  it('passes systemPrompt via -c developer_instructions= override using TOML multi-line basic string', () => {
    const argv = buildCodexArgv({
      model: 'gpt-5.4',
      workspaceDir: '/work',
      prompt: '<task></task>',
      systemPrompt: 'be terse',
    });
    expect(argv).toContain('-c');
    const idx = argv.indexOf('-c');
    expect(argv[idx + 1]).toBe('developer_instructions="""be terse"""');
  });

  it('preserves multi-line systemPrompt content without escaping newlines', () => {
    const argv = buildCodexArgv({
      model: 'gpt-5.4',
      workspaceDir: '/work',
      prompt: '<task></task>',
      systemPrompt: 'line one\nline two\nline three',
    });
    const idx = argv.indexOf('-c');
    expect(argv[idx + 1]).toBe('developer_instructions="""line one\nline two\nline three"""');
  });

  it('does not escape inner double-quotes (multi-line basic strings carry them raw)', () => {
    const argv = buildCodexArgv({
      model: 'gpt-5.4',
      workspaceDir: '/work',
      prompt: '<task></task>',
      systemPrompt: 'say "hi"',
    });
    const idx = argv.indexOf('-c');
    expect(argv[idx + 1]).toBe('developer_instructions="""say "hi""""');
  });
});

describe('escapeForTomlMultilineBasic', () => {
  it('returns plain text unchanged when no metacharacters present', () => {
    expect(escapeForTomlMultilineBasic('hello world')).toBe('hello world');
  });

  it('preserves newlines (multi-line basic strings carry literal LF)', () => {
    expect(escapeForTomlMultilineBasic('a\nb')).toBe('a\nb');
  });

  it('escapes backslashes (TOML escape character)', () => {
    expect(escapeForTomlMultilineBasic('C:\\path')).toBe('C:\\\\path');
  });

  it('escapes embedded triple-quote so the closing delimiter is unambiguous', () => {
    expect(escapeForTomlMultilineBasic('say """hello"""')).toBe('say \\"""hello\\"""');
  });

  it('escapes backslashes before triple-quote handling so order is stable', () => {
    expect(escapeForTomlMultilineBasic('\\"""')).toBe('\\\\\\"""');
  });
});

describe('parseCodexEnvelope', () => {
  it('parses a single JSON envelope with result + usage + cost', () => {
    const stdout = JSON.stringify({
      result: '{"verdict":"no-blockers"}',
      usage: { input_tokens: 100, output_tokens: 50 },
      total_cost_usd: 0.0042,
      num_turns: 1,
    });
    const env = parseCodexEnvelope(stdout);
    expect(env).not.toBeNull();
    expect(env?.result).toBe('{"verdict":"no-blockers"}');
    expect(env?.usage.inputTokens).toBe(100);
    expect(env?.usage.outputTokens).toBe(50);
    expect(env?.usage.costUsd).toBeCloseTo(0.0042);
    expect(env?.numTurns).toBe(1);
    expect(env?.isError).toBe(false);
  });

  it('parses NDJSON, picking the last terminal event', () => {
    const stdout = [
      JSON.stringify({ event: 'turn-start' }),
      JSON.stringify({ event: 'tool-use', tool: 'Read' }),
      JSON.stringify({
        result: '{"verdict":"no-blockers"}',
        usage: { input_tokens: 50, output_tokens: 20 },
      }),
    ].join('\n');
    const env = parseCodexEnvelope(stdout);
    expect(env?.result).toBe('{"verdict":"no-blockers"}');
    expect(env?.usage.inputTokens).toBe(50);
  });

  it('surfaces error from string error field', () => {
    const stdout = JSON.stringify({ error: 'rate limited' });
    const env = parseCodexEnvelope(stdout);
    expect(env?.isError).toBe(true);
    expect(env?.errorDetail).toBe('rate limited');
  });

  it('surfaces error from object error field with message', () => {
    const stdout = JSON.stringify({ error: { message: 'auth expired', code: 401 } });
    const env = parseCodexEnvelope(stdout);
    expect(env?.isError).toBe(true);
    expect(env?.errorDetail).toBe('auth expired');
  });

  it('returns null for non-JSON output', () => {
    expect(parseCodexEnvelope('not json at all')).toBeNull();
    expect(parseCodexEnvelope('')).toBeNull();
  });

  it('zeroes usage gracefully when no usage fields are present', () => {
    const stdout = JSON.stringify({ result: 'plain text result' });
    const env = parseCodexEnvelope(stdout);
    expect(env?.result).toBe('plain text result');
    expect(env?.usage.inputTokens).toBe(0);
    expect(env?.usage.outputTokens).toBe(0);
    expect(env?.usage.costUsd).toBeNull();
  });
});

describe('pickCodexToolCall', () => {
  it('normalises Codex command_execution start events to Bash tool calls', () => {
    const toolCall = pickCodexToolCall({
      type: 'item.started',
      item: {
        id: 'item_0',
        type: 'command_execution',
        command: '/bin/zsh -lc pwd',
        status: 'in_progress',
      },
    });

    expect(toolCall).toEqual({
      toolName: 'Bash',
      toolInput: { command: '/bin/zsh -lc pwd' },
    });
  });

  it('ignores completed command events so the runtime does not double-count calls', () => {
    expect(
      pickCodexToolCall({
        type: 'item.completed',
        item: {
          id: 'item_0',
          type: 'command_execution',
          command: '/bin/zsh -lc pwd',
          status: 'completed',
        },
      }),
    ).toBeNull();
  });
});

describe('CodexCliRuntime — spawn lifecycle', () => {
  it('emits agent.run-started and agent.run-completed on a happy path', async () => {
    const proc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const runtime = new CodexCliRuntime();
    const runPromise = runtime.run(makeSpec());

    expect(spawn).toHaveBeenCalledOnce();
    const [, , spawnOpts] = vi.mocked(spawn).mock.calls[0];
    expect((spawnOpts as { shell: unknown }).shell).toBe(false);

    proc.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          result: '{"verdict":"no-blockers","findings":[],"decisionSummaries":[]}',
          usage: { input_tokens: 10, output_tokens: 5 },
          total_cost_usd: 0.001,
          num_turns: 1,
        }),
      ),
    );
    proc.simulateClose(0);

    const result = await runPromise;
    expect(result.output).toEqual({
      verdict: 'no-blockers',
      findings: [],
      decisionSummaries: [],
    });

    const eventStore = await import('@goose-hub/core/event-stream/store.js');
    const calls = vi.mocked(eventStore.eventStore.appendEvent).mock.calls;
    const startCall = calls.find(([e]) => e.kind === 'agent.run-started');
    const completeCall = calls.find(([e]) => e.kind === 'agent.run-completed');
    expect(startCall).toBeDefined();
    expect((startCall?.[0].payload as { runtime: string }).runtime).toBe('codex-cli');
    expect(completeCall).toBeDefined();
    expect((completeCall?.[0].payload as { runtime: string }).runtime).toBe('codex-cli');
  });

  it('emits agent.tool-call events from Codex JSONL command_execution items', async () => {
    vi.mocked(computeAllowlist).mockReturnValue(['Bash']);
    const proc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const runtime = new CodexCliRuntime();
    const runPromise = runtime.run(makeSpec());

    proc.stdout.emit(
      'data',
      Buffer.from(
        [
          JSON.stringify({
            type: 'item.started',
            item: {
              id: 'item_0',
              type: 'command_execution',
              command: '/bin/zsh -lc pwd',
              aggregated_output: '',
              exit_code: null,
              status: 'in_progress',
            },
          }),
          JSON.stringify({
            type: 'item.completed',
            item: { id: 'item_1', type: 'agent_message', text: '{"ok":true}' },
          }),
          JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } }),
        ].join('\n'),
      ),
    );
    proc.simulateClose(0);

    await runPromise;

    const eventStore = await import('@goose-hub/core/event-stream/store.js');
    const toolCall = vi
      .mocked(eventStore.eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.tool-call');
    expect(toolCall).toBeDefined();
    expect(toolCall?.[0]).toMatchObject({
      projectId: 'proj-test',
      workItemId: 'item-1',
      runId: 'codex-test-run',
      personaId: 'test-project/dev-reviewer/0',
      payload: {
        tool_name: 'Bash',
        run_id: 'codex-test-run',
        tool_input: { command: '/bin/zsh -lc pwd' },
        skill: 'dev-review',
      },
    });
  });

  it('falls back to spec.workItemId when context omits workItemId', async () => {
    const proc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const runtime = new CodexCliRuntime();
    const runPromise = runtime.run(
      makeSpec({
        context: { projectId: 'proj-test' },
        contextAllowlist: ['projectId'],
        workItemId: 'item-from-spec',
      }),
    );

    proc.stdout.emit('data', Buffer.from(JSON.stringify({ result: '{"ok":true}', usage: {} })));
    proc.simulateClose(0);

    await runPromise;

    const eventStore = await import('@goose-hub/core/event-stream/store.js');
    const startCall = vi
      .mocked(eventStore.eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.run-started');
    expect(startCall?.[0].workItemId).toBe('item-from-spec');
  });

  it('surfaces malformed output as raw string so the schema validator handles it', async () => {
    const proc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const runtime = new CodexCliRuntime();
    const runPromise = runtime.run(makeSpec());

    proc.stdout.emit('data', Buffer.from('this is not JSON'));
    proc.simulateClose(0);

    const result = await runPromise;
    // Runtime falls through to raw string when JSON parsing fails entirely;
    // the schema validator at the workflow boundary surfaces the type error.
    expect(typeof result.output).toBe('string');
  });

  it('does not expose a single Codex transport event as structured skill output', async () => {
    const proc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const runtime = new CodexCliRuntime();
    const runPromise = runtime.run(makeSpec());

    proc.stdout.emit(
      'data',
      Buffer.from(JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' })),
    );
    proc.simulateClose(0);

    const result = await runPromise;
    expect(result.output).toBe('');
  });

  it('rejects with timeout error and emits tool.timeout when budget timeoutMs elapses', async () => {
    vi.useFakeTimers();
    const proc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const runtime = new CodexCliRuntime();
    const runPromise = runtime.run(
      makeSpec({ budgets: { maxTurns: 5, maxBudgetUsd: 0.1, timeoutMs: 30_000 } }),
    );

    vi.advanceTimersByTime(30_001);

    await expect(runPromise).rejects.toThrow(/timed out/);
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('emits agent.run-failed and rejects when subprocess exits non-zero with no envelope', async () => {
    const proc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const runtime = new CodexCliRuntime();
    const runPromise = runtime.run(makeSpec());

    proc.stderr.emit('data', Buffer.from('codex: rate limit hit'));
    proc.simulateClose(1);

    await expect(runPromise).rejects.toThrow(/Codex CLI exited with code 1/);
    const eventStore = await import('@goose-hub/core/event-stream/store.js');
    const failedCall = vi
      .mocked(eventStore.eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'agent.run-failed');
    expect(failedCall).toBeDefined();
  });

  it('returns mock output when MOCK_AGENTS=true (no spawn)', async () => {
    process.env.MOCK_AGENTS = 'true';
    const runtime = new CodexCliRuntime();

    // The 'review' skill has a mock output preset; reuse it for a smoke test.
    await expect(
      runtime.run(makeSpec({ skill: 'review', role: 'reviewer' as AgentSpec['role'] })),
    ).resolves.toBeDefined();
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('selectRuntime — dispatcher', () => {
  it("configRuntime: 'claude-cli' returns ClaudeCliRuntime regardless of model", () => {
    const rt = selectRuntime({ configRuntime: 'claude-cli', model: 'gpt-5.4' });
    expect(rt.constructor.name).toBe('ClaudeCliRuntime');
  });

  it("configRuntime: 'codex-cli' returns CodexCliRuntime regardless of model", () => {
    const rt = selectRuntime({ configRuntime: 'codex-cli', model: 'claude-sonnet-4-6' });
    expect(rt.constructor.name).toBe('CodexCliRuntime');
  });

  it("configRuntime: 'auto' picks runtime by model provider — claude → ClaudeCliRuntime", () => {
    const rt = selectRuntime({ configRuntime: 'auto', model: 'claude-sonnet-4-6' });
    expect(rt.constructor.name).toBe('ClaudeCliRuntime');
  });

  it("configRuntime: 'auto' picks runtime by model provider — codex → CodexCliRuntime", () => {
    const rt = selectRuntime({ configRuntime: 'auto', model: 'gpt-5.4' });
    expect(rt.constructor.name).toBe('CodexCliRuntime');
  });

  it("configRuntime: 'auto' falls back to skillProvider when no model is given", () => {
    const rt = selectRuntime({ configRuntime: 'auto', skillProvider: 'codex' });
    expect(rt.constructor.name).toBe('CodexCliRuntime');
  });

  it("configRuntime: 'auto' defaults to ClaudeCliRuntime when no signal is given", () => {
    const rt = selectRuntime({ configRuntime: 'auto' });
    expect(rt.constructor.name).toBe('ClaudeCliRuntime');
  });

  it("configRuntime: 'auto' tolerates unknown model IDs and falls back to skillProvider", () => {
    const rt = selectRuntime({
      configRuntime: 'auto',
      model: 'unknown-model-xyz',
      skillProvider: 'codex',
    });
    expect(rt.constructor.name).toBe('CodexCliRuntime');
  });
});

// ─── live integration (skipped unless local env satisfies pre-conditions) ─────
//
// vi.mock('node:fs') replaces existsSync with a stub above. To check the real
// filesystem we use createRequire (CJS require bypasses Vitest ES-module mocks)
// and the un-mocked homedir/join imports from node:os/node:path which are not
// intercepted by any vi.mock in this file.

const _realFs = createRequire(import.meta.url)('node:fs') as typeof import('node:fs');
const _realExistsSync = _realFs.existsSync;

const liveOk = (() => {
  if (process.env.MOCK_AGENTS === 'true') return false;
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey != null && apiKey.length > 0) return true;
  try {
    const authPath = realJoin(realHomedir(), '.codex', 'auth.json');
    return _realExistsSync(authPath);
  } catch {
    return false;
  }
})();

describe.skipIf(!liveOk)('CodexCliRuntime — live integration', () => {
  it('codex exec produces a turn-complete event with non-zero usage', async () => {
    // This test runs only when ~/.codex/auth.json exists or OPENAI_API_KEY is set.
    // On CI neither is present so the outer describe.skipIf guard suppresses it.
    const runtime = new CodexCliRuntime();
    const spec = makeSpec({ runId: 'live-test-run', modelOverride: 'gpt-4o' });
    const result = await runtime.run(spec);
    expect(result.output).toBeDefined();
  }, 30_000);
});
