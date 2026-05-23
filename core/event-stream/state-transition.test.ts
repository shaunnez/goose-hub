import { sql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db.js';
import { events } from '../db/schema.js';
import type { StateName } from '../state-machine/states.js';
import type { StateSource } from '../state-source/interface.js';
import { transitionAndEmitState } from './state-transition.js';
import { eventStore } from './store.js';

const PROJECT = 'test-state-transition-wrapper';
const WORK_ITEM_ID = 'github:owner/repo#42';

function makeSource(overrides: Partial<StateSource> = {}): StateSource {
  return {
    projectId: PROJECT,
    repoRef: 'owner/repo',
    listOpenWork: vi.fn(),
    listClosedWorkByMilestone: vi.fn(),
    listWorkByMilestone: vi.fn(),
    getItem: vi.fn(),
    listMilestones: vi.fn(),
    getActiveMilestone: vi.fn(),
    transitionState: vi.fn().mockResolvedValue(undefined),
    forceState: vi.fn().mockResolvedValue(undefined),
    comment: vi.fn(),
    listComments: vi.fn(),
    setMilestone: vi.fn(),
    setLabelInGroup: vi.fn(),
    addLabels: vi.fn(),
    removeLabel: vi.fn(),
    attach: vi.fn(),
    createIssue: vi.fn(),
    createMilestone: vi.fn(),
    updateMilestone: vi.fn(),
    deleteMilestone: vi.fn(),
    getPrDiff: vi.fn(),
    watchForUpdates: vi.fn(),
    ...overrides,
  } as StateSource;
}

describe('transitionAndEmitState', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeAll(() => {
    db.run(sql`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      work_item_id TEXT,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      run_id TEXT,
      persona_id TEXT,
      created_at TEXT NOT NULL DEFAULT (current_timestamp)
    )`);
    db.delete(events).where(sql`project_id = ${PROJECT}`).run();
  });

  it('uses legal transitionState and emits after the mutation succeeds', async () => {
    const source = makeSource();

    await transitionAndEmitState({
      mode: 'legal',
      source,
      itemId: '42',
      projectId: PROJECT,
      workItemId: WORK_ITEM_ID,
      from: 'factory:prd-drafting',
      to: 'factory:prd-review',
      by: 'write-prd',
      runId: 'run-1',
    });

    expect(source.transitionState).toHaveBeenCalledWith(
      '42',
      'factory:prd-drafting',
      'factory:prd-review',
    );
    expect(source.forceState).not.toHaveBeenCalled();
    const [event] = eventStore.replay({ projectId: PROJECT, runId: 'run-1' });
    expect(event).toMatchObject({
      kind: 'state.transitioned',
      workItemId: WORK_ITEM_ID,
      payload: {
        from: 'factory:prd-drafting',
        to: 'factory:prd-review',
        by: 'write-prd',
      },
    });
  });

  it('uses forceState and marks known forced transitions', async () => {
    const source = makeSource();

    await transitionAndEmitState({
      mode: 'forced',
      source,
      itemId: '42',
      projectId: PROJECT,
      workItemId: WORK_ITEM_ID,
      from: 'factory:decomposing',
      to: 'factory:needs-human',
      by: 'decompose-prd',
      runId: 'run-forced',
      reason: 'schema failed',
    });

    expect(source.forceState).toHaveBeenCalledWith('42', 'factory:needs-human');
    const [event] = eventStore.replay({ projectId: PROJECT, runId: 'run-forced' });
    expect(event?.payload).toMatchObject({
      from: 'factory:decomposing',
      to: 'factory:needs-human',
      by: 'decompose-prd',
      forced: true,
      previousStateKnown: true,
      reason: 'schema failed',
    });
  });

  it('marks forced transitions when the previous state is unknown', async () => {
    const source = makeSource();

    await transitionAndEmitState({
      mode: 'forced',
      source,
      itemId: '42',
      projectId: PROJECT,
      workItemId: WORK_ITEM_ID,
      to: 'factory:needs-human',
      by: 'manual-recovery',
      runId: 'run-unknown',
    });

    const [event] = eventStore.replay({ projectId: PROJECT, runId: 'run-unknown' });
    expect(event?.payload).toMatchObject({
      from: null,
      to: 'factory:needs-human',
      forced: true,
      previousStateKnown: false,
    });
  });

  it('does not emit state.transitioned when the source mutation fails', async () => {
    const source = makeSource({
      transitionState: vi.fn().mockRejectedValue(new Error('illegal transition')),
    });
    const before = eventStore.replay({ projectId: PROJECT }).length;

    await expect(
      transitionAndEmitState({
        mode: 'legal',
        source,
        itemId: '42',
        projectId: PROJECT,
        workItemId: WORK_ITEM_ID,
        from: 'factory:accepted' as StateName,
        to: 'factory:done',
        by: 'test',
        runId: 'run-fail',
      }),
    ).rejects.toThrow('illegal transition');

    const after = eventStore.replay({ projectId: PROJECT }).length;
    expect(after).toBe(before);
  });

  it('retries on fetch failed and succeeds on the third attempt', async () => {
    vi.useFakeTimers();
    const transitionState = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(undefined);
    const source = makeSource({ transitionState });

    const promise = transitionAndEmitState({
      mode: 'legal',
      source,
      itemId: '42',
      projectId: PROJECT,
      workItemId: WORK_ITEM_ID,
      from: 'factory:investigating',
      to: 'factory:investigation-complete',
      by: 'investigate',
      runId: 'run-retry-ok',
    });
    await vi.runAllTimersAsync();
    await promise;

    expect(transitionState).toHaveBeenCalledTimes(3);
    const [event] = eventStore.replay({ projectId: PROJECT, runId: 'run-retry-ok' });
    expect(event).toMatchObject({
      kind: 'state.transitioned',
      payload: { to: 'factory:investigation-complete' },
    });
  });

  it('emits state.transition-deferred when all retries fail on a transient error', async () => {
    vi.useFakeTimers();
    const source = makeSource({
      transitionState: vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    });

    const promise = transitionAndEmitState({
      mode: 'legal',
      source,
      itemId: '42',
      projectId: PROJECT,
      workItemId: WORK_ITEM_ID,
      from: 'factory:investigating',
      to: 'factory:investigation-complete',
      by: 'investigate',
      runId: 'run-deferred',
    });
    await vi.runAllTimersAsync();
    await promise;

    const allEvents = eventStore.replay({ projectId: PROJECT, runId: 'run-deferred' });
    expect(allEvents.find((e) => e.kind === 'state.transitioned')).toBeDefined();
    const deferred = allEvents.find((e) => e.kind === 'state.transition-deferred');
    expect(deferred).toBeDefined();
    expect(deferred?.payload).toMatchObject({
      to: 'factory:investigation-complete',
      by: 'investigate',
    });
  });
});
