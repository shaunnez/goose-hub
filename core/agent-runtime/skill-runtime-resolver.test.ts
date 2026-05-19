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
    expect(resolved.runtimeTrace.tier).toMatchObject({ value: 'sonnet', source: 'db' });
    expect(resolved.runtimeTrace.provider).toMatchObject({ value: 'codex', source: 'db' });
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

  it('resolves effort with DB above project config and skill defaults', () => {
    const resolved = resolveSkillRuntime({
      skill: 'repo-match',
      projectBudgets: { skillBudgetOverrides: { 'repo-match': { effort: 'medium' } } },
      dbOverride: { effort: 'xhigh' },
    });

    expect(resolved.source).toBe('db');
    expect(resolved.effort).toBe('xhigh');
  });

  it('keeps DB source attribution when DB tier wins but effort comes from config', () => {
    const resolved = resolveSkillRuntime({
      skill: 'repo-match',
      projectBudgets: { skillBudgetOverrides: { 'repo-match': { effort: 'medium' } } },
      dbOverride: { modelTier: 'opus' },
    });

    expect(resolved.source).toBe('db');
    expect(resolved.tier).toBe('opus');
    expect(resolved.effort).toBe('medium');
    expect(resolved.runtimeTrace.tier).toMatchObject({ value: 'opus', source: 'db' });
    expect(resolved.runtimeTrace.effort).toMatchObject({ value: 'medium', source: 'config' });
  });

  it('keeps effort displayable when the effective provider is Claude', () => {
    const resolved = resolveSkillRuntime({
      skill: 'repo-match',
      dbOverride: { effort: 'high', modelProvider: 'claude' },
    });

    expect(resolved.provider).toBe('claude');
    expect(resolved.effort).toBe('high');
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
    expect(resolved.runtimeTrace.provider).toMatchObject({
      value: 'codex',
      source: 'skill-default',
    });
  });

  it('coerces provider when the project runtime is forced', () => {
    const resolved = resolveSkillRuntime({
      skill: 'repo-match',
      dbOverride: { modelTier: 'sonnet', modelProvider: 'claude' },
      configRuntime: 'codex-cli',
    });

    expect(resolved.provider).toBe('codex');
    expect(resolved.modelOverride).toBe('gpt-5.4');
    expect(resolved.source).toBe('db');
    expect(resolved.runtimeTrace.provider).toMatchObject({ value: 'codex', source: 'config' });
    expect(resolved.runtimeTrace.provider.reason).toContain('codex-cli forces provider codex');
  });

  it('preserves DB source when forced runtime coerces a DB provider-only override', () => {
    const resolved = resolveSkillRuntime({
      skill: 'repo-match',
      dbOverride: { modelProvider: 'claude' },
      configRuntime: 'codex-cli',
    });

    expect(resolved.source).toBe('db');
    expect(resolved.tier).toBe('haiku');
    expect(resolved.provider).toBe('codex');
    expect(resolved.runtimeTrace.tier).toMatchObject({
      value: 'haiku',
      source: 'skill-default',
    });
    expect(resolved.runtimeTrace.provider).toMatchObject({ value: 'codex', source: 'config' });
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
    expect(resolved.runtimeTrace.tier).toMatchObject({ value: 'opus', source: 'caller' });
    expect(resolved.runtimeTrace.provider).toMatchObject({ value: 'claude', source: 'caller' });
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
    expect(resolved.runtimeTrace.tier).toMatchObject({
      value: 'sonnet',
      source: 'skill-default',
    });
    expect(resolved.runtimeTrace.tier.reason).toContain('holdout skill ignores');
    expect(resolved.runtimeTrace.provider).toMatchObject({ value: 'claude', source: 'fallback' });
    expect(resolved.runtimeTrace.provider.reason).toContain('holdout skill ignores');
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
    expect(resolved.runtimeTrace.tier).toMatchObject({ value: 'sonnet', source: 'db' });
    expect(resolved.runtimeTrace.provider).toMatchObject({ value: 'claude', source: 'fallback' });
    expect(resolved.runtimeTrace.provider.reason).toContain('provider override ignored');
  });

  it('preserves DB source when injected runtimes ignore a DB provider-only override', () => {
    const resolved = resolveSkillRuntime({
      skill: 'repo-match',
      dbOverride: { modelProvider: 'codex' },
      configRuntime: 'codex-cli',
      ignoreProviderOverride: true,
    });

    expect(resolved.source).toBe('db');
    expect(resolved.tier).toBe('haiku');
    expect(resolved.provider).toBe('claude');
    expect(resolved.runtimeTrace.tier).toMatchObject({
      value: 'haiku',
      source: 'skill-default',
    });
    expect(resolved.runtimeTrace.provider).toMatchObject({ value: 'claude', source: 'fallback' });
    expect(resolved.runtimeTrace.provider.reason).toContain('provider override ignored');
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
