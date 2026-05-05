import { LANES, sortLaneItems } from '@/lib/lanes.config';
import { describe, expect, it } from 'vitest';
import { groupAllProjectsItems } from './lib/all-projects';
import type { WorkItemWithProject } from './lib/all-projects';

// IssueCard rendering is exercised by the Playwright happy-path (#36)
// and by board/components/IssueCard.test.tsx.
// Here we lock the sort/ordering rule it relies on.

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

function makeItem(overrides: Partial<WorkItemWithProject> = {}): WorkItemWithProject {
  return {
    id: 'github:org/repo#1',
    externalId: '1',
    repoRef: 'org/repo',
    title: 'Test',
    body: '',
    type: 'bug',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:triaging',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
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
