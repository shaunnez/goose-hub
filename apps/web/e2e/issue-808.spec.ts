import { expect, test } from '@playwright/test';

test('GooseHUB header is shown in the app shell', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sidebar-collapsed', 'false');
  });

  await page.goto('/');
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByText('GooseHUB')).toBeVisible();

  await page.screenshot({ path: 'evidence/issue-808/step-1.png' });
});
