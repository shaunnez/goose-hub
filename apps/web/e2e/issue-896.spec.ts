import { expect, test } from '@playwright/test';

test('sidebar branding shows Agentic OS when expanded', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sidebar-collapsed', 'false');
  });

  await page.goto('/projects/goose-hub-self');

  await expect(page.getByTestId('sidebar').getByText('Agentic OS')).toBeVisible();
  await page.screenshot({ path: 'evidence/issue-896/step-1.png' });
});
