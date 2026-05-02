import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── module mocks ──────────────────────────────────────────────────────────────

const mockRunTriageBatch = vi.fn().mockResolvedValue(undefined);
const mockRunInvestigateWorkflow = vi.fn().mockResolvedValue(undefined);
const mockGetSourceForSlug = vi.fn();
const mockGetItem = vi.fn();

vi.mock('../workflows/triage-batch.js', () => ({
  runTriageBatch: mockRunTriageBatch,
}));

vi.mock('../../../../../slices/investigate/workflow.js', () => ({
  runInvestigateWorkflow: mockRunInvestigateWorkflow,
}));

vi.mock('../../shared/source.js', () => ({
  getSourceForSlug: mockGetSourceForSlug,
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

  it('calls getSourceForSlug and getItem when dispatching investigation', async () => {
    const body = JSON.stringify({
      action: 'labeled',
      label: { name: 'factory:investigating' },
      issue: { number: 42 },
      repository: { full_name: 'shaunnez/goose-hub' },
    });
    await postWebhook(body, { event: 'issues' });
    // Allow the async dispatch to settle
    await vi.waitFor(() => expect(mockGetSourceForSlug).toHaveBeenCalledWith('goose-hub-self'));
    await vi.waitFor(() => expect(mockGetItem).toHaveBeenCalledWith('42'));
    await vi.waitFor(() => expect(mockRunInvestigateWorkflow).toHaveBeenCalled());
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
