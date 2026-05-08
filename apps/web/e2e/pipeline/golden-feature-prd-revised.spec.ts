/**
 * Golden Feature — PRD revision (ADR 0033).
 *
 * Mock harness: MOCK_AGENTS=true, MOCK_SOURCE=true, MOCK_OPEN_PR=true.
 *
 * M13.12 (#631) shipped the three-path PRD review flow defined in ADR 0033,
 * replacing the legacy single "Reject / re-grill" button with:
 *
 *   - Approve         → prd-review → decomposing → done (covered by
 *                       golden-feature.spec.ts)
 *   - Request Changes → re-runs write-prd with priorPrd + humanConcerns,
 *                       state remains prd-review, new PRD comment posted.
 *   - Decline Feature → terminal: state → done.
 *
 * This file covers the latter two via two tests.
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
function goldenTitle(suffix: string): string {
  const ts = Date.now();
  const emoji = FEATURE_EMOJIS[ts % FEATURE_EMOJIS.length];
  const iso = new Date(ts).toISOString().replace(/[:.]/g, '-');
  return `${emoji} [GOLDEN-FEATURE-${suffix}] ${iso}`;
}

/**
 * Drives a freshly-seeded type:feature issue through:
 *   triaging → grilling → gate-pending (round 1 question) → grilling
 *   (after UI reply) → prd-review (round 2, mock readyForPRD=true).
 *
 * Leaves the page on the PRD section with state = prd-review and the first
 * PRD comment rendered.
 */
async function driveFeatureToPrdReview(
  page: import('@playwright/test').Page,
  issueNumber: number,
): Promise<void> {
  await page.goto(`/projects/${SLUG}/items/${issueNumber}`);
  await expect(page.getByTestId('detail-page')).toBeVisible({ timeout: 15_000 });
  const statePill = page.getByTestId('state-pill');
  await expect(statePill).toHaveText('triaging', { timeout: 15_000 });

  await postServer(`/projects/${SLUG}/tick`);
  await expect(statePill).toHaveText('grilling', { timeout: 60_000 });

  // Round 1: grill-me asks one question → gate-pending.
  await page.goto(`/projects/${SLUG}/items/${issueNumber}/grill`);
  await expect(page.getByTestId('grill-section')).toBeVisible();
  await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
  await expect(statePill).toHaveText('gate-pending', { timeout: 60_000 });
  await expect(page.getByTestId('grill-msg-agent').first()).toBeVisible({ timeout: 15_000 });

  // Reply via UI → grilling.
  await page.getByTestId('grill-reply-input').fill('Refining intent for revision spec.');
  await page.getByTestId('grill-send-btn').click();
  await expect(statePill).toHaveText('grilling', { timeout: 30_000 });

  // Round 2: readyForPRD=true → write-prd → prd-review.
  await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
  await expect(statePill).toHaveText('prd-review', { timeout: 60_000 });

  await page.goto(`/projects/${SLUG}/items/${issueNumber}/prd`);
  await expect(page.getByTestId('prd-section')).toBeVisible({ timeout: 15_000 });
}

test.describe('Golden Feature — PRD revision (ADR 0033 three-path flow)', () => {
  test('Request Changes: PRD v1 → revise → PRD v2 → approve → done', async ({ page }) => {
    test.setTimeout(240_000);

    const title = goldenTitle('PRD-REVISE');
    const { issueNumber } = await seedIssue({ title, type: 'feature' });

    await driveFeatureToPrdReview(page, issueNumber);
    const statePill = page.getByTestId('state-pill');

    // ── Request Changes ──────────────────────────────────────────────────────
    // Open the form, type concerns, submit. State must STAY at prd-review
    // (this is the key behavioural difference from the legacy reject path,
    // which used to force-state to grilling).
    await page.getByTestId('prd-request-changes-btn').click();
    await expect(page.getByTestId('prd-request-changes-form')).toBeVisible({ timeout: 5_000 });
    await page
      .getByTestId('prd-concerns-input')
      .fill(
        [
          'Acceptance criterion AC-1 is too vague — please tighten the success measure.',
          'Add an explicit error state for the J-1 journey when the network is offline.',
        ].join('\n'),
      );
    await page.getByTestId('prd-submit-changes-btn').click();

    // State must remain prd-review throughout. We assert the prd.revised event
    // appears on the timeline and confirm the state never left prd-review.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/timeline`);
    await expect(page.getByTestId('timeline-section')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-event-kind="prd.revised"]').first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(statePill).toHaveText('prd-review');

    // The async dispatchRevisePrd posts a fresh PRD comment. Wait for the
    // second prd.completed (or just for prd-section to re-render and remain
    // valid) before approving. We re-load the PRD section to pick up the
    // newest comment.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/prd`);
    await expect(page.getByTestId('prd-section')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('prd-title')).not.toHaveText('', { timeout: 15_000 });

    // ── Approve PRD v2 ──────────────────────────────────────────────────────
    await page.getByTestId('prd-approve-btn').click();
    await expect(statePill).toHaveText('done', { timeout: 60_000 });

    await page.goto(`/projects/${SLUG}/items/${issueNumber}/timeline`);
    await expect(page.locator('[data-event-kind="decompose.completed"]').first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('Decline Feature: PRD review → decline → done (no decompose)', async ({ page }) => {
    test.setTimeout(180_000);

    const title = goldenTitle('PRD-DECLINE');
    const { issueNumber } = await seedIssue({ title, type: 'feature' });

    await driveFeatureToPrdReview(page, issueNumber);
    const statePill = page.getByTestId('state-pill');

    // ── Decline ──────────────────────────────────────────────────────────────
    // Click decline → confirmation surface → confirm. State → done.
    await page.getByTestId('prd-decline-btn').click();
    await expect(page.getByTestId('prd-decline-confirm')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('prd-confirm-decline-btn').click();
    await expect(statePill).toHaveText('done', { timeout: 30_000 });

    // Decline must NOT trigger decompose. Timeline should have prd.declined
    // and no decompose.completed event.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/timeline`);
    await expect(page.getByTestId('timeline-section')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-event-kind="prd.declined"]').first()).toBeVisible({
      timeout: 10_000,
    });
    expect(await page.locator('[data-event-kind="decompose.completed"]').count()).toBe(0);
  });
});
