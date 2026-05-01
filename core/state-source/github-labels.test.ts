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
  it('removes factory:* labels and adds the target, leaving non-factory labels alone', async () => {
    const existingLabels = [
      { name: 'factory:in-progress' },
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
    await source.forceState('github:shaunnez/goose-hub#10', 'factory:archived');

    // Collect all DELETE calls.
    const deletedUrls = fetchMock.mock.calls
      .filter(([, init]) => (init?.method ?? 'GET').toUpperCase() === 'DELETE')
      .map(([url]) => url as string);

    // Must have deleted factory:in-progress.
    expect(
      deletedUrls.some(
        (u) => u.includes('factory%3Ain-progress') || u.includes('factory:in-progress'),
      ),
    ).toBe(true);

    // Must NOT have deleted non-factory labels.
    expect(
      deletedUrls.some((u) => u.includes('type%3Afeature') || u.includes('type:feature')),
    ).toBe(false);
    expect(
      deletedUrls.some((u) => u.includes('priority%3Ahigh') || u.includes('priority:high')),
    ).toBe(false);

    // Must have posted the target label.
    const postCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init?.method ?? 'GET').toUpperCase() === 'POST',
    );
    expect(postCalls).toHaveLength(1);
    const postBody = JSON.parse(postCalls[0][1].body as string) as { labels: string[] };
    expect(postBody.labels).toContain('factory:archived');
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
