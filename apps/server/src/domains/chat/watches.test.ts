import type { AgentEvent, eventStore } from '@goose-hub/core/event-stream/store.js';
import { describe, expect, it, vi } from 'vitest';
import { WatchRegistry } from './watches.js';

type SubscribeFn = typeof eventStore.subscribe;

function event(overrides: Partial<AgentEvent>): AgentEvent {
  return {
    id: 1,
    projectId: 'goose-hub-self',
    workItemId: null,
    kind: 'state.transitioned',
    payload: {},
    runId: null,
    personaId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('WatchRegistry — run subscriptions', () => {
  it('fires once when a matching agent.run-completed arrives', () => {
    const onFire = vi.fn();
    const reg = new WatchRegistry(onFire);
    const watch = reg.addRunWatch('conv_1', 'run_alpha');
    expect(reg.size()).toBe(1);

    reg.handle(event({ kind: 'agent.run-completed', runId: 'run_alpha' }));

    expect(onFire).toHaveBeenCalledTimes(1);
    expect(onFire.mock.calls[0][0].watch.id).toBe(watch.id);
    expect(reg.size()).toBe(0);
  });

  it('fires on agent.run-failed for the watched runId', () => {
    const onFire = vi.fn();
    const reg = new WatchRegistry(onFire);
    reg.addRunWatch('conv_1', 'run_alpha');

    reg.handle(event({ kind: 'agent.run-failed', runId: 'run_alpha' }));

    expect(onFire).toHaveBeenCalledTimes(1);
    expect(reg.size()).toBe(0);
  });

  it('ignores events for unrelated runs', () => {
    const onFire = vi.fn();
    const reg = new WatchRegistry(onFire);
    reg.addRunWatch('conv_1', 'run_alpha');

    reg.handle(event({ kind: 'agent.run-completed', runId: 'run_beta' }));
    reg.handle(event({ kind: 'agent.run-started', runId: 'run_alpha' }));

    expect(onFire).not.toHaveBeenCalled();
    expect(reg.size()).toBe(1);
  });
});

describe('WatchRegistry — issue subscriptions', () => {
  it('fires when state.transitioned matches projectId + workItemId', () => {
    const onFire = vi.fn();
    const reg = new WatchRegistry(onFire);
    reg.addIssueWatch('conv_1', 'goose-hub-self', 'github:shaunnez/goose-hub#42');

    reg.handle(
      event({
        kind: 'state.transitioned',
        projectId: 'goose-hub-self',
        workItemId: 'github:shaunnez/goose-hub#42',
        payload: { from: 'factory:in-progress', to: 'factory:needs-qa' },
      }),
    );

    expect(onFire).toHaveBeenCalledTimes(1);
    expect(reg.size()).toBe(0);
  });

  it('ignores transitions for other work items', () => {
    const onFire = vi.fn();
    const reg = new WatchRegistry(onFire);
    reg.addIssueWatch('conv_1', 'goose-hub-self', 'github:shaunnez/goose-hub#42');

    reg.handle(
      event({
        kind: 'state.transitioned',
        projectId: 'goose-hub-self',
        workItemId: 'github:shaunnez/goose-hub#7',
      }),
    );

    expect(onFire).not.toHaveBeenCalled();
    expect(reg.size()).toBe(1);
  });

  it('ignores non-transition events for the same workItemId', () => {
    const onFire = vi.fn();
    const reg = new WatchRegistry(onFire);
    reg.addIssueWatch('conv_1', 'goose-hub-self', 'github:shaunnez/goose-hub#42');

    reg.handle(
      event({
        kind: 'agent.log',
        projectId: 'goose-hub-self',
        workItemId: 'github:shaunnez/goose-hub#42',
      }),
    );

    expect(onFire).not.toHaveBeenCalled();
  });
});

describe('WatchRegistry — TTL expiry', () => {
  it('drops watches once their expiresAt has passed', () => {
    const onFire = vi.fn();
    const reg = new WatchRegistry(onFire, { ttlMs: 1_000 });
    const baseNow = 1_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(baseNow);
    reg.addRunWatch('conv_1', 'run_alpha');
    expect(reg.size()).toBe(1);

    // Advance past TTL — the next event handle prunes the expired watch.
    vi.spyOn(Date, 'now').mockReturnValue(baseNow + 2_000);
    reg.handle(event({ kind: 'agent.run-completed', runId: 'run_alpha' }));

    expect(onFire).not.toHaveBeenCalled();
    expect(reg.size()).toBe(0);
  });

  it('pruneExpired removes watches without firing them', () => {
    const onFire = vi.fn();
    const reg = new WatchRegistry(onFire, { ttlMs: 500 });
    const baseNow = 2_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(baseNow);
    reg.addRunWatch('conv_1', 'run_alpha');

    vi.spyOn(Date, 'now').mockReturnValue(baseNow + 600);
    const pruned = reg.pruneExpired();

    expect(pruned).toBe(1);
    expect(reg.size()).toBe(0);
    expect(onFire).not.toHaveBeenCalled();
  });
});

describe('WatchRegistry — conversation-scoped cleanup', () => {
  it('removeByConversation drops every watch owned by that conversation', () => {
    const onFire = vi.fn();
    const reg = new WatchRegistry(onFire);
    reg.addRunWatch('conv_a', 'run_1');
    reg.addRunWatch('conv_a', 'run_2');
    reg.addRunWatch('conv_b', 'run_3');

    const removed = reg.removeByConversation('conv_a');

    expect(removed).toBe(2);
    expect(reg.size()).toBe(1);
    expect(reg.listForConversation('conv_a')).toHaveLength(0);
    expect(reg.listForConversation('conv_b')).toHaveLength(1);
  });

  it('returns 0 when no watches match the conversation', () => {
    const reg = new WatchRegistry(vi.fn());
    expect(reg.removeByConversation('nope')).toBe(0);
  });
});

describe('WatchRegistry — event-stream wiring', () => {
  it('start subscribes once and stop unsubscribes', () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const reg = new WatchRegistry(vi.fn(), {
      subscribe: subscribe as unknown as SubscribeFn,
    });

    reg.start();
    reg.start();

    expect(subscribe).toHaveBeenCalledTimes(1);

    reg.stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
