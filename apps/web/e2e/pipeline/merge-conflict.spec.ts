import { expect, test } from '@playwright/test';

const SLUG = process.env.PROJECT_SLUG ?? 'goose-hub-self';
const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3001';

async function postServer(path: string, body?: unknown) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return res;
}

async function seedIssue(opts: {
  title: string;
  type?: string;
  throwMergeConflict?: boolean;
}): Promise<{ issueNumber: number; workItemId: string }> {
  const res = await postServer(`/projects/test/${SLUG}/seed-issue`, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`seed-issue → ${res.status}: ${text}`);
  }
  return res.json() as Promise<{ issueNumber: number; workItemId: string }>;
}

test.describe('Merge conflict (MOCK_AGENTS + MOCK_SOURCE)', () => {
  test('mergePR throws once → approved → merge-conflict → resolve-conflict → retrospecting → done', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // throwMergeConflict=true causes the first approve to throw MergeConflictError
    const { issueNumber } = await seedIssue({
      title: `[E2E] Merge Conflict ${Date.now()}`,
      type: 'chore',
      throwMergeConflict: true,
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

    // QA → needs-review
    await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
    await expect(statePill).toHaveText('needs-review', { timeout: 60_000 });

    // Review → approved
    await postServer(`/projects/${SLUG}/run-review/${issueNumber}`);
    await expect(statePill).toHaveText('approved', { timeout: 60_000 });

    // Approve (merge conflict thrown once) → merge-conflict
    const approveRes = await postServer(`/projects/${SLUG}/issues/${issueNumber}/approve`);
    expect(approveRes.status).toBe(409);
    await expect(statePill).toHaveText('merge-conflict', { timeout: 15_000 });

    // Resolve-conflict workflow: merge-conflict → retrospecting → done
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('done', { timeout: 60_000 });
  });
});
