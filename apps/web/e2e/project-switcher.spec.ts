import { expect, test } from '@playwright/test';

test.describe('M10 project switcher', () => {
  test('switcher shows all registered projects', async ({ page }) => {
    await page.goto('/');

    // Redirect lands on the first project's board.
    await expect(page).toHaveURL(/\/projects\//, { timeout: 15_000 });

    const switcher = page.locator('select[data-testid="project-switcher"]');
    await expect(switcher).toBeVisible({ timeout: 15_000 });

    // At least 2 projects must be registered (goose-hub-self + at least one more).
    const optionCount = await switcher.locator('option').count();
    expect(optionCount).toBeGreaterThanOrEqual(2);

    // goose-hub-self is always present.
    await expect(switcher.locator('option[value="goose-hub-self"]')).toBeAttached();
  });

  test('each project entry has a distinct hex color stripe', async ({ page }) => {
    await page.goto('/');

    const switcher = page.locator('select[data-testid="project-switcher"]');
    await expect(switcher).toBeVisible({ timeout: 15_000 });

    const options = await switcher.locator('option').all();
    expect(options.length).toBeGreaterThanOrEqual(2);

    const slugs = await Promise.all(options.map((o) => o.getAttribute('value')));
    const colorsBySlug: Record<string, string> = {};

    for (const slug of slugs) {
      if (!slug) continue;
      await switcher.selectOption(slug);
      // Wait for re-render so inline style reflects the new active project.
      await page.waitForTimeout(100);
      const borderLeft = await switcher.evaluate((el: HTMLSelectElement) => el.style.borderLeft);
      colorsBySlug[slug] = borderLeft;
    }

    const uniqueColors = new Set(Object.values(colorsBySlug));
    expect(uniqueColors.size).toBeGreaterThanOrEqual(2);

    for (const color of Object.values(colorsBySlug)) {
      expect(color).toMatch(/^3px solid #[0-9a-f]{6}$/i);
    }
  });

  test('selecting a different project navigates to the new project scope', async ({ page }) => {
    await page.goto('/projects/goose-hub-self');

    const switcher = page.locator('select[data-testid="project-switcher"]');
    await expect(switcher).toBeVisible({ timeout: 15_000 });

    // Pick any option that is NOT goose-hub-self.
    const options = await switcher.locator('option').all();
    const otherSlug = await (async () => {
      for (const option of options) {
        const value = await option.getAttribute('value');
        if (value && value !== 'goose-hub-self') return value;
      }
      return null;
    })();

    if (otherSlug == null) {
      test.skip(true, 'Only one project is registered; skipping scope-change check.');
      return;
    }

    await switcher.selectOption(otherSlug);

    // URL must update to the other project's board.
    await expect(page).toHaveURL(new RegExp(`/projects/${otherSlug}`), { timeout: 10_000 });
  });
});
