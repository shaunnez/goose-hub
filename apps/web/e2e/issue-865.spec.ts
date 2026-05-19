import { expect, test } from '@playwright/test';

test('sidebar brand label shows GOOSEHUB', async ({ page }) => {
  await page.route('**/api/projects', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        projects: [
          {
            id: 'goose-hub-self',
            name: 'Goose Hub (self)',
            slug: 'goose-hub-self',
            color: '#7c3aed',
            source: { kind: 'local', repo: 'goose-hub' },
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/configs', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configs: [] }),
    });
  });

  await page.goto('/settings');

  await expect(page.getByTestId('sidebar')).toBeVisible();
  await expect(page.getByText('GOOSEHUB')).toBeVisible();

  await page.screenshot({ path: 'evidence/issue-865/step-1.png' });
});
