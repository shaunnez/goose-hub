import { expect, test } from '@playwright/test';

const SLUG = process.env.PROJECT_SLUG ?? 'goose-hub-self';
const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3001';

// DEFAULT_MAX_RETRIES = 2: escalate after 2 QA failures (3rd dispatch triggers needs-human)
const QA_FAIL_COUNT = 2;

async function postServer(path: string, body?: unknown) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res;
}

async function seedIssue(opts: {
  title: string;
  type?: string;
  outcomes?: Record<string, string | string[]>;
}): Promise<{ issueNumber: number; workItemId: string }> {
  const res = await postServer(`/projects/test/${SLUG}/seed-issue`, opts);
  return res.json() as Promise<{ issueNumber: number; workItemId: string }>;
}

test.describe('QA escalation (MOCK_AGENTS + MOCK_SOURCE)', () => {
  test(`exhaust ${QA_FAIL_COUNT} QA retries → needs-human`, async ({ page }) => {
    test.setTimeout(300_000);

    // Queue QA_FAIL_COUNT failures. shouldEscalateQa triggers on the (N+1)th attempt.
    const { issueNumber } = await seedIssue({
      title: `[E2E] QA Escalation ${Date.now()}`,
      type: 'chore',
      outcomes: { qa: Array(QA_FAIL_COUNT).fill('fail') },
    });

    await page.goto(`/projects/${SLUG}/items/${issueNumber}`);
    const statePill = page.getByTestId('state-pill');
    await expect(statePill).toHaveText('triaging', { timeout: 15_000 });

    // Triage → dev-ready
    await postServer(`/projects/${SLUG}/tick`);
    await expect(statePill).toHaveText('dev-ready', { timeout: 60_000 });

    // Fix-issue → needs-qa
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('needs-qa', { timeout: 60_000 });

    // Each QA failure cycles: needs-qa → qa-failed → needs-fix → needs-qa
    for (let i = 0; i < QA_FAIL_COUNT; i++) {
      await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
      await expect(statePill).toHaveText('qa-failed', { timeout: 60_000 });
      // dispatchQaFailed → needs-fix → fix-feedback → needs-qa
      await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
      await expect(statePill).toHaveText('needs-qa', { timeout: 60_000 });
    }

    // (QA_FAIL_COUNT+1)th QA attempt: shouldEscalateQa is true → needs-human
    await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
    await expect(statePill).toHaveText('needs-human', { timeout: 60_000 });
  });
});
