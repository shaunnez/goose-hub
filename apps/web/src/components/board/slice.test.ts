import { LANES, sortLaneItems } from '@/lib/lanes.config';
import { describe, expect, it } from 'vitest';
import { groupAllProjectsItems } from './lib/all-projects';
import type { WorkItemWithProject } from './lib/all-projects';

// IssueCard rendering (including the M11.05 blocked indicator) is exercised by
// board/components/IssueCard.test.tsx and apps/web/e2e/m11-blocked-card.spec.ts.
// Here we lock the sort/ordering rule and grouping logic.

describe('issue card lane ordering', () => {
  it('orders newest items first', () => {
    const sorted = sortLaneItems([
      {
        externalId: '40',
        priority: 'medium',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
      {
        externalId: '12',
        priority: 'low',
        createdAt: '2024-01-04T00:00:00.000Z',
      },
      { externalId: '7', priority: 'high', createdAt: '2024-01-03T00:00:00.000Z' },
      { externalId: '99', priority: 'critical', createdAt: '2024-01-05T00:00:00.000Z' },
      { externalId: '5', priority: 'high', createdAt: '2024-01-02T00:00:00.000Z' },
    ]);
    expect(sorted.map((s) => s.externalId)).toEqual(['99', '12', '7', '5', '40']);
  });
});

function makeItem(overrides: Partial<WorkItemWithProject> = {}): WorkItemWithProject {
  return {
    id: 'github:org/repo#1',
    canonicalWorkItemId: 'github:org/repo#1',
    externalId: '1',
    repoRef: 'org/repo',
    title: 'Test',
    body: '',
    type: 'bug',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:triaging',
    authorIsOwner: true,
    schedule: 'serial',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    externalRefs: [],
    createdAt: new Date().toISOString(),
    projectSlug: 'proj-a',
    projectColor: '#f00',
    ...overrides,
  };
}

describe('groupAllProjectsItems (#284)', () => {
  it('places items into the correct lanes', () => {
    const items: WorkItemWithProject[] = [
      makeItem({ externalId: '1', state: 'factory:triaging', projectSlug: 'proj-a' }),
      makeItem({ externalId: '2', state: 'factory:dev-ready', projectSlug: 'proj-b' }),
      makeItem({ externalId: '3', state: 'factory:needs-qa', projectSlug: 'proj-a' }),
    ];
    const map = groupAllProjectsItems(items, LANES);
    expect(map.get('triage')?.map((i) => i.externalId)).toEqual(['1']);
    expect(map.get('dev')?.map((i) => i.externalId)).toEqual(['2']);
    expect(map.get('qa')?.map((i) => i.externalId)).toEqual(['3']);
  });

  it('aggregates items from two projects into shared lanes', () => {
    const items: WorkItemWithProject[] = [
      makeItem({
        externalId: '10',
        state: 'factory:triaging',
        projectSlug: 'proj-a',
        projectColor: '#f00',
      }),
      makeItem({
        externalId: '20',
        state: 'factory:triaging',
        projectSlug: 'proj-b',
        projectColor: '#0f0',
      }),
    ];
    const map = groupAllProjectsItems(items, LANES);
    const triageLane = map.get('triage') ?? [];
    expect(triageLane).toHaveLength(2);
    expect(triageLane.map((i) => i.projectSlug)).toContain('proj-a');
    expect(triageLane.map((i) => i.projectSlug)).toContain('proj-b');
  });

  it('preserves projectColor on items', () => {
    const items: WorkItemWithProject[] = [
      makeItem({
        externalId: '5',
        state: 'factory:dev-ready',
        projectSlug: 'proj-a',
        projectColor: '#abc123',
      }),
    ];
    const map = groupAllProjectsItems(items, LANES);
    expect(map.get('dev')?.[0]?.projectColor).toBe('#abc123');
  });

  it('returns empty arrays for lanes with no items', () => {
    const map = groupAllProjectsItems([], LANES);
    for (const lane of LANES) {
      expect(map.get(lane.key)).toEqual([]);
    }
  });
});
