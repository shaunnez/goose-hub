import type { AgentEventDto } from '@/lib/types';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { upsertIssueEvent } from './live-events';

function makeEvent(id: number, kind = 'agent.investigation-complete'): AgentEventDto {
  return {
    id,
    projectId: 'p',
    workItemId: 'w1',
    kind,
    payload: {},
    createdAt: new Date(Date.now() + id * 1000).toISOString(),
  };
}

describe('upsertIssueEvent', () => {
  it('inserts a live event into the issue events cache', () => {
    const queryClient = new QueryClient();
    const event = makeEvent(2);

    upsertIssueEvent(queryClient, 'p', '1', event);

    expect(queryClient.getQueryData(['events', 'p', '1'])).toEqual([event]);
  });

  it('dedupes repeated event ids without replacing the cached row', () => {
    const queryClient = new QueryClient();
    const event = makeEvent(2);
    const duplicate = { ...event, payload: { changed: true } };

    upsertIssueEvent(queryClient, 'p', '1', event);
    upsertIssueEvent(queryClient, 'p', '1', duplicate);

    expect(queryClient.getQueryData(['events', 'p', '1'])).toEqual([event]);
  });

  it('keeps issue event rows newest-first by event id', () => {
    const queryClient = new QueryClient();
    const event1 = makeEvent(1);
    const event3 = makeEvent(3);
    const event2 = makeEvent(2);
    queryClient.setQueryData(['events', 'p', '1'], [event1, event3]);

    upsertIssueEvent(queryClient, 'p', '1', event2);

    expect(queryClient.getQueryData(['events', 'p', '1'])).toEqual([event3, event2, event1]);
  });

  it('leaves unrelated event cache keys untouched', () => {
    const queryClient = new QueryClient();
    const otherEvent = makeEvent(9);
    queryClient.setQueryData(['events', 'p', '2'], [otherEvent]);

    upsertIssueEvent(queryClient, 'p', '1', makeEvent(2));

    expect(queryClient.getQueryData(['events', 'p', '2'])).toEqual([otherEvent]);
  });
});
