import { describe, expect, it } from 'vitest';
import { higherTier, lowerTier, resolveSkillRuntime } from './skill-runtime-resolver.js';

describe('resolveSkillRuntime', () => {
  it('lets a per-skill DB tier/provider override win over defaults', () => {
    const resolved = resolveSkillRuntime({
      skill: 'repo-match',
      dbOverride: { modelTier: 'sonnet', modelProvider: 'codex' },
    });

    expect(resolved.source).toBe('db');
    expect(resolved.tier).toBe('sonnet');
    expect(resolved.provider).toBe('codex');
    expect(resolved.modelOverride).toBe('gpt-5.4');
  });

  it('resolves playwright-repro to Codex haiku from a per-skill DB override', () => {
    const resolved = resolveSkillRuntime({
      skill: 'playwright-repro',
      role: 'investigator',
      dbOverride: {
        modelTier: 'haiku',
        modelProvider: 'codex',
        maxTurns: 20,
        maxBudgetUsd: 1,
      },
    });

    expect(resolved.source).toBe('db');
    expect(resolved.tier).toBe('haiku');
    expect(resolved.provider).toBe('codex');
    expect(resolved.modelOverride).toBe('gpt-5.4-mini');
    expect(resolved.budgets.maxTurns).toBe(20);
    expect(resolved.budgets.maxBudgetUsd).toBe(1);
  });

  it('uses project config skillBudgetOverrides before SKILL_BUDGETS', () => {
    const resolved = resolveSkillRuntime({
      skill: 'bug-enhance',
      projectBudgets: { skillBudgetOverrides: { 'bug-enhance': { modelTier: 'opus' } } },
    });

    expect(resolved.source).toBe('config');
    expect(resolved.modelOverride).toBe('claude-opus-4-7');
  });

  it('lets per-skill DB model/provider override skill defaults', () => {
    const resolved = resolveSkillRuntime({
      skill: 'investigate',
      role: 'investigator',
      dbOverride: { modelTier: 'opus', modelProvider: 'claude' },
    });

    expect(resolved.source).toBe('db');
    expect(resolved.tier).toBe('opus');
    expect(resolved.provider).toBe('claude');
    expect(resolved.modelOverride).toBe('claude-opus-4-7');
  });

  it('uses the skill provider hint for provider-pinned defaults like dev-review', () => {
    const resolved = resolveSkillRuntime({
      skill: 'dev-review',
      role: 'dev-reviewer',
      skillProvider: 'codex',
    });

    expect(resolved.source).toBe('skill-default');
    expect(resolved.tier).toBe('sonnet');
    expect(resolved.provider).toBe('codex');
    expect(resolved.modelOverride).toBe('gpt-5.4');
  });

  it('coerces provider when the project runtime is forced', () => {
    const resolved = resolveSkillRuntime({
      skill: 'repo-match',
      dbOverride: { modelTier: 'sonnet', modelProvider: 'claude' },
      configRuntime: 'codex-cli',
    });

    expect(resolved.provider).toBe('codex');
    expect(resolved.modelOverride).toBe('gpt-5.4');
  });

  it('keeps a caller concrete model override above forced runtime provider', () => {
    const resolved = resolveSkillRuntime({
      skill: 'repo-match',
      callerModelOverride: 'claude-opus-4-7',
      configRuntime: 'codex-cli',
    });

    expect(resolved.source).toBe('caller');
    expect(resolved.provider).toBe('claude');
    expect(resolved.modelOverride).toBe('claude-opus-4-7');
  });

  it('does not derive fallback/advisor models for holdouts', () => {
    const resolved = resolveSkillRuntime({ skill: 'implement', role: 'qa' });

    expect(resolved.resolvedFallback).toBeNull();
    expect(resolved.resolvedAdvisor).toBeNull();
  });

  it('ignores per-skill model overrides for holdouts unless explicitly allowed', () => {
    const resolved = resolveSkillRuntime({
      skill: 'qa',
      role: 'qa',
      dbOverride: { modelTier: 'haiku', modelProvider: 'codex' },
      projectBudgets: { skillBudgetOverrides: { qa: { modelTier: 'haiku' } } },
    });

    expect(resolved.source).toBe('skill-default');
    expect(resolved.tier).toBe('sonnet');
    expect(resolved.provider).toBe('claude');
    expect(resolved.modelOverride).toBe('claude-sonnet-4-6');
  });

  it('can ignore provider overrides for injected runtimes while keeping the tier', () => {
    const resolved = resolveSkillRuntime({
      skill: 'repo-match',
      dbOverride: { modelTier: 'sonnet', modelProvider: 'codex' },
      configRuntime: 'codex-cli',
      ignoreProviderOverride: true,
    });

    expect(resolved.tier).toBe('sonnet');
    expect(resolved.provider).toBe('claude');
    expect(resolved.modelOverride).toBe('claude-sonnet-4-6');
  });
});

describe('tier helpers', () => {
  it('floors lowerTier at haiku and caps higherTier at opus', () => {
    expect(lowerTier('haiku')).toBe('haiku');
    expect(lowerTier('sonnet')).toBe('haiku');
    expect(higherTier('sonnet')).toBe('opus');
    expect(higherTier('opus')).toBe('opus');
  });
});
