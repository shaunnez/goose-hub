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

test.describe('Bug investigation (MOCK_AGENTS + MOCK_SOURCE)', () => {
  test('high-confidence investigate → investigation-complete → dev-ready', async ({ page }) => {
    test.setTimeout(120_000);

    const { issueNumber } = await seedIssue({
      title: `[E2E] Bug High Confidence ${Date.now()}`,
      type: 'bug',
      outcomes: { investigate: 'high-confidence' },
    });

    await page.goto(`/projects/${SLUG}/items/${issueNumber}`);
    const statePill = page.getByTestId('state-pill');
    await expect(statePill).toHaveText('triaging', { timeout: 15_000 });

    // Triage (bug type) → accepted → investigating
    await postServer(`/projects/${SLUG}/tick`);
    await expect(statePill).toHaveText('investigating', { timeout: 60_000 });

    // Investigate (high-confidence) → dev-ready
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('dev-ready', { timeout: 15_000 });

    const findingsButton = page.getByRole('button', { name: /findings/i });
    const acceptanceButton = page.getByRole('button', { name: /acceptance contract/i });
    const specButton = page.getByRole('button', { name: /engineering spec/i });

    await expect(findingsButton).toHaveAttribute('aria-expanded', 'true');
    await expect(acceptanceButton).toHaveAttribute('aria-expanded', 'false');
    await expect(specButton).toHaveAttribute('aria-expanded', 'false');

    await expect(page.getByTestId('findings-content')).toBeVisible();
    await expect(page.getByText(/Root cause hypothesis/i)).toBeVisible();

    await acceptanceButton.click();
    await expect(acceptanceButton).toHaveAttribute('aria-expanded', 'true');
  });

  test('low-confidence investigate → gate-pending', async ({ page }) => {
    test.setTimeout(120_000);

    const { issueNumber } = await seedIssue({
      title: `[E2E] Bug Low Confidence ${Date.now()}`,
      type: 'bug',
      outcomes: { investigate: 'low-confidence' },
    });

    await page.goto(`/projects/${SLUG}/items/${issueNumber}`);
    const statePill = page.getByTestId('state-pill');
    await expect(statePill).toHaveText('triaging', { timeout: 15_000 });

    // Triage (bug type) → accepted → investigating
    await postServer(`/projects/${SLUG}/tick`);
    await expect(statePill).toHaveText('investigating', { timeout: 60_000 });

    // Investigate (low-confidence) → investigation-complete → gate-pending
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    // await expect(statePill).toHaveText('investigation-complete', { timeout: 60_000 });
    await expect(statePill).toHaveText('gate-pending', { timeout: 15_000 });
  });
});
