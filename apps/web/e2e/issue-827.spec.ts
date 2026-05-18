import { expect, test } from '@playwright/test';

test('sidebar brand reads GOOSEHUB', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sidebar-collapsed', 'false');
  });

  await page.goto('/projects/goose-hub-self');

  const sidebar = page.getByTestId('sidebar');
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByText('GOOSEHUB')).toBeVisible();

  await page.screenshot({ path: 'evidence/issue-827/step-1.png' });
});
