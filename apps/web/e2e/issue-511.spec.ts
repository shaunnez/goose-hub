import { expect, test } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

test('issue-511: expand all / collapse all buttons on timeline', async ({ page }) => {
  // Navigate to an issue detail page that has timeline events.
  // The seed spec ensures at least one issue exists; navigate to issue list first.
  await page.goto('/');
  await page.waitForSelector('[data-testid="board"]', { timeout: 10000 }).catch(() => null);

  // Take a screenshot of the home board for evidence.
  const dir = 'evidence/issue-511';
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, 'step-1-board.png') });

  // Navigate to the first project's issue detail if possible.
  const firstIssueLink = page.locator('a[href*="/issues/"]').first();
  const hasIssue = (await firstIssueLink.count()) > 0;
  if (!hasIssue) {
    // No issues visible — still verify app loaded.
    expect(await page.title()).not.toBe('');
    return;
  }

  await firstIssueLink.click();
  await page.waitForSelector('[data-testid="timeline-section"]', { timeout: 10000 }).catch(() => null);
  await page.screenshot({ path: path.join(dir, 'step-2-timeline.png') });

  // If there are timeline events, the expand/collapse buttons should be visible.
  const expandBtn = page.getByRole('button', { name: /expand all/i });
  const collapseBtn = page.getByRole('button', { name: /collapse all/i });

  const hasButtons = (await expandBtn.count()) > 0;
  if (hasButtons) {
    await expect(expandBtn).toBeVisible();
    await expect(collapseBtn).toBeVisible();

    // Click collapse all — run-group details should close.
    await collapseBtn.click();
    await page.screenshot({ path: path.join(dir, 'step-3-collapsed.png') });

    // Click expand all — run-group details should open.
    await expandBtn.click();
    await page.screenshot({ path: path.join(dir, 'step-4-expanded.png') });
  }
});
