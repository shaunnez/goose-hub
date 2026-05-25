import { describe, expect, it } from 'vitest';
import type { WorkItem } from '../state-source/interface.js';
import { scoreVagueness } from './vagueness-gate.js';

function workItem(overrides: Pick<WorkItem, 'title' | 'body' | 'type'>): WorkItem {
  return {
    id: 'github:shaunnez/goose-hub#1',
    externalId: '1',
    repoRef: 'shaunnez/goose-hub',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:triaging',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date('2026-05-25T00:00:00.000Z'),
    ...overrides,
  };
}

describe('scoreVagueness', () => {
  it.each([
    {
      name: 'vague bug missing repro and criteria',
      item: workItem({
        type: 'bug',
        title: 'Dashboard broken',
        body: 'Something is weird on the dashboard. Maybe fix it.',
      }),
      expected: { score: 100, tier: 'high', missingDimensions: ['repro', 'criteria'] },
    },
    {
      name: 'clear bug with repro and expected behaviour',
      item: workItem({
        type: 'bug',
        title: 'Settings save returns 500',
        body: [
          'Route: /settings',
          'File: apps/server/src/domains/settings/service.ts',
          'Steps to reproduce:',
          '1. Open settings.',
          '2. Change the display name.',
          '3. Click Save.',
          'Expected: the new display name is persisted and the form shows Saved.',
          'Actual: the request returns HTTP 500.',
          'Acceptance criteria: saving a valid display name returns 200 and updates the profile.',
        ].join('\n'),
      }),
      expected: { score: 0, tier: 'low', missingDimensions: [] },
    },
    {
      name: 'vague feature missing criteria',
      item: workItem({
        type: 'feature',
        title: 'Better project dashboard',
        body: 'Make the dashboard better and easier to use somehow.',
      }),
      expected: { score: 85, tier: 'high', missingDimensions: ['criteria'] },
    },
    {
      name: 'clean feature with concrete acceptance criteria',
      item: workItem({
        type: 'feature',
        title: 'Show active milestone filter on board',
        body: [
          'Route: /projects/goose-hub-self/board',
          'Component: BoardToolbar',
          'Acceptance criteria:',
          '- The board shows a milestone dropdown populated from /active-milestone.',
          '- Selecting a milestone refetches issue cards for that milestone.',
          '- Clearing the filter restores the current milestone view.',
        ].join('\n'),
      }),
      expected: { score: 0, tier: 'low', missingDimensions: [] },
    },
  ])('$name', ({ item, expected }) => {
    expect(scoreVagueness(item)).toStrictEqual(expected);
  });

  it('is deterministic for the same work item input', () => {
    const item = workItem({
      type: 'feature',
      title: 'Add export',
      body: 'Need export support. Not sure what format yet.',
    });

    expect(scoreVagueness(item)).toStrictEqual(scoreVagueness(item));
  });
});
