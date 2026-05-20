import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('sidebar branding says Agentic OS', async ({ page }) => {
  await page.route('**/api/projects/configs', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configs: [] }),
    });
  });

  await page.goto('/settings');

  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByText('Agentic OS')).toBeVisible();

  mkdirSync('evidence/issue-901', { recursive: true });
  await page.screenshot({ path: 'evidence/issue-901/step-1.png' });
});
