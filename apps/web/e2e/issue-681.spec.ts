import { expect, test } from '@playwright/test';

test('Sidebar displays GooseHUB logo with correct branding', async ({ page }) => {
  // Mock the API endpoints to return minimal test data
  await page.route('**/api/projects/*/issues', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [] }),
    }),
  );

  await page.route('**/api/projects/*/issues/*/timeline*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );

  // Navigate to the home page
  await page.goto('/');

  // Wait for sidebar to be visible
  const sidebar = await page.waitForSelector('[data-testid="sidebar"]');
  expect(sidebar).toBeTruthy();

  // Assert the logo text is "GooseHUB" (no space, all capitals)
  const logoText = await page.textContent('span.text-\\[14px\\].font-semibold');
  expect(logoText).toContain('GooseHUB');

  // Verify it does NOT contain the old branding "Goose Hub"
  expect(logoText).not.toContain('Goose hub');
  expect(logoText).not.toContain('Goose Hub');

  // Take a screenshot as visual evidence
  await page.screenshot({ path: 'evidence/issue-681/step-1.png' });
});
