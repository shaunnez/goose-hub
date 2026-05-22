import type { AgentEventDto, WorkItemDto } from '@/lib/types';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  applyIssueTimelineEvent,
  backfillIssueTimelineEvents,
  upsertIssueEvent,
} from './live-events';

function makeEvent(
  id: number,
  kind = 'agent.investigation-complete',
  payload: AgentEventDto['payload'] = {},
): AgentEventDto {
  return {
    id,
    projectId: 'p',
    workItemId: 'w1',
    kind,
    payload,
    createdAt: new Date(Date.now() + id * 1000).toISOString(),
  };
}

describe('upsertIssueEvent', () => {
  it('seeds the shared issue events cache when the first live event arrives', () => {
    const queryClient = new QueryClient();
    const event = makeEvent(2);

    upsertIssueEvent(queryClient, 'p', '1', event);

    expect(queryClient.getQueryData(['events', 'p', '1'])).toEqual([event]);
  });

  it('inserts a live event into an existing issue events cache', () => {
    const queryClient = new QueryClient();
    const event = makeEvent(2);
    queryClient.setQueryData(['events', 'p', '1'], []);

    upsertIssueEvent(queryClient, 'p', '1', event);

    expect(queryClient.getQueryData(['events', 'p', '1'])).toEqual([event]);
  });

  it('dedupes repeated event ids without replacing the cached row', () => {
    const queryClient = new QueryClient();
    const event = makeEvent(2);
    const duplicate = { ...event, payload: { changed: true } };
    queryClient.setQueryData(['events', 'p', '1'], []);

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

describe('applyIssueTimelineEvent', () => {
  it('patches state and invalidates dependent issue queries', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const issue = {
      externalId: '1',
      state: 'factory:in-progress',
    } as WorkItemDto;
    queryClient.setQueryData(['issue', 'p', '1'], issue);
    queryClient.setQueryData(['issues', 'p'], [issue]);

    applyIssueTimelineEvent(
      queryClient,
      'p',
      '1',
      makeEvent(2, 'state.transitioned', {
        to: 'factory:needs-qa',
        interventionId: 'int_1',
      }),
    );

    expect(queryClient.getQueryData<WorkItemDto>(['issue', 'p', '1'])?.state).toBe(
      'factory:needs-qa',
    );
    expect(queryClient.getQueryData<WorkItemDto[]>(['issues', 'p'])?.[0]?.state).toBe(
      'factory:needs-qa',
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['issue', 'p', '1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['issues', 'p'] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['intervention-timeline', 'p', '1'],
    });
  });

  it('invalidates comments and costs for matching event kinds', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    applyIssueTimelineEvent(queryClient, 'p', '1', makeEvent(2, 'pr.opened'));
    applyIssueTimelineEvent(queryClient, 'p', '1', makeEvent(3, 'agent.run-completed'));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['comments', 'p', '1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['issue-costs', 'p', '1'] });
  });

  it('invalidates spec and acceptance contract when spec.completed arrives', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    applyIssueTimelineEvent(queryClient, 'p', '1', makeEvent(2, 'spec.completed'));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['spec', 'p', '1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['acceptance-contract', 'p', '1'],
    });
  });
});

describe('backfillIssueTimelineEvents', () => {
  it('pages after the cached cursor and applies transitions chronologically', async () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    queryClient.setQueryData(['events', 'p', '1'], [makeEvent(1, 'agent.run-started')]);
    queryClient.setQueryData(['issue', 'p', '1'], {
      externalId: '1',
      state: 'factory:in-progress',
    } as WorkItemDto);
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        events: [
          makeEvent(3, 'state.transitioned', { to: 'factory:needs-qa' }),
          makeEvent(2, 'pr.opened'),
        ],
        hasMore: true,
      })
      .mockResolvedValueOnce({
        events: [makeEvent(5, 'state.transitioned', { to: 'factory:approved' })],
        hasMore: false,
      });

    await backfillIssueTimelineEvents({
      queryClient,
      projectSlug: 'p',
      issueId: '1',
      fetchPage,
      limit: 2,
    });

    expect(fetchPage).toHaveBeenNthCalledWith(1, 'p', '1', { after: 1, limit: 2 });
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'p', '1', { after: 3, limit: 2 });
    expect(queryClient.getQueryData<WorkItemDto>(['issue', 'p', '1'])?.state).toBe(
      'factory:approved',
    );
    expect(
      queryClient.getQueryData<AgentEventDto[]>(['events', 'p', '1'])?.map((e) => e.id),
    ).toEqual([5, 3, 2, 1]);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['comments', 'p', '1'] });
  });
});
