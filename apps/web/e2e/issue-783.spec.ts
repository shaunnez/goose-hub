import { expect, test } from '@playwright/test';

test('sidebar header shows GooseHUB branding on the home route', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sidebar-collapsed', 'false');
  });

  await page.goto('/');

  await expect(page.getByText('GooseHUB')).toBeVisible();

  await page.screenshot({ path: 'evidence/issue-783/step-1.png' });
});
