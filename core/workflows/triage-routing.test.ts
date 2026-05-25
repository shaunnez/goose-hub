import { describe, expect, it } from 'vitest';
import { targetStateForTriage } from './triage-routing.js';

describe('targetStateForTriage', () => {
  it.each([
    {
      name: 'vague bug still enters investigation where bug enrichment runs before scouts',
      type: 'bug' as const,
      labels: ['vague:high'],
      expected: 'factory:investigating',
    },
    {
      name: 'clean bug keeps the existing investigation route',
      type: 'bug' as const,
      labels: ['vague:low'],
      expected: 'factory:investigating',
    },
    {
      name: 'vague fresh feature routes to framing',
      type: 'feature' as const,
      labels: ['vague:high'],
      expected: 'factory:framing',
    },
    {
      name: 'clean fresh feature keeps grilling',
      type: 'feature' as const,
      labels: ['vague:low'],
      expected: 'factory:grilling',
    },
  ])('$name', ({ type, labels, expected }) => {
    expect(targetStateForTriage(type, labels)).toBe(expected);
  });

  it('keeps factory:from-prd as a feature override even when vagueness is high', () => {
    expect(targetStateForTriage('feature', ['factory:from-prd', 'vague:high'])).toBe(
      'factory:dev-ready',
    );
  });

  it('continues routing non-feature non-bug items somewhere', () => {
    expect(targetStateForTriage('chore', ['vague:high'])).toBe('factory:dev-ready');
    expect(targetStateForTriage('research', ['vague:high'])).toBe('factory:research-pending');
  });
});
