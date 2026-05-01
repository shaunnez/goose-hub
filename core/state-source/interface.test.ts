import { describe, expect, it } from 'vitest';
import type { StateName } from '../state-machine/states.js';
import type {
  Artifact,
  CreateIssueInput,
  Milestone,
  SourceEvent,
  StateSource,
  Subscription,
  WorkItem,
} from './interface.js';

class StubStateSource implements StateSource {
  projectId = 'stub-project';
  repoRef = 'stub-owner/stub-repo';

  listOpenWork(): Promise<WorkItem[]> {
    return Promise.resolve([]);
  }

  listClosedWorkByMilestone(_milestoneNumber: number): Promise<WorkItem[]> {
    return Promise.resolve([]);
  }

  getItem(_itemId: string): Promise<WorkItem> {
    return Promise.reject(new Error('not implemented'));
  }

  listMilestones(): Promise<Milestone[]> {
    return Promise.resolve([]);
  }

  getActiveMilestone(): Promise<Milestone | null> {
    return Promise.resolve(null);
  }

  transitionState(
    _itemId: string,
    _from: StateName,
    _to: StateName,
    _note?: string,
  ): Promise<void> {
    return Promise.resolve();
  }

  forceState(_itemId: string, _to: StateName): Promise<void> {
    return Promise.resolve();
  }

  comment(_itemId: string, _body: string): Promise<void> {
    return Promise.resolve();
  }

  setMilestone(_itemId: string, _milestoneNumber: number | null): Promise<void> {
    return Promise.resolve();
  }

  setLabelInGroup(_itemId: string, _group: 'priority' | 'schedule', _value: string): Promise<void> {
    return Promise.resolve();
  }

  attach(_itemId: string, _artifact: Artifact): Promise<void> {
    return Promise.resolve();
  }

  createIssue(_input: CreateIssueInput): Promise<WorkItem> {
    return Promise.reject(new Error('not implemented'));
  }

  watchForUpdates(_callback: (event: SourceEvent) => void): Promise<Subscription> {
    return Promise.resolve({ unsubscribe: () => {} });
  }
}

describe('StateSource interface', () => {
  it('stub compiles', () => {
    expect(true).toBe(true);
  });

  it('stub satisfies StateSource shape', () => {
    const source: StateSource = new StubStateSource();
    expect(source.projectId).toBe('stub-project');
    expect(source.repoRef).toBe('stub-owner/stub-repo');
  });
});
