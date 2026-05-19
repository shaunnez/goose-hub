import { expect, test } from '@playwright/test';

test('sidebar shows the Goose Hub brand label when expanded', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sidebar-collapsed', 'false');
  });

  await page.goto('/projects/goose-hub-self');

  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByText('Goose Hub')).toBeVisible();

  await page.screenshot({ path: 'evidence/issue-861/step-1.png' });
});
