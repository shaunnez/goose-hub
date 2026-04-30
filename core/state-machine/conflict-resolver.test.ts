import { describe, expect, it } from 'vitest';
import { checkTransition, resolveState } from './conflict-resolver.js';

// Rule 1 — zero factory:* state labels
describe('resolveState — rule 1: zero factory state labels', () => {
  it('no labels at all → triaging + zero-factory-labels', () => {
    const result = resolveState([]);
    expect(result.state).toBe('factory:triaging');
    expect(result.conflicts).toContain('zero-factory-labels');
  });

  it('only non-factory labels → triaging + zero-factory-labels', () => {
    const result = resolveState(['bug', 'priority:high']);
    expect(result.state).toBe('factory:triaging');
    expect(result.conflicts).toContain('zero-factory-labels');
  });
});

// Rule 2 — single valid label
describe('resolveState — rule 2: single valid label, no conflict', () => {
  it('factory:accepted only → accepted, no conflicts', () => {
    const result = resolveState(['factory:accepted']);
    expect(result.state).toBe('factory:accepted');
    expect(result.conflicts).toHaveLength(0);
  });

  it('factory:in-progress only → in-progress, no conflicts', () => {
    const result = resolveState(['factory:in-progress']);
    expect(result.state).toBe('factory:in-progress');
    expect(result.conflicts).toHaveLength(0);
  });
});

// Rule 2 (multi-state tiebreak) — most advanced (highest index) wins
describe('resolveState — rule 2: two state labels → most advanced wins', () => {
  it('triaging + accepted → accepted (higher index), multiple-state-labels', () => {
    const result = resolveState(['factory:triaging', 'factory:accepted']);
    expect(result.state).toBe('factory:accepted');
    expect(result.conflicts).toContain('multiple-state-labels');
  });

  it('dev-ready + in-progress → in-progress, multiple-state-labels', () => {
    const result = resolveState(['factory:dev-ready', 'factory:in-progress']);
    expect(result.state).toBe('factory:in-progress');
    expect(result.conflicts).toContain('multiple-state-labels');
  });
});

// Rule 4 — archived + active → archived wins
describe('resolveState — rule 4: archived + active state → archived wins', () => {
  it('archived + triaging → archived, archived-wins', () => {
    const result = resolveState(['factory:archived', 'factory:triaging']);
    expect(result.state).toBe('factory:archived');
    expect(result.conflicts).toContain('archived-wins');
  });

  it('done + archived → archived, archived-wins', () => {
    const result = resolveState(['factory:done', 'factory:archived']);
    expect(result.state).toBe('factory:archived');
    expect(result.conflicts).toContain('archived-wins');
  });
});

// Rule 3 — unknown factory:* label alone
describe('resolveState — rule 3: unknown factory label alone', () => {
  it('factory:fake-unknown alone → triaging (zero known), unknown-factory-label + zero-factory-labels', () => {
    const result = resolveState(['factory:fake-unknown']);
    expect(result.state).toBe('factory:triaging');
    expect(result.conflicts).toContain('unknown-factory-label');
    expect(result.conflicts).toContain('zero-factory-labels');
  });
});

// Rule 3 — unknown factory:* label mixed with valid
describe('resolveState — rule 3: unknown factory label mixed with valid', () => {
  it('factory:fake-unknown + factory:accepted → accepted, unknown-factory-label only', () => {
    const result = resolveState(['factory:fake-unknown', 'factory:accepted']);
    expect(result.state).toBe('factory:accepted');
    expect(result.conflicts).toContain('unknown-factory-label');
    expect(result.conflicts).not.toContain('zero-factory-labels');
    expect(result.conflicts).not.toContain('multiple-state-labels');
  });
});

// Rule 6 — legal transition (null from)
describe('checkTransition — rule 6: null from is always legal', () => {
  it('null → triaging is legal', () => {
    const result = checkTransition(null, 'factory:triaging');
    expect(result.legal).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('null → archived is legal', () => {
    const result = checkTransition(null, 'factory:archived');
    expect(result.legal).toBe(true);
    expect(result.reason).toBeNull();
  });
});

// Rule 6 — legal transition between known states
describe('checkTransition — rule 6: legal transitions', () => {
  it('triaging → accepted is legal', () => {
    const result = checkTransition('factory:triaging', 'factory:accepted');
    expect(result.legal).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('approved → retrospecting is legal', () => {
    const result = checkTransition('factory:approved', 'factory:retrospecting');
    expect(result.legal).toBe(true);
    expect(result.reason).toBeNull();
  });
});

// Rule 7 — illegal transition
describe('checkTransition — rule 7: illegal transitions', () => {
  it('triaging → done is illegal', () => {
    const result = checkTransition('factory:triaging', 'factory:done');
    expect(result.legal).toBe(false);
    expect(result.reason).toBe('illegal-transition');
  });

  it('in-progress → approved (skips qa/review) is illegal', () => {
    const result = checkTransition('factory:in-progress', 'factory:approved');
    expect(result.legal).toBe(false);
    expect(result.reason).toBe('illegal-transition');
  });
});
