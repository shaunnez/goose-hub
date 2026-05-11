import { describe, expect, it } from 'vitest';
import {
  PRIORITIES,
  PrioritySchema,
  defaultQaPriority,
  defaultReviewPriority,
} from './priority.js';

describe('PrioritySchema', () => {
  it('accepts P0, P1, P2, P3', () => {
    for (const p of ['P0', 'P1', 'P2', 'P3'] as const) {
      expect(PrioritySchema.safeParse(p).success).toBe(true);
    }
  });

  it('rejects other strings', () => {
    expect(PrioritySchema.safeParse('p0').success).toBe(false);
    expect(PrioritySchema.safeParse('P4').success).toBe(false);
    expect(PrioritySchema.safeParse('critical').success).toBe(false);
  });

  it('exports a tuple covering all enum values', () => {
    expect([...PRIORITIES].sort()).toEqual(['P0', 'P1', 'P2', 'P3']);
  });
});

describe('defaultQaPriority', () => {
  it('promotes error → P1, warning → P2, info → P3', () => {
    expect(defaultQaPriority('error')).toBe('P1');
    expect(defaultQaPriority('warning')).toBe('P2');
    expect(defaultQaPriority('info')).toBe('P3');
  });
});

describe('defaultReviewPriority', () => {
  it('promotes blocker → P0, major → P1, minor → P2', () => {
    expect(defaultReviewPriority('blocker')).toBe('P0');
    expect(defaultReviewPriority('major')).toBe('P1');
    expect(defaultReviewPriority('minor')).toBe('P2');
  });
});
