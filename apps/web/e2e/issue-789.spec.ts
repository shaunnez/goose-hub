import { expect, test } from '@playwright/test';

test('sidebar branding reads GooseHUB in the expanded chrome', async ({ page }) => {
  await page.goto('/projects/goose-hub-self');

  const sidebar = page.getByTestId('sidebar');
  await expect(sidebar).toBeVisible();

  await page.getByRole('button', { name: 'Expand sidebar' }).click();

  await expect(page.getByText('GooseHUB', { exact: true })).toBeVisible();
  await expect(page.getByText('Goose Hub', { exact: true })).toHaveCount(0);

  await page.screenshot({ path: 'evidence/issue-789/step-1.png' });
});
