import { expect, test } from '@playwright/test';

test('sidebar branding shows The Goose', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('sidebar-collapsed', 'false');
  });

  await page.goto('/projects/goose-hub-self');

  await expect(page.getByTestId('sidebar')).toContainText('The Goose');
  await page.screenshot({ path: 'evidence/issue-888/step-1.png' });
});
