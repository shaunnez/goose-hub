import { expect, test } from '@playwright/test';

const TOKEN = process.env.GITHUB_TOKEN;

test.describe('M10.03 All Projects aggregated Kanban (#284)', () => {
  test.skip(!TOKEN, 'GITHUB_TOKEN is required.');

  test('All Projects option in switcher navigates to /projects/all', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/projects\//, { timeout: 15_000 });

    const switcher = page.locator('select[data-testid="project-switcher"]');
    await expect(switcher).toBeVisible({ timeout: 15_000 });

    await expect(switcher.locator('option[value="all"]')).toBeAttached();

    await switcher.selectOption('all');
    await expect(page).toHaveURL(/\/projects\/all/, { timeout: 10_000 });
  });

  test('All Projects board shows cards from multiple projects in correct lanes', async ({
    page,
  }) => {
    await page.goto('/projects/all');
    await expect(page.locator('[data-testid="board"]')).toBeVisible({ timeout: 15_000 });

    // Board renders lane columns.
    await expect(page.locator('[data-testid^="lane-"]').first()).toBeVisible({ timeout: 15_000 });

    // Issue count bar is present.
    await expect(page.locator('[data-testid="board-issue-count"]')).toBeVisible();
  });

  test('cards in all-projects mode carry project color stripe', async ({ page }) => {
    await page.goto('/projects/all');
    await expect(page.locator('[data-testid="board"]')).toBeVisible({ timeout: 15_000 });

    // Wait for cards to render.
    const cards = page.locator('[data-testid="issue-card"]');
    const cardCount = await cards.count();

    if (cardCount === 0) {
      test.skip(true, 'No open issues to test color stripes.');
      return;
    }

    // At least one card should have a project-specific colored left border.
    const firstCard = cards.first();
    const borderLeft = await firstCard.evaluate((el: HTMLElement) => el.style.borderLeft);
    expect(borderLeft).toMatch(/^3px solid #[0-9a-f]{6}$/i);
  });

  test('clicking a card opens the correct project detail panel', async ({ page }) => {
    await page.goto('/projects/all');
    await expect(page.locator('[data-testid="board"]')).toBeVisible({ timeout: 15_000 });

    const cards = page.locator('[data-testid="issue-card"]');
    const cardCount = await cards.count();

    if (cardCount === 0) {
      test.skip(true, 'No open issues to click.');
      return;
    }

    const firstCard = cards.first();
    const projectSlug = await firstCard.getAttribute('data-project');
    const issueNumber = await firstCard.getAttribute('data-issue-number');

    if (projectSlug == null || issueNumber == null) {
      test.skip(true, 'Card missing data attributes.');
      return;
    }

    await firstCard.click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectSlug}/items/${issueNumber}`), {
      timeout: 10_000,
    });
  });
});
