import { describe, expect, it } from 'vitest';
import { groupIssues, resolveState } from './lib.js';
import type { GHIssue, ResolvedIssue } from './lib.js';

function makeIssue(number: number, labels: string[]): GHIssue {
  return { number, title: `Issue ${number}`, labels: labels.map((name) => ({ name })) };
}

function makeResolved(number: number, labels: string[]): ResolvedIssue {
  const issue = makeIssue(number, labels);
  return { issue, resolution: resolveState(labels) };
}

describe('resolveState', () => {
  it('returns factory:triaging with conflict when no state labels present', () => {
    const r = resolveState(['bug', 'enhancement']);
    expect(r.state).toBe('factory:triaging');
    expect(r.conflict).toBe(true);
    expect(r.raw).toEqual([]);
  });

  it('returns single state without conflict', () => {
    const r = resolveState(['factory:in-progress', 'bug']);
    expect(r.state).toBe('factory:in-progress');
    expect(r.conflict).toBe(false);
    expect(r.raw).toEqual(['factory:in-progress']);
  });

  it('picks most-advanced state on conflict', () => {
    const r = resolveState(['factory:triaging', 'factory:in-progress']);
    expect(r.state).toBe('factory:in-progress');
    expect(r.conflict).toBe(true);
  });

  it('factory:archived wins over everything', () => {
    const r = resolveState(['factory:done', 'factory:archived']);
    expect(r.state).toBe('factory:archived');
    expect(r.conflict).toBe(true);
  });
});

describe('groupIssues', () => {
  it('groups clean issues by state in canonical order', () => {
    const resolved = [
      makeResolved(1, ['factory:in-progress']),
      makeResolved(2, ['factory:triaging']),
      makeResolved(3, ['factory:in-progress']),
    ];
    const { byState, conflicts } = groupIssues(resolved);
    expect(conflicts).toHaveLength(0);
    expect(byState.get('factory:triaging')).toHaveLength(1);
    expect(byState.get('factory:in-progress')).toHaveLength(2);
  });

  it('separates multi-label conflicts into conflicts array', () => {
    const resolved = [
      makeResolved(1, ['factory:triaging', 'factory:in-progress']),
      makeResolved(2, ['factory:done']),
    ];
    const { byState, conflicts } = groupIssues(resolved);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].issue.number).toBe(1);
    expect(byState.get('factory:done')).toHaveLength(1);
  });

  it('places no-label issues in byState under factory:triaging (not conflicts)', () => {
    const resolved = [makeResolved(1, [])];
    const { byState, conflicts } = groupIssues(resolved);
    // no-label: raw.length === 0, conflict=true but NOT a multi-label conflict
    expect(conflicts).toHaveLength(0);
    expect(byState.get('factory:triaging')).toHaveLength(1);
  });
});
