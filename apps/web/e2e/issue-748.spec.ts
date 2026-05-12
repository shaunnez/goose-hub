import { expect, test } from '@playwright/test';

test('Logo displays "GooseHUB" with no space and capitals', async ({ page }) => {
  // Mock API endpoints to prevent network delays
  await page.route('**/api/projects*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            id: 'test-proj',
            name: 'Test Project',
            slug: 'test-proj',
            color: '#888888',
            source: { kind: 'github', repo: 'owner/repo' },
            defaultBranch: 'main',
          },
        ],
      }),
    }),
  );

  // Navigate to home page
  await page.goto('/');

  // Wait for the sidebar to be visible
  const sidebar = await page.waitForSelector('[data-testid="sidebar"]');
  expect(sidebar).toBeTruthy();

  // Check that the logo text is "GooseHUB" (not "Goose Hub")
  // Expand sidebar by clicking the toggle button if it's collapsed
  const expandButton = await page.locator('button[title="Expand sidebar"]');
  const isVisible = await expandButton.isVisible().catch(() => false);

  if (isVisible) {
    // Sidebar is collapsed, expand it
    await expandButton.click();
    // Wait for the sidebar to expand
    await page.waitForTimeout(300);
  }

  // Check for the GooseHUB text in the sidebar header
  const logoText = await page.locator('aside span.text-\\[14px\\].font-semibold').first();
  await expect(logoText).toContainText('GooseHUB');

  // Verify old text "Goose Hub" does not exist
  const oldText = page.locator('text=Goose Hub');
  await expect(oldText).toHaveCount(0);

  // Take screenshot as visual evidence
  await page.screenshot({ path: 'evidence/issue-748/step-1.png' });
});
