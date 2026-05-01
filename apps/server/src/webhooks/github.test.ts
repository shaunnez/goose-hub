import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../workflows/triage-batch.js', () => ({
  runTriageBatch: vi.fn().mockResolvedValue(undefined),
}));

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
  const { app } = await import('../index.js');
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

describe('POST /webhooks/github', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
  });

  it('returns 401 when X-Hub-Signature-256 header is missing', async () => {
    const { app } = await import('../index.js');
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

  it('returns 200 for issues events with non-opened action', async () => {
    const body = JSON.stringify({
      action: 'closed',
      repository: { full_name: 'shaunnez/goose-hub' },
    });
    const res = await postWebhook(body, { event: 'issues' });
    expect(res.status).toBe(200);
  });

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

  it('returns 200 and ignores issues.opened for non-allowlisted repo', async () => {
    const body = JSON.stringify({
      action: 'opened',
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
    const { verifyGitHubSignature } = await import('./github.js');
    const body = '{"action":"opened"}';
    const sig = sign(body, SECRET);
    expect(verifyGitHubSignature(body, sig, SECRET)).toBe(true);
  });

  it('rejects tampered payload', async () => {
    const { verifyGitHubSignature } = await import('./github.js');
    const body = '{"action":"opened"}';
    const sig = sign(body, SECRET);
    expect(verifyGitHubSignature('{"action":"tampered"}', sig, SECRET)).toBe(false);
  });

  it('rejects wrong secret', async () => {
    const { verifyGitHubSignature } = await import('./github.js');
    const body = '{"action":"opened"}';
    const sig = sign(body, 'wrong-secret');
    expect(verifyGitHubSignature(body, sig, SECRET)).toBe(false);
  });
});
