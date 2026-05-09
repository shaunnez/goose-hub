import type { MilestoneDto } from '@/lib/types';
import { describe, expect, it } from 'vitest';
import { resolveActiveMilestone } from './promote';

function milestone(partial: Partial<MilestoneDto>): MilestoneDto {
  return {
    id: partial.id ?? 'M0',
    title: partial.title ?? 'Milestone',
    number: partial.number ?? 0,
    isActive: partial.isActive ?? false,
    state: partial.state ?? 'open',
    openIssues: partial.openIssues ?? 0,
    closedIssues: partial.closedIssues ?? 0,
    ...partial,
  };
}

describe('resolveActiveMilestone', () => {
  it('returns null when the list is empty', () => {
    expect(resolveActiveMilestone([])).toBeNull();
  });

  it('returns null when no milestone is active', () => {
    const result = resolveActiveMilestone([
      milestone({ number: 1, isActive: false }),
      milestone({ number: 2, isActive: false }),
    ]);
    expect(result).toBeNull();
  });

  it('returns the number of the active milestone', () => {
    const result = resolveActiveMilestone([
      milestone({ number: 1, isActive: false }),
      milestone({ number: 9, isActive: true }),
      milestone({ number: 10, isActive: false }),
    ]);
    expect(result).toBe(9);
  });

  it('returns the first active milestone when several are flagged active', () => {
    const result = resolveActiveMilestone([
      milestone({ number: 3, isActive: true }),
      milestone({ number: 4, isActive: true }),
    ]);
    expect(result).toBe(3);
  });
});
