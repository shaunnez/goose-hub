import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('Goose hub header branding reads GooseHUB', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sidebar-collapsed', 'false');
  });

  await page.goto('/');

  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByText('GooseHUB')).toBeVisible();
  await expect(page.getByText('Goose Hub')).toHaveCount(0);

  await mkdir('evidence/issue-813', { recursive: true });
  await page.screenshot({ path: 'evidence/issue-813/step-1.png' });
});
