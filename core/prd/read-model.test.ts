import { describe, expect, it } from 'vitest';
import { eventStore } from '../event-stream/store.js';
import { resolveLatestPrd } from './read-model.js';

function workItemId(issueNumber: number): string {
  return `github:owner/repo#${issueNumber}`;
}

function projectId(label: string): string {
  return `prd-read-model-${label}-${Math.random().toString(36).slice(2, 10)}`;
}

describe('resolveLatestPrd', () => {
  it('returns the latest local prd.drafted event', async () => {
    const project = projectId('event-latest');
    const item = workItemId(1);
    eventStore.appendEvent({
      projectId: project,
      workItemId: item,
      kind: 'prd.drafted',
      runId: 'run-old',
      payload: { prd: { title: 'Old local PRD' }, advisorConcerns: ['needs tighter ACs'] },
    });
    eventStore.appendEvent({
      projectId: project,
      workItemId: item,
      kind: 'prd.drafted',
      runId: 'run-new',
      payload: { prd: { title: 'New local PRD' }, advisorConcerns: [] },
    });

    const result = await resolveLatestPrd({
      projectId: project,
      workItemId: item,
    });

    expect(result).toMatchObject({
      prd: { title: 'New local PRD' },
      advisorConcerns: null,
      source: 'event',
      runId: 'run-new',
    });
  });

  it('normalizes advisor concerns from a drafted event', async () => {
    const project = projectId('advisor-concerns');
    const item = workItemId(2);
    eventStore.appendEvent({
      projectId: project,
      workItemId: item,
      kind: 'prd.drafted',
      runId: 'run-1',
      payload: {
        prd: { title: 'PRD with concerns' },
        advisorConcerns: ['quantify success', 'name the owner'],
      },
    });

    const result = await resolveLatestPrd({ projectId: project, workItemId: item });

    expect(result).toMatchObject({
      prd: { title: 'PRD with concerns' },
      advisorConcerns: '- quantify success\n- name the owner',
      source: 'event',
      runId: 'run-1',
    });
  });

  it('returns null when no prd.drafted event exists', async () => {
    const result = await resolveLatestPrd({
      projectId: projectId('missing'),
      workItemId: workItemId(3),
    });

    expect(result).toBeNull();
  });
});
