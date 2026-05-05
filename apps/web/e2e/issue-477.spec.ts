import { expect, test } from '@playwright/test';

test('sidebar header reads "Goose Hub"', async ({ page }) => {
  await page.goto('/');
  // Expand sidebar if collapsed
  const toggleBtn = page.locator('[data-testid="sidebar"] button').first();
  const sidebar = page.locator('[data-testid="sidebar"]');
  // Check if collapsed (w-12 class) and expand
  const isCollapsed = await sidebar.evaluate((el) => el.classList.contains('w-12'));
  if (isCollapsed) {
    await toggleBtn.click();
  }
  await page.waitForSelector('text=Goose Hub');
  await expect(page.locator('text=Goose Hub').first()).toBeVisible();
  await expect(page.locator('text=Agentic OS')).toHaveCount(0);
  await page.screenshot({ path: 'evidence/issue-477/step-1.png' });
});
