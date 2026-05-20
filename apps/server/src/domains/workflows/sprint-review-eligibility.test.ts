import type { StateSource } from '@goose-hub/core/state-source/interface.js';
import { describe, expect, it } from 'vitest';
import { checkSprintReviewEligibility } from './sprint-review-eligibility.js';

function makeSource(items: { schedule: string; state: string; title: string }[]): StateSource {
  return {
    listWorkByMilestone: async () => items as never,
  } as unknown as StateSource;
}

describe('checkSprintReviewEligibility', () => {
  it('returns eligible when all schedule:current items are terminal', async () => {
    const source = makeSource([
      { schedule: 'current', state: 'factory:done', title: 'Task A' },
      { schedule: 'current', state: 'factory:archived', title: 'Task B' },
      { schedule: 'next', state: 'factory:triage', title: 'Backlog item' },
    ]);
    const result = await checkSprintReviewEligibility(source, 5, 'M5: Sprint');
    expect(result).toEqual({ eligible: true, reason: '', alreadyExists: false });
  });

  it('returns ineligible when no schedule:current items exist', async () => {
    const source = makeSource([
      { schedule: 'next', state: 'factory:triage', title: 'Backlog item' },
    ]);
    const result = await checkSprintReviewEligibility(source, 5, 'M5: Sprint');
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/no schedule:current/i);
  });

  it('returns ineligible when some schedule:current items are not terminal', async () => {
    const source = makeSource([
      { schedule: 'current', state: 'factory:done', title: 'Task A' },
      { schedule: 'current', state: 'factory:implementing', title: 'Task B' },
    ]);
    const result = await checkSprintReviewEligibility(source, 5, 'M5: Sprint');
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/1 schedule:current/i);
  });

  it('sets alreadyExists when a sprint-review issue exists for the milestone', async () => {
    const source = makeSource([
      { schedule: 'current', state: 'factory:done', title: 'Task A' },
      { schedule: 'current', state: 'factory:done', title: 'Sprint Review: M5: Sprint' },
    ]);
    const result = await checkSprintReviewEligibility(source, 5, 'M5: Sprint');
    expect(result.alreadyExists).toBe(true);
  });

  it('sets alreadyExists when a completed sprint-review artifact is no longer schedule:current', async () => {
    const source = makeSource([
      { schedule: 'current', state: 'factory:done', title: 'Task A' },
      { schedule: 'later', state: 'factory:done', title: 'Sprint Review: M5: Sprint' },
    ]);
    const result = await checkSprintReviewEligibility(source, 5, 'M5: Sprint');
    expect(result.alreadyExists).toBe(true);
  });
});
