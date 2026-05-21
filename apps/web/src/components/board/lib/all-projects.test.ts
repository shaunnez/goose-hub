import { describe, expect, it } from 'vitest';

import { LANES } from '@/lib/lanes.config';

import { groupAllProjectsItems, type WorkItemWithProject } from './all-projects';

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

describe('groupAllProjectsItems', () => {
  it('keeps same-priority lane items newest-first in /projects/all', () => {
    const items: WorkItemWithProject[] = [
      makeItem({ externalId: '10', priority: 'medium', state: 'factory:triaging' }),
      makeItem({ externalId: '30', priority: 'medium', state: 'factory:triaging' }),
      makeItem({ externalId: '20', priority: 'medium', state: 'factory:triaging' }),
    ];

    const map = groupAllProjectsItems(items, LANES);

    expect(map.get('triage')?.map((item) => item.externalId)).toEqual(['30', '20', '10']);
  });
});
