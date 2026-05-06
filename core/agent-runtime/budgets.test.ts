import { describe, expect, it } from 'vitest';
import { SKILL_BUDGETS, resolveBudgets } from './budgets.js';

describe('SKILL_BUDGETS', () => {
  it('covers all expected production skills', () => {
    const expected = [
      'triage',
      'repo-match',
      'bug-enhance',
      'evidence-post',
      'implement',
      'qa',
      'review',
      'resolve-conflict',
      'investigate',
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
    expect(result.budgets.maxBudgetUsd).toBe(0.05);
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

  it('haiku skills resolve to haiku model IDs', () => {
    for (const skill of [
      'triage',
      'repo-match',
      'implement',
      'evidence-post',
      'retrospective-light',
    ]) {
      const { modelOverride } = resolveBudgets(skill);
      expect(modelOverride, `${skill} should start on haiku`).toContain('haiku');
    }
  });

  it('opus skills resolve to opus model IDs', () => {
    for (const skill of ['investigate', 'advise-on-plan']) {
      const { modelOverride } = resolveBudgets(skill);
      expect(modelOverride, `${skill} should use opus`).toContain('opus');
    }
  });

  it('sonnet skills resolve to sonnet model IDs', () => {
    for (const skill of ['qa', 'review', 'retrospective-deep']) {
      const { modelOverride } = resolveBudgets(skill);
      expect(modelOverride, `${skill} should use sonnet`).toContain('sonnet');
    }
  });
});
