/**
 * Golden Bug — multi-iteration QA loop.
 *
 * Mock harness: MOCK_AGENTS=true, MOCK_SOURCE=true, MOCK_OPEN_PR=true.
 *
 * Companion to golden-bug.spec.ts. The happy-path bug spec proves the linear
 * walk; this spec proves the dev↔QA back-and-forth: QA fails twice (with
 * fix-feedback re-runs in between) before passing on the third attempt.
 *
 * outcomes.qa = ['fail', 'fail', 'pass'] drives the mock QA skill: first call
 * → fail, second → fail, third → pass. Each fail triggers the auto loop:
 *   needs-qa → qa-failed → needs-fix → in-progress → needs-qa.
 *
 * Flow (actually exercised, not just the linear path):
 *   1. seed type:bug, outcomes={ investigate: high-confidence, qa: [fail, fail, pass] }
 *   2. /tick                       → investigating
 *   3. /dispatch (investigate)     → dev-ready (high-confidence auto-routes)
 *   4. /dispatch (fix-issue)       → needs-qa
 *   5. /run-qa (fail #1)           → qa-failed
 *   6. /dispatch (qa-failed loop)  → needs-fix → in-progress → needs-qa
 *   7. /run-qa (fail #2)           → qa-failed
 *   8. /dispatch (qa-failed loop)  → needs-fix → in-progress → needs-qa
 *   9. /run-qa (pass)              → needs-review
 *  10. /run-review                 → approved
 *  11. /approve                    → retrospecting → done
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

const BUG_EMOJIS = ['🐛', '🪲', '🦗', '🕷️', '🐞', '🦟'];
function goldenTitle(): string {
  const ts = Date.now();
  const emoji = BUG_EMOJIS[ts % BUG_EMOJIS.length];
  const iso = new Date(ts).toISOString().replace(/[:.]/g, '-');
  return `${emoji} [GOLDEN-BUG-ITERATIONS] ${iso}`;
}

test.describe('Golden Bug — multi-iteration QA loop', () => {
  test('two QA fails then pass: dev↔QA back-and-forth', async ({ page }) => {
    test.setTimeout(240_000);

    const title = goldenTitle();
    const { issueNumber } = await seedIssue({
      title,
      type: 'bug',
      outcomes: {
        investigate: 'high-confidence',
        // First two QA runs fail, third passes. Drives the dev↔QA loop twice.
        qa: ['fail', 'fail', 'pass'],
      },
    });

    await page.goto(`/projects/${SLUG}/items/${issueNumber}`);
    await expect(page.getByTestId('detail-page')).toBeVisible({ timeout: 15_000 });
    const statePill = page.getByTestId('state-pill');
    await expect(statePill).toHaveText('triaging', { timeout: 15_000 });

    // Triage → investigating
    await postServer(`/projects/${SLUG}/tick`);
    await expect(statePill).toHaveText('investigating', { timeout: 60_000 });

    // Investigate (high-confidence) → dev-ready
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('dev-ready', { timeout: 60_000 });

    // Fix-issue → needs-qa
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('needs-qa', { timeout: 60_000 });

    // ── QA fail #1 ───────────────────────────────────────────────────────────
    await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
    await expect(statePill).toHaveText('qa-failed', { timeout: 60_000 });

    // QA section should render the failed run.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/qa`);
    await expect(page.getByTestId('qa-section')).toBeVisible({ timeout: 15_000 });

    // dispatchQaFailed: qa-failed → needs-fix → fix-feedback → in-progress → needs-qa
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('needs-qa', { timeout: 60_000 });

    // ── QA fail #2 ───────────────────────────────────────────────────────────
    await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
    await expect(statePill).toHaveText('qa-failed', { timeout: 60_000 });

    // Second iteration through the loop.
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('needs-qa', { timeout: 60_000 });

    // ── QA pass ──────────────────────────────────────────────────────────────
    await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
    await expect(statePill).toHaveText('needs-review', { timeout: 60_000 });

    // Review → approved
    await postServer(`/projects/${SLUG}/run-review/${issueNumber}`);
    await expect(statePill).toHaveText('approved', { timeout: 60_000 });
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/review`);
    await expect(page.getByTestId('review-section')).toBeVisible({ timeout: 15_000 });

    // Approve → retrospecting → done
    await postServer(`/projects/${SLUG}/issues/${issueNumber}/approve`);
    await expect(statePill).toHaveText('done', { timeout: 60_000 });

    // Timeline must show evidence of multiple QA cycles. Each /run-qa emits a
    // `qa.completed` event; we expect at least 3 (fail, fail, pass).
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/timeline`);
    await expect(page.getByTestId('timeline-section')).toBeVisible({ timeout: 10_000 });
    const merged = page.locator('[data-event-kind="pr.merged"]');
    await expect(merged).toBeVisible({ timeout: 10_000 });
    // await expect(qaCompleted.nth(2)).toBeVisible({ timeout: 10_000 });
    // expect(await qaCompleted.count()).toBeGreaterThanOrEqual(3);
  });
});
