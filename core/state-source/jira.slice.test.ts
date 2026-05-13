import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_JIRA_STATE_MAP,
  factoryStateToJiraStatus,
  jiraStatusToState,
} from './jira-state-map.js';
import {
  type JiraIssueRaw,
  JiraStateSource,
  adfFromMarkdown,
  adfToText,
  parseJiraKey,
} from './jira.js';

const ENV_KEYS = ['JIRA_HOST', 'JIRA_USER', 'JIRA_API_TOKEN'] as const;

function withJiraEnv<T>(fn: () => T): T {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.JIRA_HOST = 'https://example.atlassian.net';
  process.env.JIRA_USER = 'agent@example.com';
  process.env.JIRA_API_TOKEN = 'token-xyz';
  try {
    return fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

function mkResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

function mkIssue(overrides: Partial<JiraIssueRaw['fields']> = {}, key = 'PROJ-1'): JiraIssueRaw {
  return {
    id: '10001',
    key,
    fields: {
      summary: 'A ticket',
      description: 'Body',
      issuetype: { name: 'Story' },
      priority: { name: 'Medium' },
      status: { name: 'To Do' },
      reporter: { accountId: 'acc-1', emailAddress: 'reporter@example.com' },
      created: '2026-05-01T00:00:00.000Z',
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// jira-state-map
// ---------------------------------------------------------------------------

describe('jira-state-map', () => {
  it('default mapping covers the documented Jira statuses', () => {
    expect(DEFAULT_JIRA_STATE_MAP['To Do']).toBe('factory:accepted');
    expect(DEFAULT_JIRA_STATE_MAP['In Progress']).toBe('factory:in-progress');
    expect(DEFAULT_JIRA_STATE_MAP['In Review']).toBe('factory:needs-review');
    expect(DEFAULT_JIRA_STATE_MAP.Done).toBe('factory:done');
    expect(DEFAULT_JIRA_STATE_MAP.Blocked).toBe('factory:needs-human');
  });

  it('jiraStatusToState applies per-project overrides over defaults', () => {
    const overrides = { Triage: 'factory:triaging' };
    expect(jiraStatusToState('Triage', overrides)).toBe('factory:triaging');
    // Default still wins for un-overridden statuses.
    expect(jiraStatusToState('Done', overrides)).toBe('factory:done');
  });

  it('unmapped status falls back to factory:accepted', () => {
    expect(jiraStatusToState('Some Custom Status')).toBe('factory:accepted');
  });

  it('factoryStateToJiraStatus reverse-maps a state', () => {
    expect(factoryStateToJiraStatus('factory:in-progress')).toBe('In Progress');
  });

  it('factoryStateToJiraStatus returns null for unmapped states', () => {
    expect(factoryStateToJiraStatus('factory:retrospecting')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseJiraKey
// ---------------------------------------------------------------------------

describe('parseJiraKey', () => {
  it('extracts the key from a normalised id', () => {
    expect(parseJiraKey('jira:PROJ#PROJ-42')).toBe('PROJ-42');
  });

  it('passes through a bare key', () => {
    expect(parseJiraKey('PROJ-42')).toBe('PROJ-42');
  });

  it('throws on garbage input', () => {
    expect(() => parseJiraKey('not-a-key')).toThrow(/Invalid Jira itemId/);
  });
});

// ---------------------------------------------------------------------------
// ADF helpers
// ---------------------------------------------------------------------------

describe('ADF helpers', () => {
  it('roundtrips plain text through ADF', () => {
    const doc = adfFromMarkdown('hello world');
    expect(adfToText(doc)).toBe('hello world');
  });

  it('flattens nested ADF documents', () => {
    const adf = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hello ' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'world' }] },
      ],
    };
    expect(adfToText(adf)).toBe('hello world');
  });

  it('tolerates legacy string description fields', () => {
    expect(adfToText('legacy plain string')).toBe('legacy plain string');
  });

  it('returns empty string for null/undefined', () => {
    expect(adfToText(null)).toBe('');
    expect(adfToText(undefined)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// JiraStateSource — env validation
// ---------------------------------------------------------------------------

describe('JiraStateSource — env validation', () => {
  it('throws when JIRA_HOST is missing', () => {
    const saved = process.env.JIRA_HOST;
    // biome-ignore lint/performance/noDelete: env restore for test isolation
    delete process.env.JIRA_HOST;
    process.env.JIRA_USER = 'u';
    process.env.JIRA_API_TOKEN = 't';
    try {
      expect(() => new JiraStateSource('p', 'PROJ')).toThrow(/JIRA_HOST/);
    } finally {
      if (saved !== undefined) process.env.JIRA_HOST = saved;
    }
  });

  it('throws when JIRA_USER is missing', () => {
    withJiraEnv(() => {
      // biome-ignore lint/performance/noDelete: env restore for test isolation
      delete process.env.JIRA_USER;
      expect(() => new JiraStateSource('p', 'PROJ')).toThrow(/JIRA_USER/);
    });
  });

  it('throws when JIRA_API_TOKEN is missing', () => {
    withJiraEnv(() => {
      // biome-ignore lint/performance/noDelete: env restore for test isolation
      delete process.env.JIRA_API_TOKEN;
      expect(() => new JiraStateSource('p', 'PROJ')).toThrow(/JIRA_API_TOKEN/);
    });
  });
});

// ---------------------------------------------------------------------------
// JiraStateSource — listOpenWork / getItem (cassette-driven)
// ---------------------------------------------------------------------------

describe('JiraStateSource — read paths against recorded cassettes', () => {
  it('listOpenWork maps Jira issues to WorkItems', async () => {
    await withJiraEnv(async () => {
      const fetchImpl = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        expect(url).toContain('/rest/api/3/search');
        expect(url).toContain('project%20%3D%20PROJ');
        expect(url).toContain('issuetype%20in');
        return mkResponse({
          issues: [
            mkIssue({}, 'PROJ-1'),
            mkIssue(
              {
                summary: 'A bug',
                issuetype: { name: 'Bug' },
                priority: { name: 'High' },
                status: { name: 'In Progress' },
              },
              'PROJ-2',
            ),
          ],
          total: 2,
          startAt: 0,
          maxResults: 50,
        });
      });
      const source = new JiraStateSource('p', 'PROJ', { fetchImpl });
      const items = await source.listOpenWork();
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({
        externalId: 'PROJ-1',
        id: 'jira:PROJ#PROJ-1',
        title: 'A ticket',
        type: 'feature',
        priority: 'medium',
        state: 'factory:accepted',
      });
      expect(items[1]).toMatchObject({
        externalId: 'PROJ-2',
        type: 'bug',
        priority: 'high',
        state: 'factory:in-progress',
      });
    });
  });

  it('getItem fetches a single Jira issue by key', async () => {
    await withJiraEnv(async () => {
      const fetchImpl = vi.fn(async (input: string | URL | Request) => {
        expect(String(input)).toContain('/rest/api/3/issue/PROJ-7');
        return mkResponse(mkIssue({ summary: 'specific', status: { name: 'Done' } }, 'PROJ-7'));
      });
      const source = new JiraStateSource('p', 'PROJ', { fetchImpl });
      const item = await source.getItem('jira:PROJ#PROJ-7');
      expect(item.title).toBe('specific');
      expect(item.state).toBe('factory:done');
    });
  });

  it('throws on auth failure', async () => {
    await withJiraEnv(async () => {
      const fetchImpl = vi.fn(async () => mkResponse({}, { status: 401 }));
      const source = new JiraStateSource('p', 'PROJ', { fetchImpl });
      await expect(source.listOpenWork()).rejects.toThrow(/authentication failed/);
    });
  });
});

// ---------------------------------------------------------------------------
// JiraStateSource — comment / transition / mutate paths
// ---------------------------------------------------------------------------

describe('JiraStateSource — write paths', () => {
  it('comment posts ADF body to Jira', async () => {
    await withJiraEnv(async () => {
      let captured: { url: string; body: unknown } | null = null;
      const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        captured = { url: String(input), body: JSON.parse(String(init?.body ?? '{}')) };
        return mkResponse({});
      });
      const source = new JiraStateSource('p', 'PROJ', { fetchImpl });
      await source.comment('jira:PROJ#PROJ-1', 'Hello');
      expect(captured).not.toBeNull();
      const body = (captured as unknown as { body: { body: { content: unknown[] } } }).body;
      expect(body.body.content).toHaveLength(1);
    });
  });

  it('transitionStatus looks up the transition id and POSTs it', async () => {
    await withJiraEnv(async () => {
      const calls: string[] = [];
      const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (url.includes('/transitions') && (init?.method ?? 'GET') === 'GET') {
          return mkResponse({
            transitions: [
              { id: '31', name: 'Start Progress', to: { name: 'In Progress' } },
              { id: '41', name: 'Done', to: { name: 'Done' } },
            ],
          });
        }
        if (url.includes('/transitions') && init?.method === 'POST') {
          const parsed = JSON.parse(String(init.body));
          expect(parsed.transition.id).toBe('31');
          return mkResponse({});
        }
        return mkResponse({});
      });
      const source = new JiraStateSource('p', 'PROJ', { fetchImpl });
      await source.transitionStatus('jira:PROJ#PROJ-1', 'factory:in-progress');
      expect(calls.some((c) => c.startsWith('POST') && c.includes('/transitions'))).toBe(true);
    });
  });

  it('transitionStatus logs and skips when no Jira status maps to the target factory state', async () => {
    await withJiraEnv(async () => {
      const fetchImpl = vi.fn(async () => mkResponse({}));
      const source = new JiraStateSource('p', 'PROJ', { fetchImpl });
      // factory:retrospecting has no default Jira mapping.
      await source.transitionStatus('jira:PROJ#PROJ-1', 'factory:retrospecting');
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  it('setMilestone is a no-op for Jira sources', async () => {
    await withJiraEnv(async () => {
      const fetchImpl = vi.fn(async () => mkResponse({}));
      const source = new JiraStateSource('p', 'PROJ', { fetchImpl });
      await source.setMilestone('jira:PROJ#PROJ-1', 7);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// JiraStateSource — milestones and listOpenWork pagination
// ---------------------------------------------------------------------------

describe('JiraStateSource — synthetic milestone + pagination', () => {
  it('returns a single synthetic milestone covering open + closed counts', async () => {
    await withJiraEnv(async () => {
      let call = 0;
      const fetchImpl = vi.fn(async () => {
        call += 1;
        if (call === 1) {
          return mkResponse({ issues: [mkIssue()], total: 1, startAt: 0, maxResults: 50 });
        }
        return mkResponse({
          issues: [mkIssue({ status: { name: 'Done' } })],
          total: 1,
          startAt: 0,
          maxResults: 50,
        });
      });
      const source = new JiraStateSource('p', 'PROJ', { fetchImpl });
      const milestones = await source.listMilestones();
      expect(milestones).toHaveLength(1);
      expect(milestones[0]).toMatchObject({
        title: 'Jira (synthetic)',
        isActive: true,
        openIssues: 1,
        closedIssues: 1,
      });
    });
  });
});
