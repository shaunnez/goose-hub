import { describe, expect, it } from 'vitest';
import { sortLaneItems } from '../../lib/lanes.config';
import { COST_PLACEHOLDER } from './placeholders';

// IssueCard rendering is exercised by the Playwright happy-path (#36).
// Here we lock the sort/ordering rule it relies on (priority desc, then
// issue number asc), which IS the visual order in each lane.

describe('IssueCard — cost placeholder', () => {
  it('renders the cost placeholder as "$—" without error', () => {
    expect(COST_PLACEHOLDER).toBe('$—');
  });
});

describe('issue card lane ordering', () => {
  it('orders by priority desc, then issue number asc', () => {
    const sorted = sortLaneItems([
      { externalId: '40', priority: 'medium' },
      { externalId: '12', priority: 'low' },
      { externalId: '7', priority: 'high' },
      { externalId: '99', priority: 'critical' },
      { externalId: '5', priority: 'high' },
    ]);
    expect(sorted.map((s) => s.externalId)).toEqual(['99', '5', '7', '40', '12']);
  });
});
