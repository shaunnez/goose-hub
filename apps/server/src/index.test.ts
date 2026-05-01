import { describe, expect, it, vi } from 'vitest';
import { app } from './index.js';

// Mock the event store so appendEvent is a no-op in tests.
vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: { appendEvent: vi.fn(), replay: vi.fn().mockReturnValue([]) },
}));

// Mock the db for the POST /inbox route. The route awaits .returning() and
// destructures [item] from the result. A plain array resolves immediately
// when awaited (non-Promises do), and array destructuring works natively.
vi.mock('@goose-hub/core/db/db.js', () => {
  const inboxRow = {
    id: 1,
    title: 'Test idea',
    body: '',
    type: 'feature',
    createdAt: '2026-05-01 00:00:00',
  };
  return {
    db: {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([inboxRow]),
        }),
      }),
    },
  };
});

vi.mock('@goose-hub/core/db/schema.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@goose-hub/core/db/schema.js')>();
  return { ...actual };
});

vi.mock('./source.js', () => ({
  getSourceForSlug: vi.fn().mockResolvedValue({
    repoRef: 'owner/repo',
    comment: vi.fn().mockResolvedValue(undefined),
    listComments: vi.fn().mockResolvedValue([]),
    setMilestone: vi.fn().mockResolvedValue(undefined),
    setLabelInGroup: vi.fn().mockResolvedValue(undefined),
    transitionState: vi.fn().mockResolvedValue(undefined),
    listOpenWork: vi.fn().mockResolvedValue([]),
    listClosedWorkByMilestone: vi.fn().mockResolvedValue([
      {
        id: 'github:owner/repo#5',
        externalId: '5',
        repoRef: 'owner/repo',
        title: 'Done item',
        body: '',
        type: 'feature',
        priority: 'medium',
        mode: 'supervised',
        state: 'factory:done',
        authorIsOwner: true,
        milestoneId: '3',
        schedule: 'current',
        exec: 'parallel',
        dependsOn: [],
        blocks: [],
        createdAt: new Date('2024-01-01'),
      },
    ]),
    listWorkByMilestone: vi.fn().mockResolvedValue([
      {
        id: 'github:owner/repo#5',
        externalId: '5',
        repoRef: 'owner/repo',
        title: 'Done item',
        body: '',
        type: 'feature',
        priority: 'medium',
        mode: 'supervised',
        state: 'factory:done',
        authorIsOwner: true,
        milestoneId: '3',
        schedule: 'current',
        exec: 'parallel',
        dependsOn: [],
        blocks: [],
        createdAt: new Date('2024-01-01'),
      },
      {
        id: 'github:owner/repo#6',
        externalId: '6',
        repoRef: 'owner/repo',
        title: 'Open item',
        body: '',
        type: 'feature',
        priority: 'medium',
        mode: 'supervised',
        state: 'factory:in-progress',
        authorIsOwner: true,
        milestoneId: '3',
        schedule: 'current',
        exec: 'parallel',
        dependsOn: [],
        blocks: [],
        createdAt: new Date('2024-01-02'),
      },
    ]),
  }),
}));

describe('POST /projects/:slug/issues/:id/fake-run', () => {
  it('returns 200 with ok and skill for a valid project', async () => {
    const res = await app.request('/projects/goose-hub-self/issues/1/fake-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill: 'triage' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; skill: string };
    expect(body.ok).toBe(true);
    expect(body.skill).toBe('triage');
  });

  it('defaults skill to triage when unrecognised value is sent', async () => {
    const res = await app.request('/projects/goose-hub-self/issues/1/fake-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill: 'unknown' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; skill: string };
    expect(body.skill).toBe('triage');
  });

  it('accepts investigate as skill', async () => {
    const res = await app.request('/projects/goose-hub-self/issues/1/fake-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill: 'investigate' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; skill: string };
    expect(body.skill).toBe('investigate');
  });

  it('returns 404 for unknown project', async () => {
    const { getSourceForSlug } = await import('./source.js');
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const res = await app.request('/projects/unknown/issues/1/fake-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill: 'triage' }),
    });
    expect(res.status).toBe(404);
  });

  it('attaches structured output to agent.terminated event for triage skill', async () => {
    vi.useFakeTimers();
    try {
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      vi.mocked(eventStore.appendEvent).mockClear();

      await app.request('/projects/goose-hub-self/issues/1/fake-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill: 'triage' }),
      });

      // Advance all fake timers so the fire-and-forget async IIFE completes.
      await vi.runAllTimersAsync();

      const calls = vi.mocked(eventStore.appendEvent).mock.calls;
      const terminatedCall = calls.find(([arg]) => arg.kind === 'agent.terminated');
      expect(terminatedCall).toBeDefined();
      const payload = terminatedCall?.[0].payload as { output: unknown };
      expect(payload.output).toEqual({ priority: 'high', type: 'feature', decision: 'accept' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('attaches structured output to agent.terminated event for investigate skill', async () => {
    vi.useFakeTimers();
    try {
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      vi.mocked(eventStore.appendEvent).mockClear();

      await app.request('/projects/goose-hub-self/issues/1/fake-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill: 'investigate' }),
      });

      await vi.runAllTimersAsync();

      const calls = vi.mocked(eventStore.appendEvent).mock.calls;
      const terminatedCall = calls.find(([arg]) => arg.kind === 'agent.terminated');
      expect(terminatedCall).toBeDefined();
      const payload = terminatedCall?.[0].payload as { output: unknown };
      expect(payload.output).toEqual({
        findings: 'Root cause identified',
        confidence: 'high',
        recommendation: 'fix in core',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits agent.log events with line payloads in the async sequence', async () => {
    vi.useFakeTimers();
    try {
      const { eventStore } = await import('@goose-hub/core/event-stream/store.js');
      vi.mocked(eventStore.appendEvent).mockClear();

      await app.request('/projects/goose-hub-self/issues/99/fake-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill: 'triage' }),
      });

      // Flush the async IIFE (runs with setTimeout delays — advance fake timers)
      await vi.runAllTimersAsync();

      const calls = vi.mocked(eventStore.appendEvent).mock.calls;
      const logCalls = calls.filter((c) => c[0].kind === 'agent.log');
      expect(logCalls.length).toBeGreaterThanOrEqual(3);
      expect(logCalls.length).toBeLessThanOrEqual(5);
      for (const [arg] of logCalls) {
        expect(arg.payload).toMatchObject({ line: expect.any(String) });
      }

      // Verify ordering: spawned first, terminated last
      const kinds = calls.map((c) => c[0].kind);
      expect(kinds[0]).toBe('agent.spawned');
      expect(kinds[kinds.length - 1]).toBe('agent.terminated');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('GET /projects/:slug/milestones/:milestone/closed-issues', () => {
  it('returns closed work items for the milestone', async () => {
    const res = await app.request('/projects/goose-hub-self/milestones/3/closed-issues');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(1);
  });

  it('returns 400 for a non-numeric milestone', async () => {
    const res = await app.request('/projects/goose-hub-self/milestones/abc/closed-issues');
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown project', async () => {
    const { getSourceForSlug } = await import('./source.js');
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const res = await app.request('/projects/unknown/milestones/3/closed-issues');
    expect(res.status).toBe(404);
  });
});

describe('GET /projects/:slug/milestones/:milestone/issues', () => {
  it('returns all work items (open and closed) for the milestone', async () => {
    const res = await app.request('/projects/goose-hub-self/milestones/3/issues');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(2);
  });

  it('returns 400 for a non-numeric milestone', async () => {
    const res = await app.request('/projects/goose-hub-self/milestones/abc/issues');
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown project', async () => {
    const { getSourceForSlug } = await import('./source.js');
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const res = await app.request('/projects/unknown/milestones/3/issues');
    expect(res.status).toBe(404);
  });
});

describe('POST /inbox', () => {
  it('returns 201 with the created item for a valid request', async () => {
    const res = await app.request('/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Great idea', body: 'details', type: 'feature' }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { item: { id: number; title: string } };
    expect(data.item.id).toBe(1);
    expect(data.item.title).toBe('Test idea');
  });

  it('returns 400 when title is missing', async () => {
    const res = await app.request('/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'no title here', type: 'bug' }),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('title is required');
  });

  it('returns 400 when title is only whitespace', async () => {
    const res = await app.request('/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '   ' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /projects/:slug/issues/:id/comment', () => {
  it('returns 200 when body is valid', async () => {
    const res = await app.request('/projects/goose-hub-self/issues/1/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'This is a comment' }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean };
    expect(data.ok).toBe(true);
  });

  it('returns 400 when body is empty', async () => {
    const res = await app.request('/projects/goose-hub-self/issues/1/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is only whitespace', async () => {
    const res = await app.request('/projects/goose-hub-self/issues/1/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown project', async () => {
    const { getSourceForSlug } = await import('./source.js');
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const res = await app.request('/projects/unknown/issues/1/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'hello' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /projects/:slug/issues/:id/set-label', () => {
  it('returns 200 for valid priority:high', async () => {
    const res = await app.request('/projects/goose-hub-self/issues/1/set-label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: 'priority', value: 'high' }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean };
    expect(data.ok).toBe(true);
  });

  it('returns 200 for valid schedule:current', async () => {
    const res = await app.request('/projects/goose-hub-self/issues/1/set-label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: 'schedule', value: 'current' }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid priority value', async () => {
    const res = await app.request('/projects/goose-hub-self/issues/1/set-label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: 'priority', value: 'urgent' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid schedule value', async () => {
    const res = await app.request('/projects/goose-hub-self/issues/1/set-label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: 'schedule', value: 'next' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for unknown group', async () => {
    const res = await app.request('/projects/goose-hub-self/issues/1/set-label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: 'type', value: 'bug' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown project', async () => {
    const { getSourceForSlug } = await import('./source.js');
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const res = await app.request('/projects/unknown/issues/1/set-label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: 'priority', value: 'high' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /projects/:slug/issues/:id/transition — state validation', () => {
  it('returns 400 when "from" is not a valid state name', async () => {
    const res = await app.request('/projects/goose-hub-self/issues/1/transition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'factory:fake-unknown', to: 'factory:triaging' }),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toMatch(/invalid.*state|unknown.*state/i);
  });

  it('returns 400 when "to" is not a valid state name', async () => {
    const res = await app.request('/projects/goose-hub-self/issues/1/transition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'factory:triaging', to: 'not-a-real-state' }),
    });
    expect(res.status).toBe(400);
  });
});
