import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import { describe, expect, it } from 'vitest';
import { normalizeConfidence, parseQuery, scoreItem } from './score.js';

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:shaunnez/goose-hub#1',
    externalId: '1',
    repoRef: 'shaunnez/goose-hub',
    title: 'Default title',
    body: 'Default body',
    type: 'feature',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:triaging',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'parallel',
    dependsOn: [],
    blocks: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('parseQuery', () => {
  it('lowercases, splits on non-alphanumeric, dedupes, drops short/stopwords', () => {
    expect(parseQuery('Add SSE Reconnect')).toEqual({
      raw: 'Add SSE Reconnect',
      tokens: ['add', 'sse', 'reconnect'],
      externalId: null,
    });
    expect(parseQuery('  the   the  cache,  cache  ')).toEqual({
      raw: 'the   the  cache,  cache',
      tokens: ['cache'],
      externalId: null,
    });
  });

  it('extracts externalId for "#234" and "234" inputs', () => {
    expect(parseQuery('#234').externalId).toBe('234');
    expect(parseQuery('234').externalId).toBe('234');
    expect(parseQuery('  #99  ').externalId).toBe('99');
  });

  it('does not treat compound queries like "#234 cache" as an ID lookup', () => {
    const q = parseQuery('#234 cache');
    expect(q.externalId).toBeNull();
    expect(q.tokens).toEqual(['234', 'cache']);
  });

  it('returns an empty token list for whitespace-only queries', () => {
    expect(parseQuery('   ').tokens).toEqual([]);
  });
});

describe('scoreItem', () => {
  const now = new Date('2026-05-18T00:00:00Z');

  it('returns direct-hit score for matching externalId regardless of token overlap', () => {
    const it = item({ externalId: '42', title: 'Unrelated' });
    const q = parseQuery('#42');
    expect(scoreItem(it, q, now)).toBe(1000);
  });

  it('returns 0 when query has no tokens and no id', () => {
    expect(scoreItem(item(), parseQuery('  '), now)).toBe(0);
  });

  it('weights title matches above body matches', () => {
    const titleHit = item({ title: 'cache layer for tier-2', body: 'unrelated' });
    const bodyHit = item({ title: 'unrelated', body: 'cache layer for tier-2' });
    const q = parseQuery('cache');
    expect(scoreItem(titleHit, q, now)).toBeGreaterThan(scoreItem(bodyHit, q, now));
  });

  it('adds milestone weight when the milestone title contains a token', () => {
    const withMilestone = item({
      title: 'unrelated',
      body: 'unrelated',
      milestoneTitle: 'M19: Multi-agent orchestration',
    });
    const q = parseQuery('orchestration');
    expect(scoreItem(withMilestone, q, now)).toBeGreaterThan(0);
  });

  it('applies a recency boost only inside the 30-day window', () => {
    const fresh = item({
      title: 'cache layer',
      createdAt: new Date('2026-05-17T00:00:00Z'),
    });
    const stale = item({
      title: 'cache layer',
      createdAt: new Date('2025-01-01T00:00:00Z'),
    });
    const q = parseQuery('cache');
    expect(scoreItem(fresh, q, now)).toBeGreaterThan(scoreItem(stale, q, now));
  });

  it('returns 0 when no tokens match anywhere', () => {
    expect(scoreItem(item({ title: 'foo', body: 'bar' }), parseQuery('zzz'), now)).toBe(0);
  });
});

describe('normalizeConfidence', () => {
  it('returns 100 for the top score', () => {
    expect(normalizeConfidence(50, 50)).toBe(100);
  });

  it('scales other scores proportionally and rounds', () => {
    expect(normalizeConfidence(35, 50)).toBe(70);
    expect(normalizeConfidence(33, 50)).toBe(66);
  });

  it('returns 0 when topScore is non-positive', () => {
    expect(normalizeConfidence(10, 0)).toBe(0);
    expect(normalizeConfidence(10, -5)).toBe(0);
  });
});
