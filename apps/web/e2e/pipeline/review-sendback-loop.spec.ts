import { expect, test } from '@playwright/test';

const SLUG = process.env.PROJECT_SLUG ?? 'goose-hub-self';
const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3001';

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

test.describe('Review sendback loop (MOCK_AGENTS + MOCK_SOURCE)', () => {
  test('review needs-fix once → loop → pass on second pass', async ({ page }) => {
    test.setTimeout(180_000);

    // Review sends back once then approves
    const { issueNumber } = await seedIssue({
      title: `[E2E] Review Sendback ${Date.now()}`,
      type: 'chore',
      outcomes: { review: ['needs-fix', 'approved'] },
    });

    await page.goto(`/projects/${SLUG}/items/${issueNumber}`);
    const statePill = page.getByTestId('state-pill');
    await expect(statePill).toHaveText('factory:triaging', { timeout: 15_000 });

    // Triage → dev-ready
    await postServer(`/projects/${SLUG}/tick`);
    await expect(statePill).toHaveText('factory:dev-ready', { timeout: 60_000 });

    // Fix-issue → needs-qa
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('factory:needs-qa', { timeout: 60_000 });

    // QA (pass) → needs-review
    await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
    await expect(statePill).toHaveText('factory:needs-review', { timeout: 60_000 });

    // Review (needs-fix) → needs-fix
    await postServer(`/projects/${SLUG}/run-review/${issueNumber}`);
    await expect(statePill).toHaveText('factory:needs-fix', { timeout: 60_000 });

    // Fix-feedback → needs-qa
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('factory:needs-qa', { timeout: 60_000 });

    // QA (pass) → needs-review
    await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
    await expect(statePill).toHaveText('factory:needs-review', { timeout: 60_000 });

    // Review (approved on second pass) → approved
    await postServer(`/projects/${SLUG}/run-review/${issueNumber}`);
    await expect(statePill).toHaveText('factory:approved', { timeout: 60_000 });
  });
});
