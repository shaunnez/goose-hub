import { expect, test } from '@playwright/test';

test('sidebar branding shows Agentic OS', async ({ page }) => {
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
            source: { kind: 'github', repo: 'shaunnez/goose-hub' },
          },
        ],
      }),
    });
  });

  await page.addInitScript(() => {
    localStorage.setItem('sidebar-collapsed', 'false');
  });

  await page.goto('/');

  const sidebar = page.getByTestId('sidebar');
  const header = sidebar.locator('div').first();
  await expect(header).toContainText('Agentic OS');
  await expect(header).not.toContainText('Goose Hub');
  await page.screenshot({ path: 'evidence/issue-903/step-1.png' });
});
