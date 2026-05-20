import { expect, test } from '@playwright/test';

test('sidebar shows the GOOSEHUB brand label when expanded', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('sidebar-collapsed', 'false');
  });

  await page.goto('/');
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByText('GOOSEHUB')).toBeVisible();
  await page.screenshot({ path: 'evidence/issue-876/step-1.png' });
});
