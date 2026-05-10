import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { eventStore } from '../event-stream/store.js';
import { ClaudeCliRuntime, resolveMcpConfigPath } from './claude-cli.js';
import { assembleSpawnContext } from './context-assembly.js';
import { withFallback } from './fallback.js';
import { HoldoutFallbackForbiddenError } from './interface.js';
import type { AgentResult, AgentRuntime, AgentSpec, DecisionSummary } from './interface.js';
import {
  MODELS,
  type ModelEntry,
  type ModelTier,
  defaultModelForTier,
  modelsAtOrAboveTier,
  tierOf,
} from './models.js';
import { OutputValidationError, validateOutput } from './output-validator.js';
import { toJsonSchema } from './schema-bridge.js';
import {
  AgentSpawnTimeoutError,
  DEFAULT_TIMEOUTS,
  HookExecTimeoutError,
  LifecycleTimeoutError,
  ToolCallTimeoutError,
  WorktreeCreateTimeoutError,
  withTimeout,
} from './with-timeout.js';

// ─── module mocks (hoisted by vitest) ────────────────────────────────────────
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn().mockReturnValue('/mock/bin/claude'),
  spawn: vi.fn(),
}));
vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
}));
vi.mock('node:os', () => ({ homedir: vi.fn().mockReturnValue('/mock-home') }));
vi.mock('../event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi
      .fn()
      .mockReturnValue({ id: 1, kind: 'agent.run-started', payload: {}, createdAt: '' }),
    replay: vi.fn().mockReturnValue([]),
  },
}));
vi.mock('../tool-layer/allowlist.js', () => ({ computeAllowlist: vi.fn().mockReturnValue([]) }));
vi.mock('../tool-layer/pre-tool-use-hook.js', () => ({ deployHooks: vi.fn() }));
vi.mock('../tool-layer/sandbox.js', () => ({ writeWorkspaceSandbox: vi.fn() }));
// Stub the cost recorder so it doesn't pull `core/db/db.ts` (which would need
// node:fs / node:os to be fully mocked).
vi.mock('../cost/repository.js', () => ({ recordCost: vi.fn() }));

// ─── interface types ──────────────────────────────────────────────────────────

describe('interface types', () => {
  it('DecisionSummary has kind, summary, and optional evidence', () => {
    const full: DecisionSummary = {
      kind: 'READ',
      summary: 'Found 3 results',
      evidence: 'grep output',
    };
    const minimal: DecisionSummary = { kind: 'READ', summary: 'Found 3 results' };
    expect(full.kind).toBe('READ');
    expect(minimal.evidence).toBeUndefined();
  });

  it('AgentSpec runId is required with string type', () => {
    const spec: AgentSpec = {
      runId: '01HZQKG8APXV3TYS2EW4VR6MSB',
      role: 'developer',
      skill: 'echo-test',
      context: { message: 'hello' },
      contextAllowlist: ['message'],
      freshContext: false,
      toolBundles: ['read-only'],
      toolExtras: [],
      budgets: { maxTurns: 10, maxBudgetUsd: 1.0, timeoutMs: 30_000 },
      personaId: 'test-project/developer/0',
    };
    expect(spec.runId).toBe('01HZQKG8APXV3TYS2EW4VR6MSB');
  });

  it('AgentSpec modelOverride is optional', () => {
    const spec: AgentSpec = {
      runId: 'test-run-1',
      role: 'developer',
      skill: 'echo-test',
      context: {},
      contextAllowlist: [],
      freshContext: false,
      toolBundles: [],
      toolExtras: [],
      budgets: { maxTurns: 5, maxBudgetUsd: 0.5, timeoutMs: 30_000 },
      personaId: 'test-project/developer/0',
    };
    expect(spec.modelOverride).toBeUndefined();
  });

  it('AgentRuntime interface is structurally satisfied', () => {
    const mockRuntime: AgentRuntime = {
      run: async (_spec: AgentSpec): Promise<AgentResult> => ({
        output: { echo: 'hello' },
        decisionSummaries: [{ kind: 'PLAN', summary: 'Echoed input message' }],
        events: [],
      }),
    };
    expect(typeof mockRuntime.run).toBe('function');
  });
});

// ─── models registry ──────────────────────────────────────────────────────────

describe('models registry', () => {
  it('contains the three current Claude model IDs', () => {
    const ids = MODELS.map((m) => m.id);
    expect(ids).toContain('claude-opus-4-7');
    expect(ids).toContain('claude-sonnet-4-6');
    expect(ids).toContain('claude-haiku-4-5-20251001');
    const claudeCount = MODELS.filter((m) => (m.provider ?? 'claude') === 'claude').length;
    expect(claudeCount).toBe(3);
  });

  it('contains the Codex model IDs registered for M19.10', () => {
    const codex = MODELS.filter((m) => m.provider === 'codex');
    const ids = codex.map((m) => m.id);
    expect(ids).toContain('gpt-5-codex');
    expect(ids).toContain('gpt-5-codex-mini');
    expect(codex.find((m) => m.id === 'gpt-5-codex')?.tier).toBe('sonnet');
    expect(codex.find((m) => m.id === 'gpt-5-codex-mini')?.tier).toBe('haiku');
  });

  it('each model has a valid tier', () => {
    const validTiers: ModelTier[] = ['opus', 'sonnet', 'haiku'];
    for (const m of MODELS) {
      expect(validTiers).toContain(m.tier);
    }
  });

  it('no models are deprecated by default', () => {
    for (const m of MODELS) {
      expect(m.deprecated).toBeFalsy();
    }
  });

  describe('defaultModelForTier', () => {
    it('returns claude-opus-4-7 for opus', () => {
      expect(defaultModelForTier('opus')).toBe('claude-opus-4-7');
    });

    it('returns claude-sonnet-4-6 for sonnet', () => {
      expect(defaultModelForTier('sonnet')).toBe('claude-sonnet-4-6');
    });

    it('returns claude-haiku-4-5-20251001 for haiku', () => {
      expect(defaultModelForTier('haiku')).toBe('claude-haiku-4-5-20251001');
    });
  });

  describe('tierOf', () => {
    it('returns opus for claude-opus-4-7', () => {
      expect(tierOf('claude-opus-4-7')).toBe('opus');
    });

    it('returns sonnet for claude-sonnet-4-6', () => {
      expect(tierOf('claude-sonnet-4-6')).toBe('sonnet');
    });

    it('returns haiku for claude-haiku-4-5-20251001', () => {
      expect(tierOf('claude-haiku-4-5-20251001')).toBe('haiku');
    });

    it('throws for an unknown model ID', () => {
      expect(() => tierOf('unknown-model-xyz')).toThrow('Unknown model ID: unknown-model-xyz');
    });
  });

  describe('modelsAtOrAboveTier', () => {
    it('defaults to claude provider and returns all three Claude models when tier is haiku', () => {
      const result = modelsAtOrAboveTier('haiku');
      expect(result).toHaveLength(3);
      expect(result.every((m) => (m.provider ?? 'claude') === 'claude')).toBe(true);
      const tiers = result.map((m) => m.tier);
      expect(tiers).toContain('haiku');
      expect(tiers).toContain('sonnet');
      expect(tiers).toContain('opus');
    });

    it('returns Claude sonnet and opus when tier is sonnet', () => {
      const result = modelsAtOrAboveTier('sonnet');
      expect(result).toHaveLength(2);
      const tiers = result.map((m) => m.tier);
      expect(tiers).toContain('sonnet');
      expect(tiers).toContain('opus');
      expect(tiers).not.toContain('haiku');
    });

    it('returns Codex models when provider=codex is requested', () => {
      const result = modelsAtOrAboveTier('haiku', 'codex');
      expect(result.every((m) => m.provider === 'codex')).toBe(true);
      const ids = result.map((m) => m.id);
      expect(ids).toContain('gpt-5-codex');
      expect(ids).toContain('gpt-5-codex-mini');
    });

    it('returns only opus when tier is opus', () => {
      const result = modelsAtOrAboveTier('opus');
      expect(result).toHaveLength(1);
      expect(result[0].tier).toBe('opus');
    });

    it('excludes deprecated models', () => {
      const result = modelsAtOrAboveTier('opus');
      expect(result.every((m) => !m.deprecated)).toBe(true);
      // suppress unused variable warning
      const _withDeprecated: ModelEntry[] = [
        ...MODELS,
        { id: 'old', tier: 'opus', deprecated: true },
      ];
      void _withDeprecated;
    });
  });
});

// ─── context assembly ─────────────────────────────────────────────────────────

describe('assembleSpawnContext', () => {
  const makeSpec = (overrides: Partial<AgentSpec> = {}): AgentSpec => ({
    runId: 'test-run',
    role: 'developer',
    skill: 'echo-test',
    context: { message: 'hello', secret: 'tok_abc' },
    contextAllowlist: ['message'],
    freshContext: false,
    toolBundles: [],
    toolExtras: [],
    budgets: { maxTurns: 5, maxBudgetUsd: 0.1, timeoutMs: 30_000 },
    personaId: 'test-project/developer/0',
    ...overrides,
  });

  it('includes allowlisted key in XML output', () => {
    const { contextXml } = assembleSpawnContext(makeSpec());
    expect(contextXml).toContain('message');
    expect(contextXml).toContain('hello');
  });

  it('excludes non-allowlisted key from XML output', () => {
    const { contextXml } = assembleSpawnContext(makeSpec());
    expect(contextXml).not.toContain('secret');
    expect(contextXml).not.toContain('tok_abc');
  });

  it('freshContext: true produces same output (no ambient injection at M4)', () => {
    const fresh = assembleSpawnContext(makeSpec({ freshContext: true }));
    const nonfresh = assembleSpawnContext(makeSpec({ freshContext: false }));
    expect(fresh.contextXml).toBe(nonfresh.contextXml);
  });

  it('escapes XML special chars in context values', () => {
    const spec = makeSpec({
      context: { note: '<b>bold</b> & "quoted"' },
      contextAllowlist: ['note'],
    });
    const { contextXml } = assembleSpawnContext(spec);
    expect(contextXml).not.toContain('<b>');
    expect(contextXml).toContain('&lt;b&gt;');
    expect(contextXml).toContain('&amp;');
  });

  it('renders empty task element when allowlist excludes all keys', () => {
    const spec = makeSpec({ contextAllowlist: [] });
    const { contextXml } = assembleSpawnContext(spec);
    expect(contextXml).toBe('<task></task>');
  });
});

// ─── holdout enforcement (tool.violation events) ──────────────────────────────

describe('assembleSpawnContext — holdout enforcement', () => {
  const makeHoldoutSpec = (overrides: Partial<AgentSpec> = {}): AgentSpec => ({
    runId: 'holdout-run-01',
    role: 'qa',
    skill: 'qa-test',
    context: {
      projectId: 'proj-abc',
      workItemId: 'item-42',
      message: 'allowed',
      secret: 'tok_injected',
      implementationReasoning: 'should not pass through',
    },
    contextAllowlist: ['message'],
    freshContext: true,
    toolBundles: [],
    toolExtras: [],
    budgets: { maxTurns: 5, maxBudgetUsd: 0.1, timeoutMs: 30_000 },
    personaId: 'proj-abc/qa/0',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disallowed keys are absent from the rendered XML', () => {
    const { contextXml } = assembleSpawnContext(makeHoldoutSpec());
    expect(contextXml).not.toContain('secret');
    expect(contextXml).not.toContain('tok_injected');
    expect(contextXml).not.toContain('implementationReasoning');
  });

  it('allowed keys remain in the rendered XML', () => {
    const { contextXml } = assembleSpawnContext(makeHoldoutSpec());
    expect(contextXml).toContain('message');
    expect(contextXml).toContain('allowed');
  });

  it('emits tool.violation for each disallowed key on a qa holdout role', () => {
    assembleSpawnContext(makeHoldoutSpec());
    const violations = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.filter(([e]) => e.kind === 'tool.violation');
    // 'secret' and 'implementationReasoning' are disallowed; projectId/workItemId are system keys
    expect(violations).toHaveLength(2);
    const keys = violations.map(([e]) => (e.payload as { disallowedKey: string }).disallowedKey);
    expect(keys).toContain('secret');
    expect(keys).toContain('implementationReasoning');
  });

  it('emits tool.violation with correct role and runId in payload', () => {
    assembleSpawnContext(makeHoldoutSpec());
    const violations = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.filter(([e]) => e.kind === 'tool.violation');
    for (const [e] of violations) {
      const payload = e.payload as { role: string; runId: string };
      expect(payload.role).toBe('qa');
      expect(payload.runId).toBe('holdout-run-01');
    }
  });

  it('emits tool.violation on reviewer role too', () => {
    assembleSpawnContext(makeHoldoutSpec({ role: 'reviewer' }));
    const violations = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.filter(([e]) => e.kind === 'tool.violation');
    expect(violations.length).toBeGreaterThan(0);
    const [e] = violations[0];
    expect((e.payload as { role: string }).role).toBe('reviewer');
  });

  it('does NOT emit tool.violation for a non-holdout (developer) role', () => {
    assembleSpawnContext(makeHoldoutSpec({ role: 'developer' }));
    const violations = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.filter(([e]) => e.kind === 'tool.violation');
    expect(violations).toHaveLength(0);
  });

  it('does NOT flag system keys (projectId, workItemId) as violations', () => {
    assembleSpawnContext(makeHoldoutSpec());
    const violations = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.filter(([e]) => e.kind === 'tool.violation');
    const keys = violations.map(([e]) => (e.payload as { disallowedKey: string }).disallowedKey);
    expect(keys).not.toContain('projectId');
    expect(keys).not.toContain('workItemId');
  });

  it('emits no violations when all non-system keys are allowlisted', () => {
    const spec = makeHoldoutSpec({
      context: { projectId: 'proj-abc', workItemId: 'item-42', message: 'allowed' },
      contextAllowlist: ['message'],
    });
    assembleSpawnContext(spec);
    const violations = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.filter(([e]) => e.kind === 'tool.violation');
    expect(violations).toHaveLength(0);
  });
});

// ─── output validator ─────────────────────────────────────────────────────────

describe('validateOutput', () => {
  const EchoSchema = z.object({
    echo: z.string(),
    decisionSummaries: z.array(z.object({ kind: z.string(), summary: z.string() })).min(1),
  });

  it('returns typed output for valid JSON matching schema', () => {
    const raw = JSON.stringify({
      echo: 'hello',
      decisionSummaries: [{ kind: 'PLAN', summary: 'b' }],
    });
    const result = validateOutput(raw, EchoSchema);
    expect(result.echo).toBe('hello');
    expect(result.decisionSummaries).toHaveLength(1);
  });

  it('throws OutputValidationError for invalid JSON', () => {
    expect(() => validateOutput('not-json', EchoSchema)).toThrow(OutputValidationError);
    expect(() => validateOutput('not-json', EchoSchema)).toThrow(/Invalid JSON/);
  });

  it('throws OutputValidationError when JSON does not match schema', () => {
    const raw = JSON.stringify({ echo: 'hi' }); // missing decisionSummaries
    expect(() => validateOutput(raw, EchoSchema)).toThrow(OutputValidationError);
  });

  it('throws OutputValidationError when decisionSummaries is empty', () => {
    const raw = JSON.stringify({ echo: 'hi', decisionSummaries: [] });
    expect(() => validateOutput(raw, EchoSchema)).toThrow(OutputValidationError);
  });

  it('OutputValidationError carries received string and errors array', () => {
    try {
      validateOutput('bad', EchoSchema);
    } catch (err) {
      expect(err).toBeInstanceOf(OutputValidationError);
      const e = err as OutputValidationError;
      expect(e.received).toBe('bad');
      expect(Array.isArray(e.errors)).toBe(true);
    }
  });
});

// ─── schema bridge ────────────────────────────────────────────────────────────

describe('toJsonSchema', () => {
  it('converts a simple Zod object schema to JSON Schema', () => {
    const schema = z.object({ echo: z.string() });
    const result = toJsonSchema(schema);
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });

  it('handles discriminated union schema (echo-test shape)', () => {
    const DecisionSummaryZ = z.object({ kind: z.string(), summary: z.string() });
    const EchoOutput = z.object({
      echo: z.string(),
      decisionSummaries: z.array(DecisionSummaryZ).min(1),
    });
    const result = toJsonSchema(EchoOutput);
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });
});

// ─── fallback policy ──────────────────────────────────────────────────────────

describe('withFallback', () => {
  const makeRuntime = (shouldFail = false): AgentRuntime => ({
    run: vi.fn().mockImplementation(async (_spec: AgentSpec): Promise<AgentResult> => {
      if (shouldFail) throw new Error('Model unavailable');
      return { output: { ok: true }, decisionSummaries: [], events: [] };
    }),
  });

  const makeSpec = (overrides: Partial<AgentSpec> = {}): AgentSpec => ({
    runId: 'fb-test',
    role: 'developer',
    skill: 'test',
    context: { priority: 'medium' },
    contextAllowlist: [],
    freshContext: false,
    toolBundles: [],
    toolExtras: [],
    budgets: { maxTurns: 5, maxBudgetUsd: 0.1, timeoutMs: 30_000 },
    personaId: 'test-project/developer/0',
    modelOverride: 'claude-opus-4-7',
    ...overrides,
  });

  it('returns result directly when runtime succeeds', async () => {
    const runtime = makeRuntime(false);
    const wrapped = withFallback(runtime, { allowDownTier: true, maxAttempts: 2 });
    const result = await wrapped.run(makeSpec());
    expect((result.output as { ok: boolean }).ok).toBe(true);
  });

  it('holdout role: does not retry on failure — throws HoldoutFallbackForbiddenError', async () => {
    const runtime = makeRuntime(true);
    const wrapped = withFallback(runtime, { allowDownTier: true, maxAttempts: 2 });
    const qaSpec = makeSpec({ role: 'qa' });
    await expect(wrapped.run(qaSpec)).rejects.toThrow(HoldoutFallbackForbiddenError);
    expect(vi.mocked(runtime.run)).toHaveBeenCalledTimes(1);
  });

  it('critical priority: does not retry on failure', async () => {
    const runtime = makeRuntime(true);
    const wrapped = withFallback(runtime, { allowDownTier: true, maxAttempts: 2 });
    const critSpec = makeSpec({ context: { priority: 'critical' } });
    await expect(wrapped.run(critSpec)).rejects.toThrow('Model unavailable');
    expect(vi.mocked(runtime.run)).toHaveBeenCalledTimes(1);
  });

  it('standard role + non-critical: falls back to lower tier on failure', async () => {
    let attempt = 0;
    const runtime: AgentRuntime = {
      run: vi.fn().mockImplementation(async (spec: AgentSpec): Promise<AgentResult> => {
        attempt++;
        if (attempt === 1) throw new Error('Model unavailable');
        return { output: { model: spec.modelOverride }, decisionSummaries: [], events: [] };
      }),
    };
    const wrapped = withFallback(runtime, { allowDownTier: true, maxAttempts: 2 });
    const result = await wrapped.run(makeSpec());
    expect(vi.mocked(runtime.run)).toHaveBeenCalledTimes(2);
    expect((result.output as { model: string }).model).toBe('claude-sonnet-4-6');
  });

  it('allowDownTier: false — does not retry even for standard roles', async () => {
    const runtime = makeRuntime(true);
    const wrapped = withFallback(runtime, { allowDownTier: false, maxAttempts: 2 });
    await expect(wrapped.run(makeSpec())).rejects.toThrow();
    expect(vi.mocked(runtime.run)).toHaveBeenCalledTimes(1);
  });
});

// ─── ClaudeCliRuntime subprocess security ────────────────────────────────────

interface MockProcess {
  stdout: EventEmitter;
  kill: ReturnType<typeof vi.fn<(signal?: string) => void>>;
  _closeHandlers: Array<(code: number | null) => void>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  simulateClose(code?: number | null): void;
}

function createMockProcess(): MockProcess {
  return {
    stdout: new EventEmitter(),
    kill: vi.fn<(signal?: string) => void>(),
    _closeHandlers: [],
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === 'close') this._closeHandlers.push(handler as (code: number | null) => void);
    },
    simulateClose(code: number | null = 0) {
      for (const h of this._closeHandlers) h(code);
    },
  };
}

function makeSecuritySpec(): AgentSpec {
  return {
    runId: 'sec-test-run-01',
    role: 'developer',
    skill: 'test',
    context: { projectId: 'proj-test', workItemId: 'item-1' },
    contextAllowlist: ['projectId', 'workItemId'],
    freshContext: false,
    toolBundles: [],
    toolExtras: [],
    budgets: { maxTurns: 5, maxBudgetUsd: 0.1, timeoutMs: 30_000 },
    personaId: 'test-project/developer/0',
  };
}

// ─── resolveMcpConfigPath ─────────────────────────────────────────────────────

describe('resolveMcpConfigPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns workspace mcp.json when playwright-mcp bundle is present and file exists', async () => {
    const fs = await import('node:fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const result = resolveMcpConfigPath('/work/dir', ['playwright-mcp']);
    expect(result).toBe(path.join('/work/dir', 'apps/web/.mcp.json'));
  });

  it('falls back to global empty config when bundle file does not exist', async () => {
    const fs = await import('node:fs');
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const result = resolveMcpConfigPath('/work/dir', ['playwright-mcp']);
    expect(result).toBe(path.join('/mock-home', '.factory', 'mcp-config.json'));
  });

  it('falls back to global empty config when no MCP-mapped bundle is present', () => {
    const result = resolveMcpConfigPath('/work/dir', ['read-only', 'validate']);
    expect(result).toBe(path.join('/mock-home', '.factory', 'mcp-config.json'));
  });

  it('returns first matching bundle when multiple are present', async () => {
    const fs = await import('node:fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const result = resolveMcpConfigPath('/work/dir', ['validate', 'playwright-mcp']);
    expect(result).toBe(path.join('/work/dir', 'apps/web/.mcp.json'));
  });
});

describe('ClaudeCliRuntime subprocess security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(spawn).mockReturnValue(undefined as unknown as ReturnType<typeof spawn>);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('spawns with argv array and shell: false (FACTORY_RULES §29)', async () => {
    const proc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const runtime = new ClaudeCliRuntime();
    const runPromise = runtime.run(makeSecuritySpec());

    // spawn is called synchronously inside the Promise constructor
    expect(vi.mocked(spawn)).toHaveBeenCalledOnce();
    const [, spawnArgv, spawnOpts] = vi.mocked(spawn).mock.calls[0];
    expect(Array.isArray(spawnArgv)).toBe(true);
    expect((spawnOpts as { shell: unknown }).shell).toBe(false);

    proc.simulateClose(0);
    await runPromise;
  });

  it('truncates stdout at 4 MB and emits tool.stdout-truncated (FACTORY_RULES §31)', async () => {
    const proc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const runtime = new ClaudeCliRuntime();
    const runPromise = runtime.run(makeSecuritySpec());

    // Fill to exactly 4 MB cap, then emit another chunk to trigger truncation
    proc.stdout.emit('data', Buffer.alloc(4 * 1024 * 1024, 97));
    proc.stdout.emit('data', Buffer.alloc(1024, 98));
    proc.simulateClose(0);

    await runPromise;

    const truncatedCall = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'tool.stdout-truncated');
    expect(truncatedCall).toBeDefined();
  });

  it('kills process and emits tool.timeout after 30 s (FACTORY_RULES §32)', async () => {
    vi.useFakeTimers();
    const proc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const runtime = new ClaudeCliRuntime();
    const runPromise = runtime.run(makeSecuritySpec());

    vi.advanceTimersByTime(30_001);

    await expect(runPromise).rejects.toThrow(/timed out/);

    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
    const timeoutCall = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'tool.timeout');
    expect(timeoutCall).toBeDefined();
  });
});

// ─── withTimeout (#219) ───────────────────────────────────────────────────────

describe('withTimeout', () => {
  it('resolves with the wrapped promise value when it completes in time', async () => {
    vi.useFakeTimers();
    const promise = withTimeout(Promise.resolve('hello'), {
      timeoutMs: 1000,
      errorFactory: () => new ToolCallTimeoutError(1000),
    });
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBe('hello');
    vi.useRealTimers();
  });

  it('rejects with the typed error when the timer wins', async () => {
    vi.useFakeTimers();
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 5000));
    const promise = withTimeout(slow, {
      timeoutMs: 100,
      errorFactory: () => new WorktreeCreateTimeoutError(100, { repo: '/work/repo' }),
    });
    vi.advanceTimersByTime(101);
    await expect(promise).rejects.toBeInstanceOf(WorktreeCreateTimeoutError);
    await expect(promise).rejects.toMatchObject({
      _tag: 'WorktreeCreateTimeout',
      timeoutMs: 100,
      context: { repo: '/work/repo' },
    });
    vi.useRealTimers();
  });

  it('propagates rejection from the wrapped promise (not a timeout)', async () => {
    const failing = Promise.reject(new Error('underlying failure'));
    await expect(
      withTimeout(failing, {
        timeoutMs: 1000,
        errorFactory: () => new ToolCallTimeoutError(1000),
      }),
    ).rejects.toThrow(/underlying failure/);
  });

  it('honours an AbortSignal: abort beats timeout', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 5000));
    const promise = withTimeout(slow, {
      timeoutMs: 1000,
      errorFactory: () => new HookExecTimeoutError(1000),
      signal: controller.signal,
    });
    controller.abort(new Error('explicit abort'));
    await expect(promise).rejects.toThrow(/explicit abort/);
    // Crucially, the rejection is the abort reason, NOT the timeout error.
    await expect(promise).rejects.not.toBeInstanceOf(HookExecTimeoutError);
    vi.useRealTimers();
  });

  it('rejects immediately if the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('pre-aborted'));
    await expect(
      withTimeout(Promise.resolve('x'), {
        timeoutMs: 1000,
        errorFactory: () => new ToolCallTimeoutError(1000),
        signal: controller.signal,
      }),
    ).rejects.toThrow(/pre-aborted/);
  });

  it('does not call errorFactory if the wrapped promise resolves first', async () => {
    const factorySpy = vi.fn(() => new ToolCallTimeoutError(1000));
    await withTimeout(Promise.resolve('done'), {
      timeoutMs: 1000,
      errorFactory: factorySpy,
    });
    expect(factorySpy).not.toHaveBeenCalled();
  });
});

describe('LifecycleTimeoutError variants (#219)', () => {
  it('subclasses share the LifecycleTimeoutError base + carry _tag and context', () => {
    const e1 = new WorktreeCreateTimeoutError(123, { repo: '/work' });
    expect(e1).toBeInstanceOf(LifecycleTimeoutError);
    expect(e1._tag).toBe('WorktreeCreateTimeout');
    expect(e1.timeoutMs).toBe(123);
    expect(e1.context).toEqual({ repo: '/work' });

    const e2 = new HookExecTimeoutError(456);
    expect(e2._tag).toBe('HookExecTimeout');

    const e3 = new AgentSpawnTimeoutError(789, { runId: 'run-1' });
    expect(e3._tag).toBe('AgentSpawnTimeout');

    const e4 = new ToolCallTimeoutError(30_000, { tool: 'bash' });
    expect(e4._tag).toBe('ToolCallTimeout');
  });

  it('exposes the defaults table', () => {
    expect(DEFAULT_TIMEOUTS.WorktreeCreateTimeout).toBe(10_000);
    expect(DEFAULT_TIMEOUTS.HookExecTimeout).toBe(5_000);
    expect(DEFAULT_TIMEOUTS.AgentSpawnTimeout).toBe(60_000);
    expect(DEFAULT_TIMEOUTS.AgentIdleTimeout).toBe(60_000);
    expect(DEFAULT_TIMEOUTS.ToolCallTimeout).toBe(30_000);
  });
});

// ─── adviseOnPlan wrapper (#182) ──────────────────────────────────────────────

vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('# advise-on-plan skill\n\n... mock prompt body ...'),
}));

vi.mock('./select-persona.js', () => ({
  selectPersona: vi
    .fn()
    .mockReturnValue({ personaId: 'proj/researcher/0', codename: 'Grey Honker' }),
}));

describe('adviseOnPlan (#182)', () => {
  const baseInput = {
    runId: 'run-advisor-1',
    projectId: 'proj',
    workItemId: 'github:owner/repo#42',
    workItem: { title: 't', body: 'b', number: 42, priority: 'high' as const },
    plan: '1. Step one. 2. Step two.',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects priorities other than high or critical', async () => {
    const { adviseOnPlan } = await import('./advisor.js');
    await expect(
      adviseOnPlan({
        ...baseInput,
        workItem: { ...baseInput.workItem, priority: 'medium' as unknown as 'high' },
      }),
    ).rejects.toThrow(/only high\/critical are advisor-gated/);
  });

  it('returns the typed advisor verdict and emits one event per decisionSummary', async () => {
    const { adviseOnPlan } = await import('./advisor.js');
    const stubRuntime: AgentRuntime = {
      run: vi.fn().mockResolvedValue({
        output: {
          verdict: 'proceed',
          confidence: 'high',
          decisionSummaries: [
            { kind: 'VERDICT', summary: 'Plan looks sound; no conflicts' },
            { kind: 'STRUCTURAL_CHECK', summary: 'No file collisions in target dir' },
          ],
        },
        decisionSummaries: [],
        events: [],
      }),
    };

    const result = await adviseOnPlan({ ...baseInput, runtime: stubRuntime });
    expect(result.verdict).toBe('proceed');

    const decisionEvents = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.filter(([e]) => e.kind === 'agent.decision-summary');
    expect(decisionEvents).toHaveLength(2);
    for (const [e] of decisionEvents) {
      expect((e.payload as { skill?: string }).skill).toBe('advise-on-plan');
    }
  });

  it('rejects on schema-invalid output and emits agent.run-failed', async () => {
    const { adviseOnPlan } = await import('./advisor.js');
    const stubRuntime: AgentRuntime = {
      run: vi.fn().mockResolvedValue({
        output: { verdict: 'unknown-variant', confidence: 'high' },
        decisionSummaries: [],
        events: [],
      }),
    };

    await expect(adviseOnPlan({ ...baseInput, runtime: stubRuntime })).rejects.toThrow(
      /advise-on-plan output validation failed/,
    );
    const failedEvents = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.filter(([e]) => e.kind === 'agent.run-failed');
    expect(failedEvents).toHaveLength(1);
  });

  it('rejects revise verdict missing required feedback', async () => {
    const { adviseOnPlan } = await import('./advisor.js');
    const stubRuntime: AgentRuntime = {
      run: vi.fn().mockResolvedValue({
        output: {
          verdict: 'revise',
          confidence: 'medium',
          // feedback intentionally missing — schema must reject
          decisionSummaries: [{ kind: 'PLAN', summary: 's' }],
        },
        decisionSummaries: [],
        events: [],
      }),
    };
    await expect(adviseOnPlan({ ...baseInput, runtime: stubRuntime })).rejects.toThrow();
  });

  it('forwards revisionPass + previousAdvisorFeedback into the spec context', async () => {
    const { adviseOnPlan } = await import('./advisor.js');
    const runMock = vi.fn().mockResolvedValue({
      output: {
        verdict: 'proceed',
        confidence: 'high',
        decisionSummaries: [{ kind: 'PLAN', summary: 's' }],
      },
      decisionSummaries: [],
      events: [],
    });
    const stubRuntime: AgentRuntime = { run: runMock };
    await adviseOnPlan({
      ...baseInput,
      revisionPass: 1,
      previousAdvisorFeedback: 'last time I said X',
      runtime: stubRuntime,
    });
    const spec = runMock.mock.calls[0][0] as { context: Record<string, unknown> };
    expect(spec.context.revisionPass).toBe(1);
    expect(spec.context.previousAdvisorFeedback).toBe('last time I said X');
  });
});

// ─── model-router — predictive model selection (#529) ───────────────────────

const { mockRouterDb } = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {} as never;
  for (const m of ['select', 'from', 'where'] as const) {
    (chain as Record<string, unknown>)[m] = vi.fn().mockReturnValue(chain);
  }
  chain.all = vi.fn().mockReturnValue([]);
  // Support insert().values().run() called by ClaudeCliRuntime after each agent run
  chain.insert = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({ run: vi.fn() }),
  });
  return { mockRouterDb: chain };
});

vi.mock('../db/db.js', () => ({ db: mockRouterDb }));
vi.mock('../db/repositories/project-settings.js', () => ({
  readProjectSettings: vi.fn().mockReturnValue(null),
  readProjectSkillSettings: vi.fn().mockReturnValue(new Map()),
}));
vi.mock('../db/schema.js', () => ({
  decisionPatterns: { projectId: 'p', kind: 'k', role: 'r', consistencyScore: 'cs' },
  agentRuns: {},
}));

function makeWorkItem(
  overrides: Partial<{
    type: 'feature' | 'bug' | 'chore' | 'research';
    priority: 'critical' | 'high' | 'medium' | 'low';
    body: string;
  }> = {},
) {
  return {
    id: 'github:owner/repo#42',
    externalId: '42',
    repoRef: 'owner/repo',
    title: 'Test issue',
    body: overrides.body ?? 'Short body',
    type: overrides.type ?? 'feature',
    priority: overrides.priority ?? 'medium',
    mode: 'supervised' as const,
    state: 'factory:dev-ready' as const,
    authorIsOwner: true,
    schedule: 'current' as const,
    exec: 'serial' as const,
    dependsOn: [],
    blocks: [],
    createdAt: new Date(),
  };
}

describe('selectModel (#529)', () => {
  beforeEach(() => {
    mockRouterDb.all.mockReturnValue([]);
    vi.clearAllMocks();
    mockRouterDb.all.mockReturnValue([]);
    for (const m of ['select', 'from', 'where']) {
      mockRouterDb[m].mockReturnValue(mockRouterDb);
    }
  });

  describe('holdout role bypass', () => {
    it('returns null for qa role', async () => {
      const { selectModel } = await import('./model-router.js');
      expect(selectModel({ workItem: makeWorkItem(), role: 'qa', projectId: 'proj' })).toBeNull();
    });

    it('returns null for reviewer role', async () => {
      const { selectModel } = await import('./model-router.js');
      expect(
        selectModel({ workItem: makeWorkItem(), role: 'reviewer', projectId: 'proj' }),
      ).toBeNull();
    });
  });

  describe('static policy — type:bug', () => {
    it('returns haiku for type:bug at medium priority', async () => {
      const { selectModel } = await import('./model-router.js');
      const result = selectModel({
        workItem: makeWorkItem({ type: 'bug', priority: 'medium' }),
        role: 'developer',
        projectId: 'proj',
      });
      expect(result?.tier).toBe('haiku');
      expect(result?.reason).toBe('type-bug');
    });
  });

  describe('static policy — type:chore', () => {
    it('returns haiku for type:chore', async () => {
      const { selectModel } = await import('./model-router.js');
      const result = selectModel({
        workItem: makeWorkItem({ type: 'chore' }),
        role: 'developer',
        projectId: 'proj',
      });
      expect(result?.tier).toBe('haiku');
      expect(result?.reason).toBe('type-chore');
    });
  });

  describe('static policy — priority overrides type', () => {
    it('returns sonnet for priority:high regardless of type', async () => {
      const { selectModel } = await import('./model-router.js');
      const result = selectModel({
        workItem: makeWorkItem({ type: 'bug', priority: 'high' }),
        role: 'developer',
        projectId: 'proj',
      });
      expect(result?.tier).toBe('sonnet');
      expect(result?.reason).toBe('priority-high-or-critical');
    });

    it('returns sonnet for priority:critical', async () => {
      const { selectModel } = await import('./model-router.js');
      const result = selectModel({
        workItem: makeWorkItem({ type: 'chore', priority: 'critical' }),
        role: 'developer',
        projectId: 'proj',
      });
      expect(result?.tier).toBe('sonnet');
      expect(result?.reason).toBe('priority-high-or-critical');
    });
  });

  describe('static policy — type:feature', () => {
    it('returns sonnet with reason "feature" for small feature (< 5 AC, body < 1500)', async () => {
      const { selectModel } = await import('./model-router.js');
      const body = '- [ ] AC one\n- [ ] AC two\nSome description';
      const result = selectModel({
        workItem: makeWorkItem({ type: 'feature', body }),
        role: 'developer',
        projectId: 'proj',
      });
      expect(result?.tier).toBe('sonnet');
      expect(result?.reason).toBe('feature');
    });

    it('returns sonnet with reason "large-feature" when AC count ≥ 5', async () => {
      const { selectModel } = await import('./model-router.js');
      const body = ['- [ ] AC 1', '- [ ] AC 2', '- [ ] AC 3', '- [ ] AC 4', '- [ ] AC 5'].join(
        '\n',
      );
      const result = selectModel({
        workItem: makeWorkItem({ type: 'feature', body }),
        role: 'developer',
        projectId: 'proj',
      });
      expect(result?.tier).toBe('sonnet');
      expect(result?.reason).toBe('large-feature');
    });

    it('returns sonnet with reason "large-feature" when body length ≥ 1500', async () => {
      const { selectModel } = await import('./model-router.js');
      const body = `- [ ] One AC\n${'x'.repeat(1500)}`;
      const result = selectModel({
        workItem: makeWorkItem({ type: 'feature', body }),
        role: 'developer',
        projectId: 'proj',
      });
      expect(result?.tier).toBe('sonnet');
      expect(result?.reason).toBe('large-feature');
    });
  });

  describe('project-level override', () => {
    it('applies role-level override', async () => {
      const { selectModel } = await import('./model-router.js');
      const result = selectModel({
        workItem: makeWorkItem({ type: 'feature' }),
        role: 'developer',
        projectId: 'proj',
        modelRouterConfig: { overrides: { developer: 'opus' } },
      });
      expect(result?.tier).toBe('opus');
      expect(result?.reason).toBe('project-override');
    });

    it('role+type override wins over role-only override', async () => {
      const { selectModel } = await import('./model-router.js');
      const result = selectModel({
        workItem: makeWorkItem({ type: 'bug' }),
        role: 'developer',
        projectId: 'proj',
        modelRouterConfig: {
          overrides: { developer: 'haiku', 'developer+type:bug': 'sonnet' },
        },
      });
      expect(result?.tier).toBe('sonnet');
      expect(result?.reason).toBe('project-override');
    });

    it('role+priority override wins over role-only override', async () => {
      const { selectModel } = await import('./model-router.js');
      const result = selectModel({
        workItem: makeWorkItem({ priority: 'low' }),
        role: 'developer',
        projectId: 'proj',
        modelRouterConfig: {
          overrides: { developer: 'sonnet', 'developer+priority:low': 'haiku' },
        },
      });
      expect(result?.tier).toBe('haiku');
      expect(result?.reason).toBe('project-override');
    });

    it('does not apply override to holdout roles', async () => {
      const { selectModel } = await import('./model-router.js');
      const result = selectModel({
        workItem: makeWorkItem(),
        role: 'qa',
        projectId: 'proj',
        modelRouterConfig: { overrides: { qa: 'opus' } },
      });
      expect(result).toBeNull();
    });
  });

  describe('pattern-informed selection', () => {
    it('uses pattern tier when consistencyScore > 0.7 and pattern is present', async () => {
      const { selectModel } = await import('./model-router.js');
      mockRouterDb.all.mockReturnValue([{ actionSummary: 'opus', consistencyScore: 0.9 }]);
      const result = selectModel({
        workItem: makeWorkItem({ type: 'feature' }),
        role: 'developer',
        projectId: 'proj',
      });
      expect(result?.tier).toBe('opus');
      expect(result?.reason).toBe('pattern-informed');
    });

    it('falls back to static policy when no patterns exist', async () => {
      const { selectModel } = await import('./model-router.js');
      mockRouterDb.all.mockReturnValue([]);
      const result = selectModel({
        workItem: makeWorkItem({ type: 'bug' }),
        role: 'developer',
        projectId: 'proj',
      });
      expect(result?.tier).toBe('haiku');
      expect(result?.reason).toBe('type-bug');
    });

    it('falls back to static policy when pattern tier is unrecognised', async () => {
      const { selectModel } = await import('./model-router.js');
      mockRouterDb.all.mockReturnValue([{ actionSummary: 'unknown-tier', consistencyScore: 0.95 }]);
      const result = selectModel({
        workItem: makeWorkItem({ type: 'bug' }),
        role: 'developer',
        projectId: 'proj',
      });
      expect(result?.tier).toBe('haiku');
      expect(result?.reason).toBe('type-bug');
    });

    it('project-level override takes precedence over patterns', async () => {
      const { selectModel } = await import('./model-router.js');
      mockRouterDb.all.mockReturnValue([{ actionSummary: 'opus', consistencyScore: 0.95 }]);
      const result = selectModel({
        workItem: makeWorkItem(),
        role: 'developer',
        projectId: 'proj',
        modelRouterConfig: { overrides: { developer: 'haiku' } },
      });
      expect(result?.tier).toBe('haiku');
      expect(result?.reason).toBe('project-override');
    });
  });
});
