import { describe, expect, it } from 'vitest';
import { resolveRoleBudgetOverride } from './resolve-for-project.js';

describe('resolveRoleBudgetOverride', () => {
  it('returns nulls when dbRow is null', () => {
    expect(resolveRoleBudgetOverride(null, true)).toEqual({ maxTurns: null, timeoutMs: null });
  });

  it('returns nulls when dbRow is undefined', () => {
    expect(resolveRoleBudgetOverride(undefined, true)).toEqual({ maxTurns: null, timeoutMs: null });
  });

  it('returns nulls when honourOverrides is false (holdout gating)', () => {
    const row = { maxTurns: 50, timeoutMs: 120_000 };
    expect(resolveRoleBudgetOverride(row, false)).toEqual({ maxTurns: null, timeoutMs: null });
  });

  it('returns row values when honourOverrides is true and row is set', () => {
    const row = { maxTurns: 75, timeoutMs: 300_000 };
    expect(resolveRoleBudgetOverride(row, true)).toEqual({ maxTurns: 75, timeoutMs: 300_000 });
  });

  it('returns null for individual fields that are null in the row', () => {
    const row = { maxTurns: 40, timeoutMs: null };
    expect(resolveRoleBudgetOverride(row, true)).toEqual({ maxTurns: 40, timeoutMs: null });
  });

  it('returns null for fields not present on the row', () => {
    const row = {};
    expect(resolveRoleBudgetOverride(row, true)).toEqual({ maxTurns: null, timeoutMs: null });
  });

  it('holdout override false wins even when row has values', () => {
    // Confirms holdout gating cannot be bypassed by a non-null DB row.
    const row = { maxTurns: 500, timeoutMs: 3_600_000 };
    expect(resolveRoleBudgetOverride(row, false)).toEqual({ maxTurns: null, timeoutMs: null });
  });
});
