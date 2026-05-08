/**
 * Golden Gate-Denied E2E — human rejection at the approval gate.
 *
 * Mock harness: MOCK_AGENTS=true, MOCK_SOURCE=true, MOCK_OPEN_PR=true.
 *
 * Drives a chore through to factory:approved then exercises the UI reject
 * flow in ApprovalGateSection (reject-btn → reject-reason-input →
 * reject-submit). This emits a gate.rejected event and transitions
 * approved → needs-fix. The spec then drives the second cycle to done.
 *
 * Flow:
 *   1. seed type:chore
 *   2. /tick                → dev-ready
 *   3. /dispatch            → needs-qa
 *   4. /run-qa              → needs-review
 *   5. /run-review          → approved
 *   6. UI: click reject-btn, fill reason, click reject-submit
 *                           → needs-fix (gate.rejected event emitted)
 *   7. /dispatch            → needs-qa
 *   8. /run-qa              → needs-review
 *   9. /run-review          → approved
 *  10. /approve             → done
 *  11. Assert gate.rejected on timeline
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

const EMOJIS = ['❌', '🚫', '⛔', '🔕', '🙅', '🛑'];
function goldenTitle(): string {
  const ts = Date.now();
  const emoji = EMOJIS[ts % EMOJIS.length];
  const iso = new Date(ts).toISOString().replace(/[:.]/g, '-');
  return `${emoji} [GOLDEN-GATE-DENIED] ${iso}`;
}

test.describe('Golden Gate-Denied flow (MOCK_AGENTS + MOCK_SOURCE + MOCK_OPEN_PR)', () => {
  test('approved → human reject via UI → needs-fix → re-cycle → done', async ({ page }) => {
    test.setTimeout(240_000);

    const title = goldenTitle();
    const { issueNumber } = await seedIssue({ title, type: 'chore' });

    await page.goto(`/projects/${SLUG}/items/${issueNumber}`);
    await expect(page.getByTestId('detail-page')).toBeVisible({ timeout: 15_000 });
    const statePill = page.getByTestId('state-pill');
    await expect(statePill).toHaveText('triaging', { timeout: 15_000 });

    // Triage: triaging → dev-ready.
    await postServer(`/projects/${SLUG}/tick`);
    await expect(statePill).toHaveText('dev-ready', { timeout: 60_000 });

    // Fix-issue: dev-ready → needs-qa.
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('needs-qa', { timeout: 60_000 });

    // QA: needs-qa → needs-review.
    await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
    await expect(statePill).toHaveText('needs-review', { timeout: 60_000 });

    // Review: needs-review → approved.
    await postServer(`/projects/${SLUG}/run-review/${issueNumber}`);
    await expect(statePill).toHaveText('approved', { timeout: 60_000 });

    // Approval gate is rendered when state is factory:approved.
    const approvalGate = page.getByTestId('approval-gate');
    await expect(approvalGate).toBeVisible({ timeout: 15_000 });

    // Human rejects: click Reject, fill in reason, submit.
    await page.getByTestId('reject-btn').click();
    await page.getByTestId('reject-reason-input').fill('e2e golden gate-denied rejection test');
    await page.getByTestId('reject-submit').click();

    // approved → needs-fix (gate.rejected event emitted by server).
    await expect(statePill).toHaveText('needs-fix', { timeout: 15_000 });

    // Second cycle: fix-feedback → needs-qa → QA → review → approved.
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('needs-qa', { timeout: 60_000 });

    await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
    await expect(statePill).toHaveText('needs-review', { timeout: 60_000 });

    await postServer(`/projects/${SLUG}/run-review/${issueNumber}`);
    await expect(statePill).toHaveText('approved', { timeout: 60_000 });

    // Final approve: approved → retrospecting → done.
    await postServer(`/projects/${SLUG}/issues/${issueNumber}/approve`);
    await expect(statePill).toHaveText('done', { timeout: 60_000 });

    // Timeline must record the gate.rejected event from the first cycle.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/timeline`);
    await expect(page.getByTestId('timeline-section')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-event-kind="gate.rejected"]').first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
