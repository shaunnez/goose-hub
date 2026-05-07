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
}): Promise<{ issueNumber: number; workItemId: string }> {
  const res = await postServer(`/projects/test/${SLUG}/seed-issue`, opts);
  return res.json() as Promise<{ issueNumber: number; workItemId: string }>;
}

test.describe('Gate reject loop (MOCK_AGENTS + MOCK_SOURCE)', () => {
  test('approved → needs-fix (gate reject) → drive forward to done', async ({ page }) => {
    test.setTimeout(180_000);

    const { issueNumber } = await seedIssue({
      title: `[E2E] Gate Reject Loop ${Date.now()}`,
      type: 'chore',
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

    // QA (pass) → needs-review
    await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
    await expect(statePill).toHaveText('needs-review', { timeout: 60_000 });

    // Review (approve) → approved
    await postServer(`/projects/${SLUG}/run-review/${issueNumber}`);
    await expect(statePill).toHaveText('approved', { timeout: 60_000 });

    // Human rejects at gate: approved → needs-fix
    await postServer(`/projects/${SLUG}/issues/${issueNumber}/reject`, {
      reason: 'e2e gate reject test',
    });
    await expect(statePill).toHaveText('needs-fix', { timeout: 15_000 });

    // Fix-feedback (implement mock) → in-progress → needs-qa
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('needs-qa', { timeout: 60_000 });

    // QA → needs-review
    await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
    await expect(statePill).toHaveText('needs-review', { timeout: 60_000 });

    // Review → approved
    await postServer(`/projects/${SLUG}/run-review/${issueNumber}`);
    await expect(statePill).toHaveText('approved', { timeout: 60_000 });

    // Approve → retrospecting → done
    await postServer(`/projects/${SLUG}/issues/${issueNumber}/approve`);
    await expect(statePill).toHaveText('done', { timeout: 60_000 });
  });
});
