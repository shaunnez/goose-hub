import { test, expect } from '@playwright/test';

test('issue 675: Goose Hub logo displays "Goose Hub 2"', async ({ page }) => {
  // Navigate to the app
  await page.goto('/');

  // Wait for sidebar to be visible
  await page.waitForSelector('[data-testid="sidebar"]');

  // Assert the logo text displays "Goose Hub 2"
  const logoText = await page.locator('text=Goose Hub 2').textContent();
  expect(logoText).toContain('Goose Hub 2');

  // Take evidence screenshot
  await page.screenshot({ path: 'evidence/issue-675/step-1.png' });
});
