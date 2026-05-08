/**
 * Golden Bug — low-confidence investigation gate.
 *
 * Mock harness: MOCK_AGENTS=true, MOCK_SOURCE=true, MOCK_OPEN_PR=true.
 *
 * Companion to golden-bug.spec.ts. The happy-path bug spec proves the
 * high-confidence path (auto-routes to dev-ready). This spec proves the
 * low-confidence path: investigation-complete → gate-pending (human review
 * required), then the human fills notes and clicks proceed → dev-ready.
 *
 * outcomes.investigate = 'low-confidence' directs the mock investigator to
 * return confidence: 'low', which routes to factory:gate-pending.
 *
 * Flow:
 *   1. seed type:bug, outcomes={ investigate: 'low-confidence' }
 *   2. /tick                          → investigating
 *   3. /dispatch (investigate)        → gate-pending (low-confidence)
 *   4. Visit /investigation           → investigation-section + proceed gate visible
 *   5. Fill notes, click proceed-button → dev-ready (via transitionState UI call)
 *   6. /dispatch (fix-issue)          → needs-qa
 *   7. /run-qa                        → needs-review
 *   8. /run-review                    → approved
 *   9. /approve                       → done
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
  outcomes?: Record<string, string | string[]>;
}): Promise<{ issueNumber: number; workItemId: string }> {
  const res = await postServer(`/projects/test/${SLUG}/seed-issue`, opts);
  return res.json() as Promise<{ issueNumber: number; workItemId: string }>;
}

const BUG_EMOJIS = ['🔍', '🧐', '🤔', '❓', '🕵️', '🦠'];
function goldenTitle(): string {
  const ts = Date.now();
  const emoji = BUG_EMOJIS[ts % BUG_EMOJIS.length];
  const iso = new Date(ts).toISOString().replace(/[:.]/g, '-');
  return `${emoji} [GOLDEN-BUG-LOW-CONF] ${iso}`;
}

test.describe('Golden Bug — low-confidence gate (MOCK_AGENTS + MOCK_SOURCE + MOCK_OPEN_PR)', () => {
  test('low-confidence → gate-pending → human proceed → dev → done', async ({ page }) => {
    test.setTimeout(240_000);

    const title = goldenTitle();
    const { issueNumber } = await seedIssue({
      title,
      type: 'bug',
      outcomes: { investigate: 'low-confidence' },
    });

    await page.goto(`/projects/${SLUG}/items/${issueNumber}`);
    await expect(page.getByTestId('detail-page')).toBeVisible({ timeout: 15_000 });
    const statePill = page.getByTestId('state-pill');
    await expect(statePill).toHaveText('triaging', { timeout: 15_000 });

    // Triage: triaging → investigating (type:bug routing).
    await postServer(`/projects/${SLUG}/tick`);
    await expect(statePill).toHaveText('investigating', { timeout: 60_000 });

    // Investigate (low-confidence): investigating → investigation-complete → gate-pending.
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('gate-pending', { timeout: 60_000 });

    // Navigate to the investigation section — findings should be visible.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/investigation`);
    await expect(page.getByTestId('investigation-section')).toBeVisible({ timeout: 15_000 });

    // The proceed gate renders when itemState is gate-pending.
    const proceedGate = page.getByTestId('investigation-proceed-gate');
    await expect(proceedGate).toBeVisible({ timeout: 10_000 });

    // Human fills notes and proceeds. This calls transitionState:
    // factory:gate-pending → factory:dev-ready.
    await page
      .getByTestId('investigation-notes-input')
      .fill('e2e golden test: low-confidence investigation reviewed, proceeding to dev-ready');
    await page.getByTestId('investigation-proceed-button').click();

    // State must leave gate-pending.
    await expect(statePill).toHaveText('dev-ready', { timeout: 30_000 });

    // Fix-issue: dev-ready → needs-qa.
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('needs-qa', { timeout: 60_000 });

    // QA: needs-qa → needs-review.
    await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
    await expect(statePill).toHaveText('needs-review', { timeout: 60_000 });
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/qa`);
    await expect(page.getByTestId('qa-section')).toBeVisible({ timeout: 15_000 });

    // Review: needs-review → approved.
    await postServer(`/projects/${SLUG}/run-review/${issueNumber}`);
    await expect(statePill).toHaveText('approved', { timeout: 60_000 });
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/review`);
    await expect(page.getByTestId('review-section')).toBeVisible({ timeout: 15_000 });

    // Approve gate: approved → retrospecting → done.
    await postServer(`/projects/${SLUG}/issues/${issueNumber}/approve`);
    await expect(statePill).toHaveText('done', { timeout: 60_000 });

    // Timeline: triage and investigation events recorded.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/timeline`);
    await expect(page.getByTestId('timeline-section')).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('[data-event-kind="agent.investigation-complete"]').first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
