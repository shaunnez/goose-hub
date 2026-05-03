import { describe, expect, it, vi } from 'vitest';
import { HoldoutFallbackForbiddenError, withFallback } from './fallback.js';
import type { AgentRuntime, AgentSpec } from './interface.js';

function makeSpec(role: string, modelOverride?: string): AgentSpec {
  return {
    runId: 'test-run',
    role: role as AgentSpec['role'],
    skill: 'test',
    context: { projectId: 'p', workItemId: 'w' },
    contextAllowlist: ['workItem'],
    freshContext: role === 'qa' || role === 'reviewer',
    toolBundles: [],
    toolExtras: [],
    budgets: { maxTurns: 5, maxBudgetUsd: 0.1 },
    personaId: `p/${role}/0`,
    ...(modelOverride ? { modelOverride } : {}),
  };
}

function makeRuntime(run: AgentRuntime['run']): AgentRuntime {
  return { run };
}

describe('withFallback — holdout enforcement', () => {
  it('throws HoldoutFallbackForbiddenError when qa primary fails', async () => {
    const failingRuntime = makeRuntime(vi.fn().mockRejectedValue(new Error('API error')));
    const wrapped = withFallback(failingRuntime, { allowDownTier: true, maxAttempts: 2 });
    await expect(wrapped.run(makeSpec('qa', 'claude-sonnet-4-6'))).rejects.toThrow(
      HoldoutFallbackForbiddenError,
    );
  });

  it('throws HoldoutFallbackForbiddenError when reviewer primary fails', async () => {
    const failingRuntime = makeRuntime(vi.fn().mockRejectedValue(new Error('Rate limit')));
    const wrapped = withFallback(failingRuntime, { allowDownTier: true, maxAttempts: 2 });
    await expect(wrapped.run(makeSpec('reviewer', 'claude-sonnet-4-6'))).rejects.toThrow(
      HoldoutFallbackForbiddenError,
    );
  });

  it('HoldoutFallbackForbiddenError message mentions the role', async () => {
    const failingRuntime = makeRuntime(vi.fn().mockRejectedValue(new Error('error')));
    const wrapped = withFallback(failingRuntime, { allowDownTier: true, maxAttempts: 2 });
    try {
      await wrapped.run(makeSpec('qa', 'claude-sonnet-4-6'));
    } catch (e) {
      expect(e).toBeInstanceOf(HoldoutFallbackForbiddenError);
      expect((e as Error).message).toContain('qa');
    }
  });

  it('non-holdout role with opus model: falls back to sonnet on error', async () => {
    const failingRuntime = makeRuntime(
      vi
        .fn()
        .mockRejectedValueOnce(new Error('error'))
        .mockResolvedValue({ output: {}, decisionSummaries: [], events: [] }),
    );
    const wrapped = withFallback(failingRuntime, { allowDownTier: true, maxAttempts: 2 });
    const result = await wrapped.run(makeSpec('developer', 'claude-opus-4-7'));
    expect(result).toBeDefined();
    // Second call should use a lower-tier model
    expect(vi.mocked(failingRuntime.run)).toHaveBeenCalledTimes(2);
  });

  it('holdout primary succeeds: returns result normally', async () => {
    const successRuntime = makeRuntime(
      vi.fn().mockResolvedValue({ output: {}, decisionSummaries: [], events: [] }),
    );
    const wrapped = withFallback(successRuntime, { allowDownTier: true, maxAttempts: 2 });
    const result = await wrapped.run(makeSpec('qa', 'claude-sonnet-4-6'));
    expect(result).toBeDefined();
    expect(vi.mocked(successRuntime.run)).toHaveBeenCalledTimes(1);
  });
});
