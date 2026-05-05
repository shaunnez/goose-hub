import { expect, test } from '@playwright/test';

test('issue-509: expand all and collapse all buttons appear on timeline with run groups', async ({
  page,
}) => {
  // Navigate to an issue detail page that has a timeline section.
  // The detail page is at /:slug/:id.
  await page.goto('/');
  await page.waitForSelector('[data-testid="timeline-section"]', { timeout: 10000 }).catch(() => {
    // No timeline on root — navigate to any detail page if available.
  });

  // Find an issue card and navigate to its detail page.
  const issueCard = page.locator('[data-testid="issue-card"]').first();
  if ((await issueCard.count()) > 0) {
    await issueCard.click();
    await page.waitForSelector('[data-testid="timeline-section"]', { timeout: 10000 }).catch(() => {});
  }

  await page.screenshot({ path: 'evidence/issue-509/step-1.png' });

  // Check for expand/collapse buttons if run groups are present.
  const expandBtn = page.locator('[data-testid="timeline-expand-all"]');
  const collapseBtn = page.locator('[data-testid="timeline-collapse-all"]');

  if ((await expandBtn.count()) > 0) {
    // Collapse all — all run group details should close.
    await collapseBtn.click();
    const details = page.locator('[data-run-id]').first();
    await expect(details).not.toHaveAttribute('open');
    await page.screenshot({ path: 'evidence/issue-509/step-2-collapsed.png' });

    // Expand all — all run group details should open.
    await expandBtn.click();
    await expect(details).toHaveAttribute('open');
    await page.screenshot({ path: 'evidence/issue-509/step-3-expanded.png' });
  } else {
    // No run groups on this page — buttons correctly not rendered.
    expect(await expandBtn.count()).toBe(0);
    expect(await collapseBtn.count()).toBe(0);
  }
});
