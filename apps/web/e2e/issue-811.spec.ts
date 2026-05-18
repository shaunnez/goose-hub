import { expect, test } from '@playwright/test';

test('sidebar header shows GooseHUB', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('sidebar-collapsed', 'false');
  });

  await page.route('**/api/projects', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ projects: [] }),
    });
  });

  await page.route('**/api/projects/configs', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configs: [] }),
    });
  });

  await page.goto('/settings');

  await expect(page.getByText('GooseHUB')).toBeVisible();
  await page.screenshot({ path: 'evidence/issue-811/step-1.png' });
});
