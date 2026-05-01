import { createHmac, timingSafeEqual } from 'node:crypto';
import { logger } from '@goose-hub/core/logger.js';
import type { Context } from 'hono';

/** Map from GitHub repo full name → project slug */
const REPO_TO_SLUG: Record<string, string> = {
  'shaunnez/goose-hub': 'goose-hub-self',
};

export function verifyGitHubSignature(body: string, signature: string, secret: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
  } catch {
    return false;
  }
}

export async function handleGitHubWebhook(c: Context): Promise<Response> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (secret == null || secret.length === 0) {
    return c.json({ error: 'webhook secret not configured' }, 500);
  }

  const signature = c.req.header('X-Hub-Signature-256') ?? '';
  if (!signature) {
    return c.json({ error: 'missing signature' }, 401);
  }

  const rawBody = await c.req.text();

  if (!verifyGitHubSignature(rawBody, signature, secret)) {
    return c.json({ error: 'invalid signature' }, 401);
  }

  const eventType = c.req.header('X-GitHub-Event') ?? '';

  if (eventType !== 'issues') {
    return c.json({ ok: true, event: eventType, action: 'ignored' });
  }

  let payload: { action?: string; repository?: { full_name?: string } };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }

  if (payload.action !== 'opened') {
    return c.json({
      ok: true,
      event: eventType,
      action: payload.action ?? 'unknown',
      status: 'ignored',
    });
  }

  const repoName = payload.repository?.full_name ?? '';
  const slug = REPO_TO_SLUG[repoName];

  if (slug == null) {
    return c.json({
      ok: true,
      event: eventType,
      action: 'ignored',
      reason: 'repo not in allowlist',
    });
  }

  // Dispatch async — do not await
  import('../workflows/triage-batch.js')
    .then(({ runTriageBatch }) => runTriageBatch(slug))
    .catch((err: unknown) => {
      logger.error('webhook triage-batch failed', { slug, error: String(err) });
    });

  return c.json({ ok: true, event: eventType, action: 'dispatched', slug });
}
