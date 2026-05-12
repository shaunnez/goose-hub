import { type Route, expect, test } from '@playwright/test';

/**
 * Issue #739: Goose hub logo wrong 16.
 *
 * The sidebar logo text should display "GooseHUB" (no space, all capitals)
 * instead of "Goose hub" (with space, mixed case).
 *
 * Navigates to the app, verifies the sidebar header displays the correct
 * branding text, and captures visual evidence.
 */
test.describe('Issue #739: Sidebar branding text', () => {
  test('sidebar displays "GooseHUB" with correct capitalization', async ({ page }) => {
    const slug = 'goose-hub-self';

    // Stub the projects endpoint
    await page.route('**/projects', (route: Route) =>
      route.fulfill({
        json: { projects: [{ slug, name: 'Goose Hub' }] },
      }),
    );

    // Stub the active milestone endpoint
    await page.route('**/active-milestone', (route: Route) =>
      route.fulfill({ json: { milestoneNumber: null, source: 'github-default' } }),
    );

    // Stub the issues endpoint (empty list)
    await page.route('**/issues', (route: Route) =>
      route.fulfill({ json: { items: [] } }),
    );

    // Navigate to home — should redirect to /projects/goose-hub-self
    await page.goto('/');

    // Wait for sidebar to be visible and check the logo text
    const logoText = page.locator('aside span:has-text("GooseHUB")');
    await expect(logoText).toBeVisible();

    // Verify the exact text content
    await expect(logoText).toContainText('GooseHUB');

    // Take evidence screenshot
    await page.screenshot({ path: 'evidence/issue-739/step-1.png' });
  });
});
