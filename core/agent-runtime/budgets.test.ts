import { describe, expect, it } from 'vitest';
import { SKILL_BUDGETS, resolveBudgets, resolveEscalatedBudgets } from './budgets.js';

describe('SKILL_BUDGETS', () => {
  it('covers all expected production skills', () => {
    const expected = [
      'triage',
      'repo-match',
      'bug-enhance',
      'feature-frame',
      'feature-enhance',
      'evidence-post',
      'implement',
      'qa',
      'review',
      'resolve-conflict',
      'investigate',
      'research',
      'playwright-repro',
      'advise-on-plan',
      'spec-author',
      'retrospective-light',
      'retrospective-deep',
    ];
    for (const skill of expected) {
      expect(SKILL_BUDGETS[skill], `missing budget for skill '${skill}'`).toBeDefined();
    }
  });

  it('has positive values for every entry', () => {
    for (const [skill, budget] of Object.entries(SKILL_BUDGETS)) {
      expect(budget.maxTurns, `${skill}.maxTurns`).toBeGreaterThan(0);
      expect(budget.maxBudgetUsd, `${skill}.maxBudgetUsd`).toBeGreaterThan(0);
      expect(budget.timeoutMs, `${skill}.timeoutMs`).toBeGreaterThan(0);
    }
  });

  it('keeps scout-schema bounded enough to force early exit instead of runtime tracing', () => {
    expect(SKILL_BUDGETS['scout-schema']?.maxTurns).toBeLessThanOrEqual(20);
  });
});

describe('resolveBudgets', () => {
  it('returns the default budget for a registered skill', () => {
    const result = resolveBudgets('implement');
    expect(result.budgets.maxTurns).toBe(150);
    expect(result.budgets.maxBudgetUsd).toBe(6.0);
    expect(result.budgets.timeoutMs).toBe(900_000);
    expect(result.modelOverride).toContain('haiku');
  });

  it('caps maxBudgetUsd at perWorkflowMaxUsd', () => {
    const result = resolveBudgets('implement', { perWorkflowMaxUsd: 2 });
    expect(result.budgets.maxBudgetUsd).toBe(2);
    expect(result.budgets.maxTurns).toBe(150);
  });

  it('does not cap when budget is within limit', () => {
    const result = resolveBudgets('triage', { perWorkflowMaxUsd: 10 });
    expect(result.budgets.maxBudgetUsd).toBe(1);
  });

  it('applies per-project skill override', () => {
    const result = resolveBudgets('implement', {
      skillBudgetOverrides: { implement: { maxTurns: 50, maxBudgetUsd: 3 } },
    });
    expect(result.budgets.maxTurns).toBe(50);
    expect(result.budgets.maxBudgetUsd).toBe(3);
    expect(result.budgets.timeoutMs).toBe(900_000);
  });

  it('override partial — unset fields inherit from default', () => {
    const result = resolveBudgets('qa', {
      skillBudgetOverrides: { qa: { maxTurns: 20 } },
    });
    expect(result.budgets.maxTurns).toBe(20);
    expect(result.budgets.maxBudgetUsd).toBe(3.0);
  });

  it('override can change modelTier', () => {
    const result = resolveBudgets('implement', {
      skillBudgetOverrides: { implement: { modelTier: 'opus' } },
    });
    expect(result.modelOverride).toContain('opus');
  });

  it('throws for an unregistered skill with no override', () => {
    expect(() => resolveBudgets('unknown-skill-xyz')).toThrow(
      "no budget registered for skill 'unknown-skill-xyz'",
    );
  });

  it('does not treat a DB row as a fallback registration for an unknown skill', () => {
    expect(() =>
      resolveBudgets('unknown-skill-xyz', undefined, {
        maxTurns: 20,
        maxBudgetUsd: 1,
        timeoutMs: 120_000,
        modelTier: 'sonnet',
      }),
    ).toThrow("no budget registered for skill 'unknown-skill-xyz'");
  });

  it('haiku skills resolve to haiku model IDs', () => {
    for (const skill of [
      'triage',
      'repo-match',
      'feature-enhance',
      'evidence-post',
      'implement',
      'retrospective-light',
    ]) {
      const { modelOverride } = resolveBudgets(skill);
      expect(modelOverride, `${skill} should start on haiku`).toContain('haiku');
    }
  });

  it('opus skills resolve to opus model IDs', () => {
    for (const skill of ['advise-on-plan']) {
      const { modelOverride } = resolveBudgets(skill);
      expect(modelOverride, `${skill} should use opus`).toContain('opus');
    }
  });

  it('sonnet skills resolve to sonnet model IDs', () => {
    for (const skill of [
      'feature-frame',
      'fix-feedback',
      'investigate',
      'research',
      'qa',
      'review',
      'retrospective-deep',
    ]) {
      const { modelOverride } = resolveBudgets(skill);
      expect(modelOverride, `${skill} should use sonnet`).toContain('sonnet');
    }
  });
});

describe('resolveEscalatedBudgets', () => {
  it('returns sonnet budget for implement skill', () => {
    const result = resolveEscalatedBudgets('implement');
    expect(result).not.toBeNull();
    expect(result?.modelOverride).toContain('sonnet');
    expect(result?.budgets.maxBudgetUsd).toBe(15.0);
    // maxTurns/timeoutMs default to base entry
    expect(result?.budgets.maxTurns).toBe(150);
    expect(result?.budgets.timeoutMs).toBe(900_000);
  });

  it('returns null for skills without an escalation policy', () => {
    for (const skill of ['triage', 'repo-match', 'evidence-post', 'qa', 'review']) {
      expect(resolveEscalatedBudgets(skill), `${skill}`).toBeNull();
    }
  });

  it('returns null for unknown skill (no base, no override with escalation)', () => {
    expect(resolveEscalatedBudgets('unknown-skill-xyz')).toBeNull();
  });

  it('caps escalated maxBudgetUsd at perWorkflowMaxUsd', () => {
    const result = resolveEscalatedBudgets('implement', { perWorkflowMaxUsd: 8 });
    expect(result?.budgets.maxBudgetUsd).toBe(8);
  });

  it('caps escalated maxBudgetUsd at perAgentMaxUsd', () => {
    const result = resolveEscalatedBudgets('implement', { perAgentMaxUsd: 6 }, undefined, 6);
    expect(result?.budgets.maxBudgetUsd).toBe(6);
  });

  it('lets DB escalation settings override config and skill defaults', () => {
    const result = resolveEscalatedBudgets(
      'implement',
      {
        skillBudgetOverrides: {
          implement: { escalation: { modelTier: 'sonnet', maxBudgetUsd: 12 } },
        },
      },
      undefined,
      undefined,
      {
        escalationModelTier: 'opus',
        escalationMaxBudgetUsd: 18,
        escalationMaxTurns: 90,
        escalationTimeoutMs: 420_000,
      },
    );

    expect(result?.modelOverride).toContain('opus');
    expect(result?.budgets).toEqual({
      maxTurns: 90,
      maxBudgetUsd: 18,
      timeoutMs: 420_000,
    });
  });

  it('uses the configured skill provider for the escalated model', () => {
    const result = resolveEscalatedBudgets(
      'implement',
      {
        skillBudgetOverrides: {
          implement: { provider: 'codex' },
        },
      },
      undefined,
      undefined,
      {
        modelProvider: 'codex',
        escalationModelTier: 'opus',
        escalationMaxBudgetUsd: 18,
      },
    );

    expect(result?.modelOverride).toBe('gpt-5.5');
  });
});

describe('perAgentMaxUsd cap', () => {
  it('clamps skill budget to perAgentMaxUsd when it exceeds the cap', () => {
    const result = resolveBudgets('implement', { perAgentMaxUsd: 3 });
    expect(result.budgets.maxBudgetUsd).toBe(3);
    expect(result.budgets.maxTurns).toBe(150);
  });

  it('does not clamp when budget is within perAgentMaxUsd', () => {
    const result = resolveBudgets('triage', { perAgentMaxUsd: 10 });
    expect(result.budgets.maxBudgetUsd).toBe(1);
  });

  it('dbPerAgentMaxUsd wins over config perAgentMaxUsd', () => {
    // Config says 10, DB says 2 — DB should win
    const result = resolveBudgets('implement', { perAgentMaxUsd: 10 }, undefined, undefined, 2);
    expect(result.budgets.maxBudgetUsd).toBe(2);
  });

  it('applies lower of perWorkflowMaxUsd and perAgentMaxUsd', () => {
    // perWorkflowMaxUsd=2, perAgentMaxUsd=5 => workflow cap (lower) wins
    const result = resolveBudgets('implement', { perWorkflowMaxUsd: 2, perAgentMaxUsd: 5 });
    expect(result.budgets.maxBudgetUsd).toBe(2);
  });

  it('applies lower of perWorkflowMaxUsd and perAgentMaxUsd (agent lower)', () => {
    // perWorkflowMaxUsd=5, perAgentMaxUsd=2 => agent cap (lower) wins
    const result = resolveBudgets('implement', { perWorkflowMaxUsd: 5, perAgentMaxUsd: 2 });
    expect(result.budgets.maxBudgetUsd).toBe(2);
  });
});
