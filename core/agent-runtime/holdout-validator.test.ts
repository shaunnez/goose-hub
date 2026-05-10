import { describe, expect, it } from 'vitest';
import {
  HOLDOUT_FORBIDDEN_KEYS,
  findDisallowedKeys,
  findHoldoutContextLeaks,
} from './holdout-validator.js';

function makeSpec(role: string, context: Record<string, unknown>, allowlist: string[]) {
  return {
    runId: 'r1',
    role: role as 'qa',
    skill: 'implement',
    context,
    contextAllowlist: allowlist,
    freshContext: true as const,
    toolBundles: [] as string[],
    toolExtras: [] as never[],
    budgets: { maxTurns: 10, maxBudgetUsd: 1, timeoutMs: 30_000 },
    personaId: 'p1',
    outputJsonSchema: {},
    appendSystemPrompt: '',
  };
}

describe('findHoldoutContextLeaks', () => {
  it('returns empty array for non-holdout roles', () => {
    const spec = makeSpec('developer', { devReviewFindings: 'sensitive' }, ['devReviewFindings']);
    expect(findHoldoutContextLeaks(spec)).toEqual([]);
  });

  it('returns empty array when no forbidden keys are present', () => {
    const spec = makeSpec('qa', { title: 'safe', body: 'safe' }, ['title', 'body']);
    expect(findHoldoutContextLeaks(spec)).toEqual([]);
  });

  it('detects devReviewFindings in context for holdout role', () => {
    const spec = makeSpec('qa', { devReviewFindings: 'leak' }, ['title']);
    expect(findHoldoutContextLeaks(spec)).toEqual([
      { key: 'devReviewFindings', source: 'context' },
    ]);
  });

  it('detects devReviewVerdict in context for reviewer role', () => {
    const spec = makeSpec('reviewer', { devReviewVerdict: 'pass' }, []);
    expect(findHoldoutContextLeaks(spec)).toEqual([{ key: 'devReviewVerdict', source: 'context' }]);
  });

  it('detects devReviewSummaries in context', () => {
    const spec = makeSpec('qa', { devReviewSummaries: [] }, []);
    expect(findHoldoutContextLeaks(spec)).toEqual([
      { key: 'devReviewSummaries', source: 'context' },
    ]);
  });

  it('detects forbidden key in allowlist (exact)', () => {
    const spec = makeSpec('qa', {}, ['devReviewFindings']);
    expect(findHoldoutContextLeaks(spec)).toEqual([
      { key: 'devReviewFindings', source: 'allowlist' },
    ]);
  });

  it('detects forbidden key via dotted allowlist entry', () => {
    const spec = makeSpec('qa', {}, ['devReviewFindings.summary']);
    expect(findHoldoutContextLeaks(spec)).toEqual([
      { key: 'devReviewFindings.summary', source: 'allowlist' },
    ]);
  });

  it('detects multiple leaks across context and allowlist', () => {
    const spec = makeSpec('reviewer', { devReviewFindings: 'a', devReviewVerdict: 'b' }, [
      'devReviewSummaries',
    ]);
    const leaks = findHoldoutContextLeaks(spec);
    expect(leaks).toHaveLength(3);
    expect(leaks.filter((l) => l.source === 'context')).toHaveLength(2);
    expect(leaks.filter((l) => l.source === 'allowlist')).toHaveLength(1);
  });

  it('HOLDOUT_FORBIDDEN_KEYS contains the three dev-review keys', () => {
    expect(HOLDOUT_FORBIDDEN_KEYS.has('devReviewFindings')).toBe(true);
    expect(HOLDOUT_FORBIDDEN_KEYS.has('devReviewVerdict')).toBe(true);
    expect(HOLDOUT_FORBIDDEN_KEYS.has('devReviewSummaries')).toBe(true);
  });
});

describe('findDisallowedKeys', () => {
  it('returns empty array when allowlist is empty', () => {
    expect(findDisallowedKeys({ a: 1 }, [])).toEqual([]);
  });

  it('returns empty array when all keys are allowed', () => {
    expect(findDisallowedKeys({ a: 1, b: 2 }, ['a', 'b'])).toEqual([]);
  });

  it('returns keys not in allowlist (excluding system keys)', () => {
    const result = findDisallowedKeys({ a: 1, b: 2, c: 3 }, ['a']);
    expect(result).toContain('b');
    expect(result).toContain('c');
    expect(result).not.toContain('a');
  });

  it('excludes system keys (projectId, workItemId) from disallowed', () => {
    const result = findDisallowedKeys({ projectId: 'p1', workItemId: 'wi-1', extra: 'x' }, [
      'title',
    ]);
    expect(result).not.toContain('projectId');
    expect(result).not.toContain('workItemId');
    expect(result).toContain('extra');
  });

  it('does not flag key covered by dotted allowlist entry', () => {
    const result = findDisallowedKeys({ workItem: { title: 'T', body: 'B' } }, ['workItem.title']);
    expect(result).not.toContain('workItem');
  });
});
