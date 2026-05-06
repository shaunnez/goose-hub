import { describe, expect, it } from 'vitest';
import { TIERS, formatWallTime, severityColor } from './qa';

describe('formatWallTime', () => {
  it('shows milliseconds for sub-second durations', () => {
    expect(formatWallTime(0)).toBe('0ms');
    expect(formatWallTime(999)).toBe('999ms');
  });

  it('shows two decimals for sub-10s durations', () => {
    expect(formatWallTime(1000)).toBe('1.00s');
    expect(formatWallTime(9499)).toBe('9.50s');
  });

  it('shows one decimal for 10s..59s durations', () => {
    expect(formatWallTime(10_000)).toBe('10.0s');
    expect(formatWallTime(59_900)).toBe('59.9s');
  });

  it('shows minutes-and-seconds for 60s+ durations', () => {
    expect(formatWallTime(60_000)).toBe('1m 0s');
    expect(formatWallTime(125_000)).toBe('2m 5s');
  });
});

describe('severityColor', () => {
  it('returns the danger colour for "error"', () => {
    expect(severityColor('error')).toBe('var(--danger)');
  });

  it('returns the warning colour for "warning"', () => {
    expect(severityColor('warning')).toBe('var(--warning)');
  });

  it('returns the info colour for "info"', () => {
    expect(severityColor('info')).toBe('var(--info)');
  });
});

describe('TIERS', () => {
  it('exposes the canonical three-tier order', () => {
    expect(TIERS).toEqual(['structural', 'functional', 'regression']);
  });
});
