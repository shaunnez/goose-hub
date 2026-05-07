import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('M12.08: webhook-setup runbook', () => {
  it('webhook-setup.md exists and contains required sections', () => {
    const runbookPath = resolve(
      import.meta.dirname,
      '../../docs/runbooks/webhook-setup.md',
    );
    const content = readFileSync(runbookPath, 'utf-8');

    // Verify required headings are present
    expect(content).toContain('# Webhook Setup Runbook');
    expect(content).toContain('## What the Webhook Does');
    expect(content).toContain('## Payload URL and Endpoint');
    expect(content).toContain('## Required Events');
    expect(content).toContain('## Secret Setup');
    expect(content).toContain('## Local Development with ngrok');
    expect(content).toContain('## New Repository Setup');
    expect(content).toContain('## Updating an Existing Webhook');
    expect(content).toContain('## Verification');
    expect(content).toContain('## Troubleshooting');
  });

  it('webhook-setup.md documents the correct endpoint path', () => {
    const runbookPath = resolve(
      import.meta.dirname,
      '../../docs/runbooks/webhook-setup.md',
    );
    const content = readFileSync(runbookPath, 'utf-8');

    // Verify the correct endpoint is documented
    expect(content).toContain('POST https://<your-host>/webhooks/github');
  });

  it('webhook-setup.md documents GITHUB_WEBHOOK_SECRET env var', () => {
    const runbookPath = resolve(
      import.meta.dirname,
      '../../docs/runbooks/webhook-setup.md',
    );
    const content = readFileSync(runbookPath, 'utf-8');

    // Verify the secret setup is documented
    expect(content).toContain('GITHUB_WEBHOOK_SECRET');
  });

  it('webhook-setup.md documents required events', () => {
    const runbookPath = resolve(
      import.meta.dirname,
      '../../docs/runbooks/webhook-setup.md',
    );
    const content = readFileSync(runbookPath, 'utf-8');

    // Verify required events are documented
    expect(content).toContain('issues');
    expect(content).toContain('opened');
    expect(content).toContain('labeled');
  });
});
