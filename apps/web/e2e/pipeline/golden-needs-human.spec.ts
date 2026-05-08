/**
 * Golden Needs-Human E2E — QA retry escalation and resume path.
 *
 * Mock harness: MOCK_AGENTS=true, MOCK_SOURCE=true, MOCK_OPEN_PR=true.
 *
 * DEFAULT_MAX_RETRIES = 2: after 2 prior QA failures the 3rd QA attempt
 * escalates to factory:needs-human instead of factory:qa-failed.
 *
 * outcomes.qa = ['fail', 'fail', 'fail', 'pass']:
 *   - Run #1 (0 priors)  → fail → qa-failed
 *   - Run #2 (1 prior)   → fail → qa-failed
 *   - Run #3 (2 priors)  → fail → ESCALATES → needs-human
 *   - Run #4 (resumed)   → pass → needs-review
 *
 * Flow:
 *   1. seed type:chore, outcomes above
 *   2. /tick                       → dev-ready
 *   3. /dispatch (fix-issue)       → needs-qa
 *   4. /run-qa (fail #1)           → qa-failed
 *   5. /dispatch (qa-failed loop)  → needs-qa
 *   6. /run-qa (fail #2)           → qa-failed
 *   7. /dispatch (qa-failed loop)  → needs-qa
 *   8. /run-qa (fail #3, escalate) → needs-human
 *   9. Assert gate-pending-banner rendered
 *  10. Click gate-action-send-to-qa → needs-qa
 *  11. /run-qa (pass)              → needs-review
 *  12. /run-review                 → approved
 *  13. /approve                    → done
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

const EMOJIS = ['🚨', '⚠️', '🛑', '🔴', '🆘', '🚫'];
function goldenTitle(): string {
  const ts = Date.now();
  const emoji = EMOJIS[ts % EMOJIS.length];
  const iso = new Date(ts).toISOString().replace(/[:.]/g, '-');
  return `${emoji} [GOLDEN-NEEDS-HUMAN] ${iso}`;
}

test.describe('Golden Needs-Human flow (MOCK_AGENTS + MOCK_SOURCE + MOCK_OPEN_PR)', () => {
  test('three QA fails escalate to needs-human, resume via UI → done', async ({ page }) => {
    test.setTimeout(300_000);

    const title = goldenTitle();
    const { issueNumber } = await seedIssue({
      title,
      type: 'chore',
      outcomes: {
        // Runs 1–3 fail; run 4 (post-resume) passes.
        qa: ['fail', 'fail', 'fail', 'pass'],
      },
    });

    await page.goto(`/projects/${SLUG}/items/${issueNumber}`);
    await expect(page.getByTestId('detail-page')).toBeVisible({ timeout: 15_000 });
    const statePill = page.getByTestId('state-pill');
    await expect(statePill).toHaveText('triaging', { timeout: 15_000 });

    // Triage: triaging → dev-ready (chore, no investigation).
    await postServer(`/projects/${SLUG}/tick`);
    await expect(statePill).toHaveText('dev-ready', { timeout: 60_000 });

    // Fix-issue: dev-ready → needs-qa.
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('needs-qa', { timeout: 60_000 });

    // ── QA fail #1 (0 priors → no escalation) ───────────────────────────────
    await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
    await expect(statePill).toHaveText('qa-failed', { timeout: 60_000 });

    // dispatchQaFailed: qa-failed → needs-fix → fix-feedback → needs-qa
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('needs-qa', { timeout: 60_000 });

    // ── QA fail #2 (1 prior → no escalation) ────────────────────────────────
    await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
    await expect(statePill).toHaveText('qa-failed', { timeout: 60_000 });

    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('needs-qa', { timeout: 60_000 });

    // ── QA fail #3 (2 priors → ESCALATES to needs-human) ────────────────────
    await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
    await expect(statePill).toHaveText('needs-human', { timeout: 60_000 });

    // gate-pending-banner must be visible for the needs-human state.
    const banner = page.getByTestId('gate-pending-banner');
    await expect(banner).toBeVisible({ timeout: 15_000 });

    // Human resumes by sending back to QA via the banner action button.
    // (/resume has no handler for needs-human; the UI action button is the path.)
    await page.getByTestId('gate-action-send-to-qa').click();
    await expect(statePill).toHaveText('needs-qa', { timeout: 15_000 });

    // ── QA pass (4th outcome: 'pass'; passes regardless of prior fail count) ─
    await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
    await expect(statePill).toHaveText('needs-review', { timeout: 60_000 });

    // Review → approved.
    await postServer(`/projects/${SLUG}/run-review/${issueNumber}`);
    await expect(statePill).toHaveText('approved', { timeout: 60_000 });

    // Approve gate: approved → retrospecting → done.
    await postServer(`/projects/${SLUG}/issues/${issueNumber}/approve`);
    await expect(statePill).toHaveText('done', { timeout: 60_000 });

    // Timeline: verify escalation event was recorded.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/timeline`);
    await expect(page.getByTestId('timeline-section')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-event-kind="agent.retry-escalated"]').first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
