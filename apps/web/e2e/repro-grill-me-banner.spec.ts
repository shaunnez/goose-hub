import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.use({ video: 'on' });

const EVIDENCE_DIR = '/tmp/repro-grill-me-banner';

test('repro: grill me banner missing on factory:gate-pending', async ({ page }) => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const consoleErrors: Array<{ message: string; type: string }> = [];
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type()))
      consoleErrors.push({ message: msg.text(), type: msg.type() });
  });

  // Step 1: Navigate to an issue currently in factory:gate-pending state
  // (issue #610 "Mobile responsiveness" in goose-hub-self confirmed via /api/projects/goose-hub-self/issues).
  await page.goto('/projects/goose-hub-self/items/610', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="detail-page"], main, body', { timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${EVIDENCE_DIR}/step-1.png`, fullPage: false });

  // Step 2: Confirm the state pill shows gate-pending (sanity that we landed on the right item).
  const statePill = page.locator('text=/gate-pending/i').first();
  await expect.soft(statePill).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: `${EVIDENCE_DIR}/step-2.png`, fullPage: false });

  // Step 3: BUG — banner with "question ready - grill" link should appear at top
  // of view (info-style variant of the existing gate-pending-banner). It does not.
  const banner = page.locator('[data-testid="gate-pending-banner"]');
  const bannerCount = await banner.count();
  console.log('REPRO_BANNER_COUNT', bannerCount);

  // Soft assertion captures the broken state: banner should be visible for
  // factory:gate-pending but is suppressed by the GATE_STATES guard.
  await expect.soft(banner).toBeVisible({ timeout: 5000 });
  await expect.soft(page.locator('text=/question ready/i')).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: `${EVIDENCE_DIR}/step-3.png`, fullPage: false });

  // Step 4: Navigate to grill section — confirm grill UI exists (so a link
  // target is available) but no top-banner pointer.
  await page.goto('/projects/goose-hub-self/items/610/grill', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${EVIDENCE_DIR}/step-4.png`, fullPage: false });

  console.log('REPRO_CONSOLE', JSON.stringify(consoleErrors));
});
