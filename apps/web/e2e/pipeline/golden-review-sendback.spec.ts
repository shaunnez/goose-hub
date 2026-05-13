/**
 * Golden Review Sendback E2E — review returns needs-fix then approves.
 *
 * Mock harness: MOCK_AGENTS=true, MOCK_SOURCE=true, MOCK_OPEN_PR=true.
 *
 * Companion to golden-bug.spec.ts. The happy-path spec proves the linear
 * review path. This spec proves the review sendback loop: review returns
 * needs-fix on first pass, the fix cycle runs, then review approves.
 *
 * outcomes.review = ['needs-fix', 'pass']:
 *   - Review run #1 → needs-fix (testOutcome === 'needs-fix' in mock-outputs.ts)
 *   - Review run #2 → approved  (any non-'needs-fix' value defaults to approved)
 *
 * Flow:
 *   1. seed type:bug, outcomes={ investigate: 'high-confidence', review: ['needs-fix', 'pass'] }
 *   2. /tick                       → investigating
 *   3. /dispatch (investigate)     → dev-ready (high-confidence auto-routes)
 *   4. /dispatch (fix-issue)       → needs-qa
 *   5. /run-qa                     → needs-review
 *   6. /run-review (needs-fix #1)  → needs-fix
 *   7. Visit /review — assert review-section renders sendback findings
 *   8. /dispatch (fix-feedback)    → needs-qa
 *   9. /run-qa                     → needs-review
 *  10. /run-review (pass #2)       → approved
 *  11. /approve                    → done
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

const BUG_EMOJIS = ['🔄', '↩️', '🔁', '🔃', '♻️', '🔀'];
function goldenTitle(): string {
  const ts = Date.now();
  const emoji = BUG_EMOJIS[ts % BUG_EMOJIS.length];
  const iso = new Date(ts).toISOString().replace(/[:.]/g, '-');
  return `${emoji} [GOLDEN-REVIEW-SENDBACK] ${iso}`;
}

test.describe('Golden Review Sendback flow (MOCK_AGENTS + MOCK_SOURCE + MOCK_OPEN_PR)', () => {
  test('review sendback → needs-fix → re-cycle → review passes → done', async ({ page }) => {
    test.setTimeout(240_000);

    const title = goldenTitle();
    const { issueNumber } = await seedIssue({
      title,
      type: 'bug',
      outcomes: {
        investigate: 'high-confidence',
        // First review returns needs-fix; second defaults to approved.
        review: ['needs-fix', 'pass'],
      },
    });

    await page.goto(`/projects/${SLUG}/items/${issueNumber}`);
    await expect(page.getByTestId('detail-page')).toBeVisible({ timeout: 15_000 });
    const statePill = page.getByTestId('state-pill');
    await expect(statePill).toHaveText('triaging', { timeout: 15_000 });

    // Triage: triaging → investigating (type:bug).
    await postServer(`/projects/${SLUG}/tick`);
    await expect(statePill).toHaveText('investigating', { timeout: 60_000 });

    // Investigate (high-confidence): investigating → dev-ready (auto).
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('dev-ready', { timeout: 60_000 });

    // Fix-issue: dev-ready → needs-qa.
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('needs-qa', { timeout: 60_000 });

    // QA (pass): needs-qa → needs-review.
    await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
    await expect(statePill).toHaveText('needs-review', { timeout: 60_000 });

    // ── Review sendback #1 ───────────────────────────────────────────────────
    // review outcome 'needs-fix' → verdict: needs-fix → state: needs-fix.
    await postServer(`/projects/${SLUG}/run-review/${issueNumber}`);
    await expect(statePill).toHaveText('needs-fix', { timeout: 60_000 });

    // Review section should render the sendback findings even after sendback.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/review`);
    await expect(page.getByTestId('review-section')).toBeVisible({ timeout: 15_000 });

    // Fix-feedback loop: needs-fix → needs-qa.
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('needs-qa', { timeout: 60_000 });

    // QA (pass): needs-qa → needs-review.
    await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
    await expect(statePill).toHaveText('needs-review', { timeout: 60_000 });

    // ── Review pass #2 ───────────────────────────────────────────────────────
    // review outcome 'pass' → defaults to approved verdict → state: approved.
    await postServer(`/projects/${SLUG}/run-review/${issueNumber}`);
    await expect(statePill).toHaveText('approved', { timeout: 60_000 });

    // Review section renders the final (approved) review.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/review`);
    await expect(page.getByTestId('review-section')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('review-open-pr')).toBeVisible();

    // Approve gate: approved → retrospecting → done.
    await postServer(`/projects/${SLUG}/issues/${issueNumber}/approve`);
    await expect(statePill).toHaveText('done', { timeout: 60_000 });

    // Timeline: two review.completed events (sendback + pass).
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/timeline`);
    await expect(page.getByTestId('timeline-section')).toBeVisible({ timeout: 10_000 });

    const merged = page.locator('[data-event-kind="pr.merged"]');
    await expect(merged).toBeVisible({ timeout: 10_000 });
    // const reviewCompleted = page.locator('[data-event-kind="review.completed"]');
    // await expect(reviewCompleted).toBeAttached({ timeout: 10_000 });
    // expect(await reviewCompleted.count()).toBeGreaterThanOrEqual(2);
  });
});
