import { expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// Acceptance test for issue #415:
// "Adding an idea to the inbox needs to refresh the list and select the new item"
// ---------------------------------------------------------------------------

test.describe('inbox capture', () => {
  test('capturing an idea refreshes the list and selects the new item', async ({ page }) => {
    await page.goto('/projects/goose-hub-self/inbox');

    // Open the capture modal
    await page.click('[data-testid="capture-button"]');
    await expect(page.locator('[data-testid="capture-title-input"]')).toBeVisible();

    const title = `E2E capture ${Date.now()}`;
    await page.fill('[data-testid="capture-title-input"]', title);
    await page.click('[data-testid="capture-submit"]');

    // Modal closes after successful submit
    await expect(page.locator('[data-testid="capture-title-input"]')).not.toBeVisible();

    // New item appears in the inbox list
    const newItem = page.locator('[data-testid="inbox-item"]').filter({ hasText: title });
    await expect(newItem).toBeVisible();

    // Detail panel shows the new item selected (h2 heading matches the title)
    await expect(page.locator('h2').filter({ hasText: title })).toBeVisible();
  });

  test('newly captured item is highlighted as selected in the list', async ({ page }) => {
    await page.goto('/projects/goose-hub-self/inbox');

    await page.click('[data-testid="capture-button"]');
    const title = `E2E select check ${Date.now()}`;
    await page.fill('[data-testid="capture-title-input"]', title);
    await page.click('[data-testid="capture-submit"]');

    // Wait for list to refresh
    await expect(
      page.locator('[data-testid="inbox-item"]').filter({ hasText: title }),
    ).toBeVisible();

    // The list item for the new idea should have the selected style (bg-accent class applied)
    const itemButton = page
      .locator('[data-testid="inbox-item"]')
      .filter({ hasText: title })
      .locator('button');
    await expect(itemButton).toHaveClass(/bg-accent/);
  });
});
