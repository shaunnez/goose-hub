import { expect, test } from '@playwright/test';

test('Sidebar logo renders "hello world 2" text (AC-1, AC-3)', async ({ page }) => {
  // The sidebar is present on all routes. Navigate to root.
  await page.goto('/');

  // Wait for the sidebar to appear.
  await page.waitForSelector('[data-testid="sidebar"]');

  // Expand the sidebar so the brand label is visible.
  // Default state is collapsed — click the toggle button to expand.
  const toggleBtn = page.locator('[data-testid="sidebar"] button[title="Expand sidebar"]');
  const isCollapsed = await toggleBtn.isVisible();
  if (isCollapsed) {
    await toggleBtn.click();
  }

  // The brand span should now read "hello world 2".
  const brandSpan = page.locator('[data-testid="sidebar"] span.text-\\[14px\\]');
  await expect(brandSpan).toBeVisible();
  await expect(brandSpan).toHaveText('hello world 2');

  await page.screenshot({ path: 'evidence/issue-664/step-1.png' });
});
