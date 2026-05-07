import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── module mocks ──────────────────────────────────────────────────────────────

const mockDispatchTriageBatch = vi.fn().mockResolvedValue(undefined);
const mockDispatchForLabel = vi.fn().mockResolvedValue(undefined);
const mockGetSourceForSlug = vi.fn();
const mockGetItem = vi.fn();
// Note: legacy alias kept for unrelated assertions in this file.
const mockRunInvestigateWorkflow = vi.fn().mockResolvedValue(undefined);
void mockRunInvestigateWorkflow;

vi.mock('../../shared/dispatch.js', () => ({
  dispatchTriageBatch: mockDispatchTriageBatch,
  dispatchForLabel: mockDispatchForLabel,
  dispatchInvestigate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../shared/source.js', () => ({
  getSourceForSlug: mockGetSourceForSlug,
}));

vi.mock('@goose-hub/core/projects/loader.js', () => ({
  loadProjects: vi
    .fn()
    .mockResolvedValue([
      { id: 'goose-hub-self', slug: 'goose-hub-self', repos: ['shaunnez/goose-hub'] },
    ]),
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

function sign(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

const SECRET = 'test-webhook-secret';

async function postWebhook(
  body: string,
  {
    signature = sign(body, SECRET),
    event = 'issues',
    secret = SECRET,
  }: { signature?: string; event?: string; secret?: string } = {},
) {
  process.env.GITHUB_WEBHOOK_SECRET = secret;
  const { app } = await import('../../server.js');
  return app.request('/webhooks/github', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signature,
      'X-GitHub-Event': event,
    },
    body,
  });
}

function makeSource() {
  return { getItem: mockGetItem };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('POST /webhooks/github', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
    mockGetSourceForSlug.mockResolvedValue(makeSource());
    mockGetItem.mockResolvedValue({
      id: 'github:shaunnez/goose-hub#42',
      externalId: '42',
      type: 'bug',
      state: 'factory:investigating',
    });
  });

  it('returns 401 when X-Hub-Signature-256 header is missing', async () => {
    const { app } = await import('../../server.js');
    const res = await app.request('/webhooks/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'issues' },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 when signature is invalid', async () => {
    const res = await postWebhook('{"action":"opened"}', { signature: 'sha256=invalidsig' });
    expect(res.status).toBe(401);
  });

  it('returns 200 for unhandled event types', async () => {
    const body = JSON.stringify({ action: 'opened' });
    const res = await postWebhook(body, { event: 'push' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it('ignores issues events with unhandled action', async () => {
    const body = JSON.stringify({
      action: 'closed',
      repository: { full_name: 'shaunnez/goose-hub' },
    });
    const res = await postWebhook(body, { event: 'issues' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe('ignored');
  });

  // ─── issues.opened ──────────────────────────────────────────────────────────

  it('dispatches runTriageBatch for issues.opened on allowlisted repo', async () => {
    const body = JSON.stringify({
      action: 'opened',
      repository: { full_name: 'shaunnez/goose-hub' },
    });
    const res = await postWebhook(body, { event: 'issues' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; action: string };
    expect(json.ok).toBe(true);
    expect(json.action).toBe('dispatched');
  });

  it('ignores issues.opened for non-allowlisted repo', async () => {
    const body = JSON.stringify({
      action: 'opened',
      repository: { full_name: 'other/repo' },
    });
    const res = await postWebhook(body, { event: 'issues' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { action: string };
    expect(json.action).toBe('ignored');
  });

  // ─── issues.labeled — factory:investigating ─────────────────────────────────

  it('dispatches runInvestigateWorkflow for issues.labeled factory:investigating', async () => {
    const body = JSON.stringify({
      action: 'labeled',
      label: { name: 'factory:investigating' },
      issue: { number: 42 },
      repository: { full_name: 'shaunnez/goose-hub' },
    });
    const res = await postWebhook(body, { event: 'issues' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; action: string; label: string };
    expect(json.ok).toBe(true);
    expect(json.action).toBe('dispatched');
    expect(json.label).toBe('factory:investigating');
  });

  it('calls dispatchForLabel with the slug, issue number, and label (#207)', async () => {
    const body = JSON.stringify({
      action: 'labeled',
      label: { name: 'factory:investigating' },
      issue: { number: 42 },
      repository: { full_name: 'shaunnez/goose-hub' },
    });
    await postWebhook(body, { event: 'issues' });
    // The webhook handler delegates to the shared dispatcher rather than
    // importing the workflow directly (#207).
    await vi.waitFor(() =>
      expect(mockDispatchForLabel).toHaveBeenCalledWith(
        'goose-hub-self',
        42,
        'factory:investigating',
      ),
    );
  });

  // ─── issues.labeled — factory:triaging ──────────────────────────────────────

  it('dispatches runTriageBatch for issues.labeled factory:triaging', async () => {
    const body = JSON.stringify({
      action: 'labeled',
      label: { name: 'factory:triaging' },
      issue: { number: 7 },
      repository: { full_name: 'shaunnez/goose-hub' },
    });
    const res = await postWebhook(body, { event: 'issues' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { action: string; label: string };
    expect(json.action).toBe('dispatched');
    expect(json.label).toBe('factory:triaging');
  });

  // ─── issues.labeled — non-factory label ─────────────────────────────────────

  it('ignores issues.labeled for non-factory labels', async () => {
    const body = JSON.stringify({
      action: 'labeled',
      label: { name: 'priority:high' },
      issue: { number: 42 },
      repository: { full_name: 'shaunnez/goose-hub' },
    });
    const res = await postWebhook(body, { event: 'issues' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe('ignored-non-factory');
  });

  it('ignores issues.labeled for non-allowlisted repo', async () => {
    const body = JSON.stringify({
      action: 'labeled',
      label: { name: 'factory:investigating' },
      issue: { number: 42 },
      repository: { full_name: 'other/repo' },
    });
    const res = await postWebhook(body, { event: 'issues' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { action: string };
    expect(json.action).toBe('ignored');
  });
});

describe('handleGitHubWebhook — additional branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
    mockGetSourceForSlug.mockResolvedValue(makeSource());
  });

  it('returns 500 when GITHUB_WEBHOOK_SECRET env var is not configured', async () => {
    const savedSecret = process.env.GITHUB_WEBHOOK_SECRET;
    process.env.GITHUB_WEBHOOK_SECRET = '';
    try {
      const { app } = await import('../../server.js');
      const body = JSON.stringify({ action: 'opened' });
      const res = await app.request('/webhooks/github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': sign(body, SECRET),
          'X-GitHub-Event': 'issues',
        },
        body,
      });
      expect(res.status).toBe(500);
      const json = (await res.json()) as { error: string };
      expect(json.error).toContain('webhook secret not configured');
    } finally {
      process.env.GITHUB_WEBHOOK_SECRET = savedSecret;
    }
  });

  it('returns 400 when JSON body is malformed (issues event)', async () => {
    const rawBody = 'this is not json {{{';
    const res = await postWebhook(rawBody, { event: 'issues' });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain('invalid JSON');
  });

  it('returns no-issue-number when issues.labeled has no issue in payload', async () => {
    const body = JSON.stringify({
      action: 'labeled',
      label: { name: 'factory:dev-ready' },
      // No issue property
      repository: { full_name: 'shaunnez/goose-hub' },
    });
    const res = await postWebhook(body, { event: 'issues' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe('no-issue-number');
  });

  it('dispatchForLabel rejection is caught and response still succeeds', async () => {
    mockDispatchForLabel.mockRejectedValueOnce(new Error('dispatch error'));
    const body = JSON.stringify({
      action: 'labeled',
      label: { name: 'factory:dev-ready' },
      issue: { number: 55 },
      repository: { full_name: 'shaunnez/goose-hub' },
    });
    const res = await postWebhook(body, { event: 'issues' });
    expect(res.status).toBe(200);
  });

  it('issues event with no repository in payload returns ignored (line 57: repo ?? fallback)', async () => {
    // payload.repository is undefined — hits the ?? '' fallback on line 57
    // repo slug lookup returns undefined (not in REPO_TO_SLUG) → ignored
    const body = JSON.stringify({ action: 'opened' });
    const res = await postWebhook(body, { event: 'issues' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { action: string };
    expect(json.action).toBe('ignored');
  });

  it('issues event with unknown action and no action field returns action:unknown (line 102: payload.action ?? unknown)', async () => {
    // payload has no action field — hits `payload.action ?? 'unknown'` on line 102
    const body = JSON.stringify({
      repository: { full_name: 'shaunnez/goose-hub' },
      // no action field
    });
    const res = await postWebhook(body, { event: 'issues' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { action: string; status: string };
    // action is undefined in payload → ?? 'unknown' → but 'unknown' != 'opened' and != 'labeled'
    // so falls through to the final return with action:'unknown' and status:'ignored'
    expect(json.status).toBe('ignored');
  });
});

describe('verifyGitHubSignature', () => {
  it('accepts valid signature', async () => {
    const { verifyGitHubSignature } = await import('./handler.js');
    const body = '{"action":"opened"}';
    const sig = sign(body, SECRET);
    expect(verifyGitHubSignature(body, sig, SECRET)).toBe(true);
  });

  it('rejects tampered payload', async () => {
    const { verifyGitHubSignature } = await import('./handler.js');
    const body = '{"action":"opened"}';
    const sig = sign(body, SECRET);
    expect(verifyGitHubSignature('{"action":"tampered"}', sig, SECRET)).toBe(false);
  });

  it('rejects wrong secret', async () => {
    const { verifyGitHubSignature } = await import('./handler.js');
    const body = '{"action":"opened"}';
    const sig = sign(body, 'wrong-secret');
    expect(verifyGitHubSignature(body, sig, SECRET)).toBe(false);
  });
});
