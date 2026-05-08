/**
 * Golden Bug E2E — single bug walked end-to-end through every UI surface.
 *
 * Mock harness: MOCK_AGENTS=true, MOCK_SOURCE=true, MOCK_OPEN_PR=true.
 *
 * Bug flow (different from feature: no grill, no decompose):
 *   1. Seed a bug with outcomes.investigate=high-confidence so the mock
 *      auto-routes investigation-complete → dev-ready (no human gate).
 *   2. /tick: triaging → investigating. Investigation tab visible (bug-only).
 *   3. /dispatch (investigate workflow): investigating → dev-ready.
 *      Investigation section renders findings.
 *   4. /dispatch (fix-issue): dev-ready → needs-qa.
 *   5. /run-qa: needs-qa → needs-review. QA section renders.
 *   6. /run-review: needs-review → approved. Review section + PR link render.
 *   7. /approve: approved → retrospecting → done. Retrospective section
 *      eventually populates; pr.opened event on the timeline.
 *
 * Trace + video are recorded for every run.
 *
 * Loop variants (qa-fail, review-sendback, low-confidence gate, merge-conflict)
 * are intentionally out of scope here — they have their own dedicated specs.
 */

import { expect, test } from '@playwright/test';

const SLUG = process.env.PROJECT_SLUG ?? 'goose-hub-self';
const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3001';

test.use({ trace: 'on', video: 'on' });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  outcomes?: Record<string, string | string[]>;
}): Promise<{ issueNumber: number; workItemId: string }> {
  const res = await postServer(`/projects/test/${SLUG}/seed-issue`, opts);
  return res.json() as Promise<{ issueNumber: number; workItemId: string }>;
}

const BUG_EMOJIS = ['🐛', '🪲', '🦗', '🕷️', '🐞', '🦟'];
function goldenTitle(): string {
  const ts = Date.now();
  const emoji = BUG_EMOJIS[ts % BUG_EMOJIS.length];
  const iso = new Date(ts).toISOString().replace(/[:.]/g, '-');
  return `${emoji} [GOLDEN-BUG] ${iso}`;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Golden Bug flow (MOCK_AGENTS + MOCK_SOURCE + MOCK_OPEN_PR)', () => {
  test('seed → investigate → dev → QA → review → approve → done', async ({ page }) => {
    test.setTimeout(180_000);

    const title = goldenTitle();
    const { issueNumber } = await seedIssue({
      title,
      type: 'bug',
      outcomes: { investigate: 'high-confidence' },
    });

    // ── 1. Open detail page; baseline state.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}`);
    await expect(page.getByTestId('detail-page')).toBeVisible({ timeout: 15_000 });
    const statePill = page.getByTestId('state-pill');
    await expect(statePill).toHaveText('triaging', { timeout: 15_000 });
    await expect(page.getByTestId('overview-section')).toBeVisible();

    // Investigation tab is bug-only — must be visible. Grill/PRD must be
    // labelled "not applicable" for a bug.
    await expect(page.locator('[data-section-key="investigation"]')).toBeVisible();

    // ── 2. Triage: triaging → investigating (type:bug routing).
    await postServer(`/projects/${SLUG}/tick`);
    await expect(statePill).toHaveText('investigating', { timeout: 60_000 });

    // ── 3. Investigate (high-confidence): investigating →
    //      investigation-complete → dev-ready (auto, no gate).
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('dev-ready', { timeout: 60_000 });

    // Investigation section renders the findings/key-files content.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/investigation`);
    await expect(page.getByTestId('investigation-section')).toBeVisible({ timeout: 15_000 });

    // Triage timeline event should be present.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/timeline`);
    await expect(page.getByTestId('timeline-section')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-event-kind="agent.triage-complete"]').first()).toBeVisible({
      timeout: 10_000,
    });

    // ── 4. Fix-issue: dev-ready → needs-qa.
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('needs-qa', { timeout: 60_000 });

    // ── 5. QA: needs-qa → needs-review.
    await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
    await expect(statePill).toHaveText('needs-review', { timeout: 60_000 });
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/qa`);
    await expect(page.getByTestId('qa-section')).toBeVisible({ timeout: 15_000 });

    // ── 6. Review: needs-review → approved. Review section + PR link render.
    await postServer(`/projects/${SLUG}/run-review/${issueNumber}`);
    await expect(statePill).toHaveText('approved', { timeout: 60_000 });
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/review`);
    await expect(page.getByTestId('review-section')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('review-open-pr')).toBeVisible();

    // ── 7. Approve gate: approved → retrospecting → done.
    await postServer(`/projects/${SLUG}/issues/${issueNumber}/approve`);
    await expect(statePill).toHaveText('done', { timeout: 60_000 });

    // pr.opened event must exist on the timeline (MOCK_OPEN_PR=true).
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/timeline`);
    await expect(page.getByTestId('timeline-section')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-event-kind="pr.opened"]').first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
