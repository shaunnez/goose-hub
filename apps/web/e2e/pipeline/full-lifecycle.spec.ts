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
  throwMergeConflict?: boolean;
}): Promise<{ issueNumber: number; workItemId: string }> {
  const res = await postServer(`/projects/test/${SLUG}/seed-issue`, opts);
  return res.json() as Promise<{ issueNumber: number; workItemId: string }>;
}

async function patchServer(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PATCH ${path} → ${res.status}: ${text}`);
  }
}

async function resetSettings(): Promise<void> {
  await patchServer(`/projects/${SLUG}/settings/pipeline`, { useMultiAgentPipeline: false });
  await patchServer(`/projects/${SLUG}/settings/dev-review`, {
    enabled: false,
    triggerOn: 'priority:high+',
    maxRevisionTurns: 1,
    perCycleMaxUsd: 2.0,
  });
}

test.describe('Full lifecycle (MOCK_AGENTS + MOCK_SOURCE)', () => {
  test.beforeEach(async () => {
    // Reset to safe defaults so a prior failed run doesn't leak state.
    await resetSettings();
  });

  test.afterEach(async () => {
    await resetSettings();
  });

  test('chore: triaging → done', async ({ page }) => {
    test.setTimeout(120_000);

    const { issueNumber } = await seedIssue({
      title: `[E2E] Full Lifecycle ${Date.now()}`,
      type: 'chore',
    });

    await page.goto(`/projects/${SLUG}/items/${issueNumber}`);
    const statePill = page.getByTestId('state-pill');
    await expect(statePill).toHaveText('triaging', { timeout: 15_000 });

    // Triage: triaging → accepted → dev-ready (chore type skips investigation)
    await postServer(`/projects/${SLUG}/tick`);
    await expect(statePill).toHaveText('dev-ready', { timeout: 60_000 });

    // Fix-issue: dev-ready → needs-qa
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('needs-qa', { timeout: 60_000 });

    // QA: needs-qa → needs-review
    await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
    await expect(statePill).toHaveText('needs-review', { timeout: 60_000 });

    // Review: needs-review → approved
    await postServer(`/projects/${SLUG}/run-review/${issueNumber}`);
    await expect(statePill).toHaveText('approved', { timeout: 60_000 });

    // Approve gate: approved → retrospecting → done
    await postServer(`/projects/${SLUG}/issues/${issueNumber}/approve`);
    await expect(statePill).toHaveText('done', { timeout: 60_000 });

    // // Timeline should show key agent events
    await page.getByRole('link', { name: 'Timeline' }).click();

    await expect(page.locator('[data-event-kind="pr.merged"]').first()).toBeVisible({
      timeout: 10_000,
    });

    await postServer(`/projects/${SLUG}/run-retro/${issueNumber}`);
    await expect(statePill).toHaveText('done', { timeout: 60_000 });
  });
});
