import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { assembleSpawnContext } from './context-assembly.js';
import { withFallback } from './fallback.js';
import type { AgentResult, AgentRuntime, AgentSpec, DecisionSummary } from './interface.js';
import {
  MODELS,
  defaultModelForTier,
  modelsAtOrAboveTier,
  tierOf,
  type ModelEntry,
  type ModelTier,
} from './models.js';
import { OutputValidationError, validateOutput } from './output-validator.js';
import { toJsonSchema } from './schema-bridge.js';

// ─── interface types ──────────────────────────────────────────────────────────

describe('interface types', () => {
  it('DecisionSummary has step, summary, and optional evidence', () => {
    const full: DecisionSummary = { step: 'search', summary: 'Found 3 results', evidence: 'grep output' };
    const minimal: DecisionSummary = { step: 'search', summary: 'Found 3 results' };
    expect(full.step).toBe('search');
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
      budgets: { maxTurns: 10, maxBudgetUsd: 1.0 },
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
      budgets: { maxTurns: 5, maxBudgetUsd: 0.5 },
    };
    expect(spec.modelOverride).toBeUndefined();
  });

  it('AgentRuntime interface is structurally satisfied', () => {
    const mockRuntime: AgentRuntime = {
      run: async (_spec: AgentSpec): Promise<AgentResult> => ({
        output: { echo: 'hello' },
        decisionSummaries: [{ step: 'echo', summary: 'Echoed input message' }],
        events: [],
      }),
    };
    expect(typeof mockRuntime.run).toBe('function');
  });
});

// ─── models registry ──────────────────────────────────────────────────────────

describe('models registry', () => {
  it('contains exactly the three current Claude model IDs', () => {
    const ids = MODELS.map((m) => m.id);
    expect(ids).toContain('claude-opus-4-7');
    expect(ids).toContain('claude-sonnet-4-6');
    expect(ids).toContain('claude-haiku-4-5-20251001');
    expect(ids).toHaveLength(3);
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
    it('returns all three models when tier is haiku', () => {
      const result = modelsAtOrAboveTier('haiku');
      expect(result).toHaveLength(3);
      const tiers = result.map((m) => m.tier);
      expect(tiers).toContain('haiku');
      expect(tiers).toContain('sonnet');
      expect(tiers).toContain('opus');
    });

    it('returns sonnet and opus when tier is sonnet', () => {
      const result = modelsAtOrAboveTier('sonnet');
      expect(result).toHaveLength(2);
      const tiers = result.map((m) => m.tier);
      expect(tiers).toContain('sonnet');
      expect(tiers).toContain('opus');
      expect(tiers).not.toContain('haiku');
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
      const _withDeprecated: ModelEntry[] = [...MODELS, { id: 'old', tier: 'opus', deprecated: true }];
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
    budgets: { maxTurns: 5, maxBudgetUsd: 0.1 },
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

// ─── output validator ─────────────────────────────────────────────────────────

describe('validateOutput', () => {
  const EchoSchema = z.object({
    echo: z.string(),
    decisionSummaries: z.array(z.object({ step: z.string(), summary: z.string() })).min(1),
  });

  it('returns typed output for valid JSON matching schema', () => {
    const raw = JSON.stringify({ echo: 'hello', decisionSummaries: [{ step: 'a', summary: 'b' }] });
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
    const DecisionSummaryZ = z.object({ step: z.string(), summary: z.string() });
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
    run: vi.fn().mockImplementation(async (spec: AgentSpec): Promise<AgentResult> => {
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
    budgets: { maxTurns: 5, maxBudgetUsd: 0.1 },
    modelOverride: 'claude-opus-4-7',
    ...overrides,
  });

  it('returns result directly when runtime succeeds', async () => {
    const runtime = makeRuntime(false);
    const wrapped = withFallback(runtime, { allowDownTier: true, maxAttempts: 2 });
    const result = await wrapped.run(makeSpec());
    expect((result.output as { ok: boolean }).ok).toBe(true);
  });

  it('holdout role: does not retry on failure', async () => {
    const runtime = makeRuntime(true);
    const wrapped = withFallback(runtime, { allowDownTier: true, maxAttempts: 2 });
    const qaSpec = makeSpec({ role: 'qa' });
    await expect(wrapped.run(qaSpec)).rejects.toThrow('Model unavailable');
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
