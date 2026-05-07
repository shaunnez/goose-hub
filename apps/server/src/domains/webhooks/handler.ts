import { createHmac, timingSafeEqual } from 'node:crypto';
import { logger } from '@goose-hub/core/logger.js';
import { loadProjects } from '@goose-hub/core/projects/loader.js';
import { targetProjectsRoot } from '@goose-hub/target-projects';
import type { Context } from 'hono';
import { dispatchForLabel, dispatchTriageBatch } from '#shared/dispatch.js';

async function buildRepoSlugMap(): Promise<Record<string, string>> {
  const projects = await loadProjects(targetProjectsRoot);
  const map: Record<string, string> = {};
  for (const cfg of projects) {
    for (const repo of cfg.repos ?? []) {
      if (map[repo] != null) {
        logger.warn('duplicate repo in project configs, last-wins', { repo, slug: cfg.slug });
      }
      map[repo] = cfg.slug;
    }
  }
  return map;
}

export function verifyGitHubSignature(body: string, signature: string, secret: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
  } catch {
    return false;
  }
}

type WebhookPayload = {
  action?: string;
  repository?: { full_name?: string };
  issue?: { number?: number };
  label?: { name?: string };
};

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

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }

  const repoName = payload.repository?.full_name ?? '';
  const repoToSlug = await buildRepoSlugMap();
  const slug = repoToSlug[repoName];

  if (slug == null) {
    return c.json({
      ok: true,
      event: eventType,
      action: 'ignored',
      reason: 'repo not in allowlist',
    });
  }

  // issues.opened → run triage batch (via shared dispatcher per #207)
  if (payload.action === 'opened') {
    void dispatchTriageBatch(slug);
    return c.json({ ok: true, event: eventType, action: 'dispatched', slug });
  }

  // issues.labeled with a factory:* label → route to appropriate workflow
  if (payload.action === 'labeled') {
    const labelName = payload.label?.name ?? '';
    if (!labelName.startsWith('factory:')) {
      return c.json({
        ok: true,
        event: eventType,
        action: 'labeled',
        status: 'ignored-non-factory',
      });
    }

    const issueNumber = payload.issue?.number;
    if (issueNumber == null) {
      return c.json({ ok: true, event: eventType, action: 'labeled', status: 'no-issue-number' });
    }

    dispatchForLabel(slug, issueNumber, labelName).catch((err: unknown) => {
      logger.error('webhook dispatch failed', { slug, labelName, issueNumber, error: String(err) });
    });

    return c.json({ ok: true, event: eventType, action: 'dispatched', label: labelName, slug });
  }

  return c.json({
    ok: true,
    event: eventType,
    action: payload.action ?? 'unknown',
    status: 'ignored',
  });
}
