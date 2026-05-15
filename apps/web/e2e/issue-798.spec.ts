import { expect, test } from '@playwright/test';

test('sidebar wordmark shows Goosey Goose Hub branding', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('sidebar-collapsed');
  });

  await page.goto('/');

  await expect(page.getByTestId('sidebar')).toBeVisible();
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.getByText('Goosey Goose Hub')).toBeVisible();

  await page.screenshot({ path: 'evidence/issue-798/step-1.png' });
});
