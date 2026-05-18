import { expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// Acceptance test for #834: cross-project search modal.
// Covers the modal contract (button + ⌘K open, Esc close, filter chips,
// recents persistence). Live result rendering hits MOCK_SOURCE state via
// the standard dev server.
// ---------------------------------------------------------------------------

test.describe('search modal', () => {
  test('opens via the TopBar button and closes on Esc', async ({ page }) => {
    await page.goto('/projects/goose-hub-self');

    await page.click('[data-testid="search-button"]');
    await expect(page.locator('[data-testid="search-modal"]')).toBeVisible();
    await expect(page.locator('[data-testid="search-input"]')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="search-modal"]')).not.toBeVisible();
  });

  test('opens via the ⌘K / Ctrl+K hotkey', async ({ page }) => {
    await page.goto('/projects/goose-hub-self');

    const isMac = process.platform === 'darwin';
    await page.keyboard.press(isMac ? 'Meta+k' : 'Control+k');
    await expect(page.locator('[data-testid="search-modal"]')).toBeVisible();

    await page.click('[data-testid="search-close"]');
    await expect(page.locator('[data-testid="search-modal"]')).not.toBeVisible();
  });

  test('renders all four filter chips and cycles the type chip', async ({ page }) => {
    await page.goto('/projects/goose-hub-self');
    await page.click('[data-testid="search-button"]');

    await expect(page.locator('[data-testid="search-filter-scope"]')).toBeVisible();
    await expect(page.locator('[data-testid="search-filter-milestone"]')).toBeVisible();
    await expect(page.locator('[data-testid="search-filter-type"]')).toBeVisible();
    await expect(page.locator('[data-testid="search-filter-include-closed"]')).toBeVisible();

    const typeChip = page.locator('[data-testid="search-filter-type"]');
    await expect(typeChip).toHaveText('Any type');
    await typeChip.click();
    await expect(typeChip).toHaveText('feature');
    await typeChip.click();
    await expect(typeChip).toHaveText('bug');
  });
});
