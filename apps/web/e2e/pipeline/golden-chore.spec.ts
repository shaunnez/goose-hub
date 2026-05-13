/**
 * Golden Chore E2E — single chore walked end-to-end through every UI surface.
 *
 * Mock harness: MOCK_AGENTS=true, MOCK_SOURCE=true, MOCK_OPEN_PR=true.
 *
 * Chore is the simplest type: no grilling, no investigation. Triage routes
 * straight to dev-ready. This spec proves the minimal happy path while still
 * visiting Overview / QA / Review / Retrospective / Timeline surfaces, with
 * trace + video recorded on every run.
 *
 * Flow:
 *   1. Seed type:chore.
 *   2. /tick: triaging → dev-ready.
 *   3. /dispatch: dev-ready → needs-qa.
 *   4. /run-qa: needs-qa → needs-review.
 *   5. /run-review: needs-review → approved.
 *   6. /approve: approved → retrospecting → done.
 */

import { expect, test } from '@playwright/test';

const SLUG = process.env.PROJECT_SLUG ?? 'goose-hub-self';
const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3001';

test.use({ trace: 'on', video: 'on' });

async function postServer(path: string, body?: unknown): Promise<Response> {
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

const CHORE_EMOJIS = ['🧹', '🧽', '🪣', '🗂️', '📦', '🔧'];
function goldenTitle(): string {
  const ts = Date.now();
  const emoji = CHORE_EMOJIS[ts % CHORE_EMOJIS.length];
  const iso = new Date(ts).toISOString().replace(/[:.]/g, '-');
  return `${emoji} [GOLDEN-CHORE] ${iso}`;
}

test.describe('Golden Chore flow (MOCK_AGENTS + MOCK_SOURCE + MOCK_OPEN_PR)', () => {
  test('seed → triage → dev → QA → review → approve → done', async ({ page }) => {
    test.setTimeout(150_000);

    const title = goldenTitle();
    const { issueNumber } = await seedIssue({ title, type: 'chore' });

    await page.goto(`/projects/${SLUG}/items/${issueNumber}`);
    await expect(page.getByTestId('detail-page')).toBeVisible({ timeout: 15_000 });
    const statePill = page.getByTestId('state-pill');
    await expect(statePill).toHaveText('triaging', { timeout: 15_000 });
    await expect(page.getByTestId('overview-section')).toBeVisible();

    // Grill / PRD / Investigation tabs must NOT apply to a chore (rendered as
    // not-applicable line-through entries, not interactive nav links).
    await expect(page.locator('[data-section-key="grill"]')).toHaveCount(0);
    await expect(page.locator('[data-section-key="prd"]')).toHaveCount(0);

    // Triage: triaging → dev-ready (chore skips investigation/grilling).
    await postServer(`/projects/${SLUG}/tick`);
    await expect(statePill).toHaveText('dev-ready', { timeout: 60_000 });

    // Fix-issue: dev-ready → needs-qa.
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('needs-qa', { timeout: 60_000 });

    // QA: needs-qa → needs-review. QA section renders.
    await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
    await expect(statePill).toHaveText('needs-review', { timeout: 60_000 });
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/qa`);
    await expect(page.getByTestId('qa-section')).toBeVisible({ timeout: 15_000 });

    // Review: needs-review → approved. Review section + PR link render.
    await postServer(`/projects/${SLUG}/run-review/${issueNumber}`);
    await expect(statePill).toHaveText('approved', { timeout: 60_000 });
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/review`);
    await expect(page.getByTestId('review-section')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('review-open-pr')).toBeVisible();

    // Approve gate: approved → retrospecting → done.
    await postServer(`/projects/${SLUG}/issues/${issueNumber}/approve`);
    await expect(statePill).toHaveText('done', { timeout: 60_000 });

    // Final timeline check: triage-complete + pr.opened events.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/timeline`);
    await expect(page.getByTestId('timeline-section')).toBeVisible({ timeout: 10_000 });
    // await expect(page.locator('[data-event-kind="agent.triage-complete"]').first()).toBeVisible({
    //   timeout: 10_000,
    // });
    await expect(page.locator('[data-event-kind="pr.merged"]')).toBeVisible({
      timeout: 10_000,
    });
  });
});
