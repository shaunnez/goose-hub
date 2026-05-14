import { expect, test } from '@playwright/test';

test('sidebar brand reads GooseHUB', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sidebar-collapsed', 'false');
  });

  await page.goto('/');

  await expect(page.getByText('GooseHUB')).toBeVisible();
  await page.screenshot({ path: 'evidence/issue-794/step-1.png' });
});
