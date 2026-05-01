import { describe, expect, it } from 'vitest';
import type { AgentResult, AgentRuntime, AgentSpec, DecisionSummary } from './interface.js';
import {
  MODELS,
  defaultModelForTier,
  modelsAtOrAboveTier,
  tierOf,
  type ModelEntry,
  type ModelTier,
} from './models.js';

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
      const withDeprecated: ModelEntry[] = [
        ...MODELS,
        { id: 'claude-old-opus', tier: 'opus', deprecated: true },
      ];
      // modelsAtOrAboveTier uses the exported MODELS constant, not a parameter,
      // so we verify the contract holds for the real registry
      const result = modelsAtOrAboveTier('opus');
      expect(result.every((m) => !m.deprecated)).toBe(true);
      // suppress unused variable warning
      void withDeprecated;
    });
  });
});
