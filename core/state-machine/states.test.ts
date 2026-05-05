import { describe, expect, it } from 'vitest';
import { STATES } from './states.js';

describe('STATES', () => {
  it('has exactly 25 canonical states', () => {
    expect(STATES).toHaveLength(25);
  });

  it('contains all canonical factory:* states in order', () => {
    expect([...STATES]).toStrictEqual([
      'factory:triaging',
      'factory:accepted',
      'factory:rejected',
      'factory:grilling',
      'factory:prd-drafting',
      'factory:prd-review',
      'factory:decomposing',
      'factory:issues-created',
      'factory:research-pending',
      'factory:research-complete',
      'factory:investigating',
      'factory:investigation-complete',
      'factory:gate-pending',
      'factory:dev-ready',
      'factory:in-progress',
      'factory:needs-qa',
      'factory:qa-failed',
      'factory:needs-review',
      'factory:needs-fix',
      'factory:approved',
      'factory:merge-conflict',
      'factory:retrospecting',
      'factory:needs-human',
      'factory:done',
      'factory:archived',
    ]);
  });

  it('is frozen at runtime', () => {
    expect(Object.isFrozen(STATES)).toBe(true);
  });
});
