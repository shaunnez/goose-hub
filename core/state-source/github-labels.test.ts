import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubLabelsSource } from './github-labels.js';

const REPO = 'shaunnez/goose-hub';
const TOKEN = 'test-token';

function makeSource() {
  return new GitHubLabelsSource('proj-1', REPO, TOKEN);
}

/** Build a minimal GitHub issue object for tests. */
function makeIssue(
  overrides: Partial<{
    number: number;
    title: string;
    body: string | null;
    labels: { name: string }[];
    milestone: {
      number: number;
      title: string;
      description: string | null;
      due_on: string | null;
      state: string;
    } | null;
    user: { login: string };
    created_at: string;
  }> = {},
) {
  return {
    number: 1,
    title: 'Test issue',
    body: null,
    labels: [],
    milestone: null,
    user: { login: 'shaunnez' },
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Create a mock fetch that returns the given body once, with optional headers. */
function mockFetchOnce(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    }),
  );
}

/** Create a mock fetch that maps URL patterns to responses. */
function mockFetchByUrl(handler: (url: string) => Response) {
  return vi.fn().mockImplementation((url: string) => Promise.resolve(handler(url)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Label parsing
// ---------------------------------------------------------------------------

describe('listOpenWork — label parsing', () => {
  it('maps factory:* labels to state, type, priority, mode, schedule, exec', async () => {
    const issues = [
      makeIssue({
        number: 10,
        labels: [
          { name: 'factory:in-progress' },
          { name: 'type:bug' },
          { name: 'priority:high' },
          { name: 'mode:autonomous' },
          { name: 'schedule:current' },
          { name: 'exec:serial' },
        ],
        user: { login: 'shaunnez' },
      }),
      makeIssue({
        number: 11,
        title: 'Unlabeled issue',
        labels: [],
        user: { login: 'other-user' },
      }),
    ];

    vi.stubGlobal(
      'fetch',
      mockFetchByUrl((url) => {
        if (url.includes('per_page=100')) {
          return new Response(JSON.stringify(issues), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('[]', { status: 200 });
      }),
    );

    const source = makeSource();
    const items = await source.listOpenWork();

    expect(items).toHaveLength(2);

    const first = items.find((i) => i.externalId === '10');
    if (first == null) throw new Error('expected item 10');
    expect(first.state).toBe('factory:in-progress');
    expect(first.type).toBe('bug');
    expect(first.priority).toBe('high');
    expect(first.mode).toBe('autonomous');
    expect(first.schedule).toBe('current');
    expect(first.exec).toBe('serial');
    expect(first.authorIsOwner).toBe(true);
    expect(first.id).toBe('github:shaunnez/goose-hub#10');
    expect(first.externalId).toBe('10');
    expect(first.repoRef).toBe(REPO);

    const second = items.find((i) => i.externalId === '11');
    if (second == null) throw new Error('expected item 11');
    // Defaults when no labels present.
    expect(second.state).toBe('factory:triaging');
    expect(second.type).toBe('feature');
    expect(second.priority).toBe('medium');
    expect(second.mode).toBe('supervised');
    expect(second.schedule).toBe('later');
    expect(second.exec).toBe('parallel');
    expect(second.authorIsOwner).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SCHEDULE_UI_TO_LABEL — blocked-by mapping (#202)
// ---------------------------------------------------------------------------

describe('SCHEDULE_UI_TO_LABEL (#202)', () => {
  it('maps blocked-by to schedule:blocked-by', async () => {
    const { SCHEDULE_UI_TO_LABEL } = await import('./github-labels.js');
    expect(SCHEDULE_UI_TO_LABEL['blocked-by']).toBe('schedule:blocked-by');
  });

  it('maps the original three UI values too (regression check)', async () => {
    const { SCHEDULE_UI_TO_LABEL } = await import('./github-labels.js');
    expect(SCHEDULE_UI_TO_LABEL.current).toBe('schedule:current');
    expect(SCHEDULE_UI_TO_LABEL.backlog).toBe('schedule:next');
    expect(SCHEDULE_UI_TO_LABEL.icebox).toBe('schedule:later');
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe('listOpenWork — pagination', () => {
  it('follows Link header to fetch all pages (100 + 2 = 102 items)', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => makeIssue({ number: i + 1 }));
    const page2 = [makeIssue({ number: 101 }), makeIssue({ number: 102 })];

    vi.stubGlobal(
      'fetch',
      mockFetchByUrl((url) => {
        if (url.includes('page=2')) {
          return new Response(JSON.stringify(page2), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        // First page — include Link rel=next pointing to page 2.
        const nextUrl = `https://api.github.com/repos/${REPO}/issues?state=open&per_page=100&page=2`;
        return new Response(JSON.stringify(page1), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            Link: `<${nextUrl}>; rel="next", <${nextUrl}>; rel="last"`,
          },
        });
      }),
    );

    const source = makeSource();
    const items = await source.listOpenWork();
    expect(items).toHaveLength(102);
  });
});

// ---------------------------------------------------------------------------
// getActiveMilestone
// ---------------------------------------------------------------------------

describe('getActiveMilestone', () => {
  it('returns null when there are no open milestones', async () => {
    vi.stubGlobal('fetch', mockFetchOnce([]));
    const source = makeSource();
    const milestone = await source.getActiveMilestone();
    expect(milestone).toBeNull();
  });

  it('returns the open milestone with the lowest number', async () => {
    const milestones = [
      { number: 3, title: 'M3', description: null, due_on: null, state: 'open' },
      {
        number: 1,
        title: 'M1',
        description: 'Bootstrap',
        due_on: '2024-06-01T00:00:00Z',
        state: 'open',
      },
      { number: 2, title: 'M2', description: null, due_on: null, state: 'open' },
    ];

    vi.stubGlobal('fetch', mockFetchOnce(milestones));
    const source = makeSource();
    const ms = await source.getActiveMilestone();

    if (ms == null) throw new Error('expected a milestone');
    expect(ms.number).toBe(1);
    expect(ms.title).toBe('M1');
    expect(ms.description).toBe('Bootstrap');
    expect(ms.isActive).toBe(true);
    expect(ms.dueOn).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// dependsOn parsing
// ---------------------------------------------------------------------------

describe('dependsOn parsing', () => {
  it('parses "Depends on: #5" from issue body', async () => {
    const issues = [
      makeIssue({
        number: 6,
        body: 'Some intro.\n\nDepends on: #5\n\nMore text.',
      }),
    ];

    vi.stubGlobal('fetch', mockFetchOnce(issues));
    const source = makeSource();
    const items = await source.listOpenWork();

    expect(items[0].dependsOn).toEqual(['5']);
  });

  it('parses owner/repo#N format in dependsOn', async () => {
    const issues = [
      makeIssue({
        number: 7,
        body: 'Depends on: shaunnez/other-repo#12, #3',
      }),
    ];

    vi.stubGlobal('fetch', mockFetchOnce(issues));
    const source = makeSource();
    const items = await source.listOpenWork();

    expect(items[0].dependsOn).toEqual(['12', '3']);
  });

  it('parses "Depends on #5" without colon (actual GitHub issue format)', async () => {
    const issues = [
      makeIssue({
        number: 9,
        body: 'Some intro.\n\nDepends on #5\n\nMore text.',
      }),
    ];

    vi.stubGlobal('fetch', mockFetchOnce(issues));
    const source = makeSource();
    const items = await source.listOpenWork();

    expect(items[0].dependsOn).toEqual(['5']);
  });

  it('parses "Depends-On #5" hyphen variant', async () => {
    const issues = [
      makeIssue({
        number: 10,
        body: 'Depends-On #5',
      }),
    ];

    vi.stubGlobal('fetch', mockFetchOnce(issues));
    const source = makeSource();
    const items = await source.listOpenWork();

    expect(items[0].dependsOn).toEqual(['5']);
  });

  it('parses Blocks: from issue body', async () => {
    const issues = [
      makeIssue({
        number: 8,
        body: 'Blocks: #9\nDepends on: #2',
      }),
    ];

    vi.stubGlobal('fetch', mockFetchOnce(issues));
    const source = makeSource();
    const items = await source.listOpenWork();

    expect(items[0].blocks).toEqual(['9']);
    expect(items[0].dependsOn).toEqual(['2']);
  });
});

// ---------------------------------------------------------------------------
// listClosedWorkByMilestone
// ---------------------------------------------------------------------------

describe('listClosedWorkByMilestone', () => {
  it('fetches closed issues for the given milestone number', async () => {
    const closedIssues = [
      makeIssue({
        number: 20,
        title: 'Done feature',
        labels: [{ name: 'factory:done' }],
        milestone: { number: 2, title: 'M2', description: null, due_on: null, state: 'closed' },
      }),
      makeIssue({
        number: 21,
        title: 'Archived chore',
        labels: [{ name: 'factory:archived' }, { name: 'type:chore' }],
        milestone: { number: 2, title: 'M2', description: null, due_on: null, state: 'closed' },
      }),
    ];

    vi.stubGlobal(
      'fetch',
      mockFetchByUrl((url) => {
        expect(url).toContain('state=closed');
        expect(url).toContain('milestone=2');
        return new Response(JSON.stringify(closedIssues), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    const source = makeSource();
    const items = await source.listClosedWorkByMilestone(2);

    expect(items).toHaveLength(2);
    expect(items[0].externalId).toBe('20');
    expect(items[0].state).toBe('factory:done');
    expect(items[1].externalId).toBe('21');
    expect(items[1].type).toBe('chore');
  });

  it('filters out pull requests from closed issues', async () => {
    const mixed = [
      makeIssue({ number: 30, labels: [{ name: 'factory:done' }] }),
      { ...makeIssue({ number: 31 }), pull_request: {} },
    ];

    vi.stubGlobal(
      'fetch',
      mockFetchByUrl(
        () =>
          new Response(JSON.stringify(mixed), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    const source = makeSource();
    const items = await source.listClosedWorkByMilestone(2);
    expect(items).toHaveLength(1);
    expect(items[0].externalId).toBe('30');
  });
});

// ---------------------------------------------------------------------------
// forceState
// ---------------------------------------------------------------------------

describe('forceState', () => {
  it('atomically replaces all factory:* labels with the target via a single PUT, preserving non-factory labels', async () => {
    const existingLabels = [
      { name: 'factory:in-progress' },
      { name: 'factory:needs-qa' }, // a stray second factory label — must also be dropped
      { name: 'type:feature' },
      { name: 'priority:high' },
    ];

    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify(existingLabels), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (method === 'PUT') {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });

    vi.stubGlobal('fetch', fetchMock);

    const source = makeSource();
    await source.forceState('github:shaunnez/goose-hub#10', 'factory:archived');

    // No DELETE or POST calls — the operation must use a single PUT.
    const methodCounts = fetchMock.mock.calls.reduce(
      (acc, [, init]) => {
        const m = (init?.method ?? 'GET').toUpperCase();
        acc[m] = (acc[m] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    expect(methodCounts.DELETE ?? 0).toBe(0);
    expect(methodCounts.POST ?? 0).toBe(0);
    expect(methodCounts.PUT).toBe(1);

    const putCall = fetchMock.mock.calls.find(
      ([, init]) => (init?.method ?? 'GET').toUpperCase() === 'PUT',
    );
    if (putCall == null) throw new Error('expected a PUT call');
    const putBody = JSON.parse(putCall[1].body as string) as { labels: string[] };
    expect(putBody.labels).toContain('factory:archived');
    expect(putBody.labels).toContain('type:feature');
    expect(putBody.labels).toContain('priority:high');
    expect(putBody.labels).not.toContain('factory:in-progress');
    expect(putBody.labels).not.toContain('factory:needs-qa');
  });

  it('works with a plain issue number as itemId', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const source = makeSource();
    await expect(source.forceState('42', 'factory:done')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Auth failure
// ---------------------------------------------------------------------------

describe('auth failure', () => {
  it('throws a clear error on 401 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Bad credentials' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const source = makeSource();
    await expect(source.listOpenWork()).rejects.toThrow('authentication failed');
  });
});

// ---------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------

describe('rate limit', () => {
  it('throws on 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('', {
          status: 429,
          headers: { 'X-RateLimit-Remaining': '0' },
        }),
      ),
    );

    const source = makeSource();
    await expect(source.listOpenWork()).rejects.toThrow('rate limit');
  });

  it('throws on 403 with X-RateLimit-Remaining: 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('', {
          status: 403,
          headers: { 'X-RateLimit-Remaining': '0' },
        }),
      ),
    );

    const source = makeSource();
    await expect(source.listOpenWork()).rejects.toThrow('rate limit');
  });
});

// ---------------------------------------------------------------------------
// listWorkByMilestone
// ---------------------------------------------------------------------------

describe('listWorkByMilestone', () => {
  it('fetches all-state issues for the given milestone', async () => {
    const issues = [
      makeIssue({
        number: 60,
        title: 'Open feature',
        labels: [{ name: 'factory:in-progress' }],
        milestone: { number: 3, title: 'M3', description: null, due_on: null, state: 'open' },
      }),
      makeIssue({
        number: 61,
        title: 'Done chore',
        labels: [{ name: 'factory:done' }, { name: 'type:chore' }],
        milestone: { number: 3, title: 'M3', description: null, due_on: null, state: 'open' },
      }),
    ];

    vi.stubGlobal(
      'fetch',
      mockFetchByUrl((url) => {
        expect(url).toContain('state=all');
        expect(url).toContain('milestone=3');
        return new Response(JSON.stringify(issues), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    const source = makeSource();
    const items = await source.listWorkByMilestone(3);
    expect(items).toHaveLength(2);
    expect(items[0].externalId).toBe('60');
    expect(items[1].type).toBe('chore');
  });

  it('filters out pull requests', async () => {
    const mixed = [makeIssue({ number: 62 }), { ...makeIssue({ number: 63 }), pull_request: {} }];

    vi.stubGlobal(
      'fetch',
      mockFetchByUrl(
        () =>
          new Response(JSON.stringify(mixed), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    const source = makeSource();
    const items = await source.listWorkByMilestone(3);
    expect(items).toHaveLength(1);
    expect(items[0].externalId).toBe('62');
  });
});

// ---------------------------------------------------------------------------
// getItem
// ---------------------------------------------------------------------------

describe('getItem', () => {
  it('fetches a single issue by its full id (github:owner/repo#N)', async () => {
    const issue = makeIssue({
      number: 42,
      title: 'Single item',
      labels: [{ name: 'factory:accepted' }],
    });

    vi.stubGlobal(
      'fetch',
      mockFetchByUrl((url) => {
        expect(url).toContain('/issues/42');
        return new Response(JSON.stringify(issue), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    const source = makeSource();
    const item = await source.getItem('github:shaunnez/goose-hub#42');
    expect(item.externalId).toBe('42');
    expect(item.title).toBe('Single item');
  });

  it('fetches a single issue by its plain number string', async () => {
    const issue = makeIssue({ number: 7, title: 'Plain number' });

    vi.stubGlobal(
      'fetch',
      mockFetchByUrl((url) => {
        expect(url).toContain('/issues/7');
        return new Response(JSON.stringify(issue), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    const source = makeSource();
    const item = await source.getItem('7');
    expect(item.externalId).toBe('7');
  });
});

// ---------------------------------------------------------------------------
// listMilestones
// ---------------------------------------------------------------------------

describe('listMilestones', () => {
  it('returns all milestones filtered through mapGithubMilestone', async () => {
    const milestones = [
      {
        number: 1,
        title: 'M1',
        description: 'First',
        due_on: '2024-03-01T00:00:00Z',
        state: 'closed',
      },
      { number: 2, title: 'M2', description: null, due_on: null, state: 'open' },
    ];

    vi.stubGlobal('fetch', mockFetchOnce(milestones));

    const source = makeSource();
    const result = await source.listMilestones();
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('1');
    expect(result[0].isActive).toBe(false);
    expect(result[0].dueOn).toBeInstanceOf(Date);
    expect(result[1].isActive).toBe(true);
    expect(result[1].dueOn).toBeUndefined();
  });

  it('filters out milestones that do not match M<n> prefix ([E2E], Backlog, etc.)', async () => {
    const milestones = [
      { number: 1, title: 'M1', description: null, due_on: null, state: 'open' },
      { number: 2, title: '[E2E] test milestone', description: null, due_on: null, state: 'open' },
      { number: 3, title: 'Backlog', description: null, due_on: null, state: 'open' },
    ];

    vi.stubGlobal('fetch', mockFetchOnce(milestones));

    const source = makeSource();
    const result = await source.listMilestones();
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('M1');
  });

  it('sorts milestones by M-prefix number ascending, not by GitHub id', async () => {
    // GitHub numbers are in reverse creation order — M10 has id=1, M2 has id=2.
    // The list must come back M2 before M10.
    const milestones = [
      { number: 1, title: 'M10: Late', description: null, due_on: null, state: 'open' },
      { number: 2, title: 'M2: Early', description: null, due_on: null, state: 'open' },
      { number: 3, title: 'M9: Middle', description: null, due_on: null, state: 'open' },
    ];

    vi.stubGlobal('fetch', mockFetchOnce(milestones));

    const source = makeSource();
    const result = await source.listMilestones();
    expect(result.map((m) => m.title)).toEqual(['M2: Early', 'M9: Middle', 'M10: Late']);
  });
});

// ---------------------------------------------------------------------------
// transitionState
// ---------------------------------------------------------------------------

describe('transitionState', () => {
  it('atomically replaces the old state label with the new one via a single PUT, preserving non-factory labels', async () => {
    const existingLabels = [
      { name: 'factory:triaging' },
      { name: 'type:feature' },
      { name: 'priority:high' },
      { name: 'schedule:current' },
    ];

    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify(existingLabels), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (method === 'PUT') {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });

    vi.stubGlobal('fetch', fetchMock);

    const source = makeSource();
    await expect(
      source.transitionState('github:shaunnez/goose-hub#5', 'factory:triaging', 'factory:accepted'),
    ).resolves.toBeUndefined();

    // No DELETE or POST — the transition must be a single atomic PUT (no
    // intermediate window where the conflict-resolver could see zero state
    // labels and default to factory:triaging).
    const methodCounts = fetchMock.mock.calls.reduce(
      (acc, [, init]) => {
        const m = (init?.method ?? 'GET').toUpperCase();
        acc[m] = (acc[m] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    expect(methodCounts.DELETE ?? 0).toBe(0);
    expect(methodCounts.POST ?? 0).toBe(0);
    expect(methodCounts.PUT).toBe(1);

    const putCall = fetchMock.mock.calls.find(
      ([, init]) => (init?.method ?? 'GET').toUpperCase() === 'PUT',
    );
    if (putCall == null) throw new Error('expected a PUT call');
    const body = JSON.parse(putCall[1].body as string) as { labels: string[] };
    expect(body.labels).toContain('factory:accepted');
    expect(body.labels).not.toContain('factory:triaging');
    expect(body.labels).toContain('type:feature');
    expect(body.labels).toContain('priority:high');
    expect(body.labels).toContain('schedule:current');
  });

  it('throws on an illegal transition', async () => {
    const source = makeSource();
    // factory:done -> factory:triaging is not a legal transition
    await expect(source.transitionState('42', 'factory:done', 'factory:triaging')).rejects.toThrow(
      'Illegal transition',
    );
  });

  it('is idempotent when the from-label is already absent', async () => {
    // Simulate a re-run where the previous transition partially landed: the
    // from-label is gone, but the to-label has not yet been added.
    const existingLabels = [{ name: 'type:feature' }];

    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify(existingLabels), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (method === 'PUT') {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });

    vi.stubGlobal('fetch', fetchMock);

    const source = makeSource();
    await expect(
      source.transitionState('5', 'factory:triaging', 'factory:accepted'),
    ).resolves.toBeUndefined();

    const putCall = fetchMock.mock.calls.find(
      ([, init]) => (init?.method ?? 'GET').toUpperCase() === 'PUT',
    );
    if (putCall == null) throw new Error('expected a PUT call');
    const body = JSON.parse(putCall[1].body as string) as { labels: string[] };
    expect(body.labels).toContain('factory:accepted');
    expect(body.labels).toContain('type:feature');
  });

  it('throws when reading current labels fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 500, statusText: 'Internal Server Error' }));

    vi.stubGlobal('fetch', fetchMock);

    const source = makeSource();
    await expect(
      source.transitionState('5', 'factory:triaging', 'factory:accepted'),
    ).rejects.toThrow('GitHub API error: 500');
  });

  it('throws when writing the new label set fails', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (method === 'PUT') {
        return Promise.resolve(
          new Response('', { status: 422, statusText: 'Unprocessable Entity' }),
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });

    vi.stubGlobal('fetch', fetchMock);

    const source = makeSource();
    await expect(
      source.transitionState('5', 'factory:triaging', 'factory:accepted'),
    ).rejects.toThrow('Failed to set label');
  });

  it('posts a comment when a note is supplied, after the atomic label PUT', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (method === 'PUT' || method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });

    vi.stubGlobal('fetch', fetchMock);

    const source = makeSource();
    await source.transitionState(
      '5',
      'factory:triaging',
      'factory:accepted',
      'Transitioned by agent',
    );

    // Exactly one POST — the comment.
    const postCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init?.method ?? 'GET').toUpperCase() === 'POST',
    );
    expect(postCalls).toHaveLength(1);
    const commentBody = JSON.parse(postCalls[0][1].body as string) as { body: string };
    expect(commentBody.body).toBe('Transitioned by agent');
  });
});

// ---------------------------------------------------------------------------
// comment
// ---------------------------------------------------------------------------

describe('comment', () => {
  it('posts a comment to the given issue', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const source = makeSource();
    await expect(source.comment('github:shaunnez/goose-hub#10', 'hello')).resolves.toBeUndefined();

    const call = fetchMock.mock.calls[0];
    expect(call[0]).toContain('/issues/10/comments');
    const body = JSON.parse(call[1].body as string) as { body: string };
    expect(body.body).toBe('hello');
  });

  it('throws when the comment POST fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 403, statusText: 'Forbidden' })),
    );

    const source = makeSource();
    await expect(source.comment('10', 'fail')).rejects.toThrow('Failed to post comment');
  });
});

// ---------------------------------------------------------------------------
// setMilestone
// ---------------------------------------------------------------------------

describe('setMilestone', () => {
  it('sends a PATCH request with the milestone number', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const source = makeSource();
    await expect(source.setMilestone('github:shaunnez/goose-hub#10', 3)).resolves.toBeUndefined();

    const call = fetchMock.mock.calls[0];
    expect(call[0]).toContain('/issues/10');
    expect(call[1].method).toBe('PATCH');
    const body = JSON.parse(call[1].body as string) as { milestone: number };
    expect(body.milestone).toBe(3);
  });

  it('sends null to clear the milestone', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const source = makeSource();
    await source.setMilestone('10', null);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { milestone: null };
    expect(body.milestone).toBeNull();
  });

  it('throws when the PATCH fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 404, statusText: 'Not Found' })),
    );

    const source = makeSource();
    await expect(source.setMilestone('10', 1)).rejects.toThrow('Failed to set milestone');
  });
});

// ---------------------------------------------------------------------------
// setLabelInGroup
// ---------------------------------------------------------------------------

describe('setLabelInGroup', () => {
  it('removes old group labels and adds the new value', async () => {
    const existingLabels = [
      { name: 'priority:medium' },
      { name: 'type:feature' },
      { name: 'factory:accepted' },
    ];

    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify(existingLabels), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (method === 'DELETE') {
        return Promise.resolve(new Response('', { status: 200 }));
      }
      if (method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });

    vi.stubGlobal('fetch', fetchMock);

    const source = makeSource();
    await source.setLabelInGroup('10', 'priority', 'high');

    const deleteCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init?.method ?? 'GET').toUpperCase() === 'DELETE',
    );
    // Only 'priority:medium' should be deleted — not type or factory labels
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][0]).toContain('priority%3Amedium');

    const postCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init?.method ?? 'GET').toUpperCase() === 'POST',
    );
    const body = JSON.parse(postCalls[0][1].body as string) as { labels: string[] };
    expect(body.labels).toContain('priority:high');
  });

  it('throws when removing an old group label fails with non-404', async () => {
    const existingLabels = [{ name: 'schedule:current' }];

    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify(existingLabels), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (method === 'DELETE') {
        return Promise.resolve(
          new Response('', { status: 500, statusText: 'Internal Server Error' }),
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });

    vi.stubGlobal('fetch', fetchMock);

    const source = makeSource();
    await expect(source.setLabelInGroup('10', 'schedule', 'next')).rejects.toThrow(
      'Failed to remove label',
    );
  });

  it('throws when adding the new group label fails', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (method === 'POST') {
        return Promise.resolve(
          new Response('', { status: 422, statusText: 'Unprocessable Entity' }),
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });

    vi.stubGlobal('fetch', fetchMock);

    const source = makeSource();
    await expect(source.setLabelInGroup('10', 'type', 'bug')).rejects.toThrow(
      'Failed to add label',
    );
  });
});

// ---------------------------------------------------------------------------
// createIssue
// ---------------------------------------------------------------------------

describe('createIssue', () => {
  it('creates an issue with default labels and returns the mapped WorkItem', async () => {
    const createdIssue = makeIssue({
      number: 99,
      title: 'New feature',
      labels: [
        { name: 'factory:triaging' },
        { name: 'type:feature' },
        { name: 'priority:medium' },
        { name: 'schedule:later' },
        { name: 'mode:supervised' },
        { name: 'exec:serial' },
      ],
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(createdIssue), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const source = makeSource();
    const item = await source.createIssue({ title: 'New feature', body: '' });

    expect(item.externalId).toBe('99');
    expect(item.title).toBe('New feature');
    expect(item.state).toBe('factory:triaging');

    const call = fetchMock.mock.calls[0];
    expect(call[1].method).toBe('POST');
    const body = JSON.parse(call[1].body as string) as { title: string; labels: string[] };
    expect(body.title).toBe('New feature');
    expect(body.labels).toContain('factory:triaging');
  });

  it('uses provided type and priority', async () => {
    const createdIssue = makeIssue({ number: 100, title: 'Bug report', labels: [] });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(createdIssue), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const source = makeSource();
    await source.createIssue({ title: 'Bug report', body: '', type: 'bug', priority: 'critical' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { labels: string[] };
    expect(body.labels).toContain('type:bug');
    expect(body.labels).toContain('priority:critical');
  });

  it('throws when the create request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('', { status: 422, statusText: 'Unprocessable Entity' })),
    );

    const source = makeSource();
    await expect(source.createIssue({ title: 'Bad issue', body: '' })).rejects.toThrow(
      'Failed to create issue',
    );
  });
});

// ---------------------------------------------------------------------------
// listComments
// ---------------------------------------------------------------------------

describe('listComments', () => {
  it('fetches and maps comments for an issue', async () => {
    const rawComments = [
      {
        id: 1,
        body: 'First comment',
        user: { login: 'alice' },
        created_at: '2024-01-01T00:00:00Z',
      },
      { id: 2, body: 'Second comment', user: null, created_at: '2024-01-02T00:00:00Z' },
    ];

    vi.stubGlobal('fetch', mockFetchOnce(rawComments));

    const source = makeSource();
    const comments = await source.listComments('github:shaunnez/goose-hub#10');

    expect(comments).toHaveLength(2);
    expect(comments[0].id).toBe(1);
    expect(comments[0].body).toBe('First comment');
    expect(comments[0].authorLogin).toBe('alice');
    expect(comments[1].authorLogin).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// attach and watchForUpdates (not-implemented stubs)
// ---------------------------------------------------------------------------

describe('not-implemented stubs', () => {
  it('attach throws "not implemented"', async () => {
    const source = makeSource();
    await expect(source.attach('10', { kind: 'file', url: 'https://example.com' })).rejects.toThrow(
      'not implemented',
    );
  });

  it('watchForUpdates throws "not implemented"', async () => {
    const source = makeSource();
    await expect(source.watchForUpdates(() => {})).rejects.toThrow('not implemented');
  });
});

// ---------------------------------------------------------------------------
// ghFetch — rate limit with reset timestamp
// ---------------------------------------------------------------------------

describe('ghFetch — rate limit reset timestamp', () => {
  it('includes the reset time in the error message when X-RateLimit-Reset is present', async () => {
    const resetEpoch = String(Math.floor(Date.now() / 1000) + 3600);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('', {
          status: 429,
          headers: {
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': resetEpoch,
          },
        }),
      ),
    );

    const source = makeSource();
    await expect(source.listOpenWork()).rejects.toThrow('resets at');
  });

  it('throws a generic API error on non-rate-limit, non-auth failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 404, statusText: 'Not Found' })),
    );

    const source = makeSource();
    await expect(source.listOpenWork()).rejects.toThrow('GitHub API error: 404');
  });
});

// ---------------------------------------------------------------------------
// forceState — error handling
// ---------------------------------------------------------------------------

describe('forceState — error handling', () => {
  it('throws when the atomic label PUT fails', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (method === 'PUT') {
        return Promise.resolve(
          new Response('', { status: 422, statusText: 'Unprocessable Entity' }),
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });

    vi.stubGlobal('fetch', fetchMock);

    const source = makeSource();
    await expect(source.forceState('10', 'factory:archived')).rejects.toThrow(
      'Failed to set label',
    );
  });

  it('throws when reading current labels fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 500, statusText: 'Server Error' }));

    vi.stubGlobal('fetch', fetchMock);

    const source = makeSource();
    await expect(source.forceState('10', 'factory:archived')).rejects.toThrow(
      'GitHub API error: 500',
    );
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('github-labels — edge cases', () => {
  it('sets authorIsOwner to false when user is null', async () => {
    // The GithubIssue interface allows user: null; cast to bypass the helper's stricter type.
    const issue = {
      ...makeIssue({ number: 50, title: 'Anonymous issue', labels: [] }),
      user: null,
    } as ReturnType<typeof makeIssue> & { user: null };
    const issues = [issue];

    vi.stubGlobal('fetch', mockFetchOnce(issues));
    const source = makeSource();
    const items = await source.listOpenWork();

    const item = items.find((i) => i.externalId === '50');
    if (item == null) throw new Error('expected item 50');
    expect(item.authorIsOwner).toBe(false);
  });

  it('parseRefs returns empty array for empty body', async () => {
    const issues = [
      makeIssue({
        number: 51,
        body: '',
        labels: [],
      }),
    ];

    vi.stubGlobal('fetch', mockFetchOnce(issues));
    const source = makeSource();
    const items = await source.listOpenWork();

    const item = items.find((i) => i.externalId === '51');
    if (item == null) throw new Error('expected item 51');
    expect(item.dependsOn).toEqual([]);
    expect(item.blocks).toEqual([]);
  });

  it('issue without any state label falls back to factory:triaging', async () => {
    const issues = [
      makeIssue({
        number: 52,
        labels: [],
      }),
    ];

    vi.stubGlobal('fetch', mockFetchOnce(issues));
    const source = makeSource();
    const items = await source.listOpenWork();

    const item = items.find((i) => i.externalId === '52');
    if (item == null) throw new Error('expected item 52');
    expect(item.state).toBe('factory:triaging');
  });

  it('type label missing falls back to feature', async () => {
    const issues = [
      makeIssue({
        number: 53,
        labels: [{ name: 'factory:accepted' }],
      }),
    ];

    vi.stubGlobal('fetch', mockFetchOnce(issues));
    const source = makeSource();
    const items = await source.listOpenWork();

    const item = items.find((i) => i.externalId === '53');
    if (item == null) throw new Error('expected item 53');
    expect(item.type).toBe('feature');
  });

  it('priority label missing falls back to medium', async () => {
    const issues = [
      makeIssue({
        number: 54,
        labels: [{ name: 'factory:accepted' }, { name: 'type:bug' }],
      }),
    ];

    vi.stubGlobal('fetch', mockFetchOnce(issues));
    const source = makeSource();
    const items = await source.listOpenWork();

    const item = items.find((i) => i.externalId === '54');
    if (item == null) throw new Error('expected item 54');
    expect(item.priority).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// listOpenWork — milestone filtering and milestoneTitle mapping
// ---------------------------------------------------------------------------

describe('listOpenWork — milestone parameter', () => {
  it('includes milestone query param when milestoneNumber is provided', async () => {
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        capturedUrl = url;
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }),
    );

    const source = makeSource();
    await source.listOpenWork(7);

    expect(capturedUrl).toContain('milestone=7');
  });

  it('omits milestone query param when milestoneNumber is undefined', async () => {
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        capturedUrl = url;
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }),
    );

    const source = makeSource();
    await source.listOpenWork();

    expect(capturedUrl).not.toContain('milestone=');
  });

  it('maps issue.milestone.title to milestoneTitle on work items', async () => {
    const issue = makeIssue({
      number: 100,
      milestone: {
        number: 10,
        title: 'M10: Multi-project Orchestration',
        description: null,
        due_on: null,
        state: 'open',
      },
    });
    vi.stubGlobal('fetch', mockFetchOnce([issue]));
    const source = makeSource();
    const items = await source.listOpenWork();

    const item = items.find((i) => i.externalId === '100');
    if (item == null) throw new Error('expected item 100');
    expect(item.milestoneTitle).toBe('M10: Multi-project Orchestration');
    expect(item.milestoneId).toBe('10');
  });

  it('leaves milestoneTitle undefined when issue has no milestone', async () => {
    const issue = makeIssue({ number: 101, milestone: null });
    vi.stubGlobal('fetch', mockFetchOnce([issue]));
    const source = makeSource();
    const items = await source.listOpenWork();

    const item = items.find((i) => i.externalId === '101');
    if (item == null) throw new Error('expected item 101');
    expect(item.milestoneTitle).toBeUndefined();
  });
});
