/**
 * Golden Feature — PRD revision via reject path.
 *
 * Mock harness: MOCK_AGENTS=true, MOCK_SOURCE=true, MOCK_OPEN_PR=true.
 *
 * Companion to golden-feature.spec.ts. The happy-path feature spec approves
 * the first PRD; this spec exercises the **PRD revision** path: the first
 * PRD is rejected, the grill-and-prd workflow re-runs and produces a second
 * PRD, then the second PRD is approved.
 *
 * Note: this targets the *current* (pre-ADR-0033) reject/re-grill flow. The
 * three-path flow (revise / decline / approve) defined in ADR 0033 is
 * accepted but not yet implemented; when it lands, this spec should be
 * extended (or replaced) to cover request-changes and decline.
 *
 * Flow:
 *   1. Seed type:feature.
 *   2. /tick                      → grilling
 *   3. /dispatch (round 1)        → gate-pending (mock asks one question)
 *   4. UI reply via grill chat    → grilling
 *   5. /dispatch (round 2)        → prd-review (mock readyForPRD=true → write-prd)
 *   6. Click prd-reject-btn       → grilling (force-state) + auto re-dispatch
 *   7. (auto-dispatch round 3)    → prd-review again with a fresh PRD comment
 *   8. Click prd-approve-btn      → done (decompose runs synchronously)
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

const FEATURE_EMOJIS = ['🦫', '🪐', '🛸', '🦊', '🌈', '⚡️', '🐙', '🔮'];
function goldenTitle(): string {
  const ts = Date.now();
  const emoji = FEATURE_EMOJIS[ts % FEATURE_EMOJIS.length];
  const iso = new Date(ts).toISOString().replace(/[:.]/g, '-');
  return `${emoji} [GOLDEN-FEATURE-PRD-REVISED] ${iso}`;
}

test.describe('Golden Feature — PRD revision (reject → re-PRD → approve)', () => {
  test('first PRD rejected, second PRD approved, decompose runs', async ({ page }) => {
    test.setTimeout(240_000);

    const title = goldenTitle();
    const { issueNumber } = await seedIssue({ title, type: 'feature' });

    await page.goto(`/projects/${SLUG}/items/${issueNumber}`);
    await expect(page.getByTestId('detail-page')).toBeVisible({ timeout: 15_000 });
    const statePill = page.getByTestId('state-pill');
    await expect(statePill).toHaveText('triaging', { timeout: 15_000 });

    // Triage feature → grilling
    await postServer(`/projects/${SLUG}/tick`);
    await expect(statePill).toHaveText('grilling', { timeout: 60_000 });

    // Round 1: grill-me asks one question → gate-pending
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/grill`);
    await expect(page.getByTestId('grill-section')).toBeVisible();
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('gate-pending', { timeout: 60_000 });
    await expect(page.getByTestId('grill-msg-agent').first()).toBeVisible({ timeout: 15_000 });

    // Reply via UI → grilling
    await page.getByTestId('grill-reply-input').fill('Refining intent for revision spec.');
    await page.getByTestId('grill-send-btn').click();
    await expect(statePill).toHaveText('grilling', { timeout: 30_000 });

    // Round 2: grill-me readyForPRD=true → write-prd → prd-review
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('prd-review', { timeout: 60_000 });

    // Capture the first PRD's section so we can assert it actually re-renders.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/prd`);
    await expect(page.getByTestId('prd-section')).toBeVisible({ timeout: 15_000 });
    const firstPrdTitle = await page.getByTestId('prd-title').textContent();
    expect(firstPrdTitle?.length ?? 0).toBeGreaterThan(0);

    // ── Reject the first PRD ─────────────────────────────────────────────────
    // rejectPRD force-states to grilling and fires an async dispatch of
    // grill-and-prd, which (with mock round counter ≥ 2) will produce a fresh
    // PRD and land back at prd-review.
    await page.getByTestId('prd-reject-btn').click();
    // We don't strictly need to observe the grilling intermediate state — the
    // important assertion is that a second prd-review cycle completes.
    await expect(statePill).toHaveText('prd-review', { timeout: 60_000 });

    // PRD section must still render after the second pass.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/prd`);
    await expect(page.getByTestId('prd-section')).toBeVisible({ timeout: 15_000 });
    const secondPrdTitle = await page.getByTestId('prd-title').textContent();
    expect(secondPrdTitle?.length ?? 0).toBeGreaterThan(0);

    // Timeline must record the rejection event.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/timeline`);
    await expect(page.getByTestId('timeline-section')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-event-kind="prd.rejected"]').first()).toBeVisible({
      timeout: 10_000,
    });

    // ── Approve the second PRD ──────────────────────────────────────────────
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/prd`);
    await page.getByTestId('prd-approve-btn').click();
    await expect(statePill).toHaveText('done', { timeout: 60_000 });

    // Decompose event must be present.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/timeline`);
    await expect(page.locator('[data-event-kind="decompose.completed"]').first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
