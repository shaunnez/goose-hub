import { expect, test } from '@playwright/test';

test('sidebar shows the shared Goose Hub wordmark when expanded', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('sidebar-collapsed', 'false');
  });

  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );

  await page.goto('/settings');

  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByText('Goose Hub')).toBeVisible();
  await expect(page.getByTestId('settings-page')).toBeVisible();

  await page.screenshot({ path: 'evidence/issue-889/step-1.png' });
});
