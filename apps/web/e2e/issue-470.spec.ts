import { expect, test } from '@playwright/test';

test.describe('issue-470: sidebar header reads "Agentic OS"', () => {
  test('sidebar header label is "Agentic OS"', async ({ page }) => {
    await page.goto('/');
    // Wait for sidebar to be present
    await page.waitForSelector('[data-testid="sidebar"]');

    // Expand sidebar if collapsed (look for the expand button)
    const expandBtn = page.getByTitle('Expand sidebar');
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
    }

    // Wait for the header text to appear
    await page.waitForSelector('text=Agentic OS');

    await expect(page.getByText('Agentic OS')).toBeVisible();
    await expect(page.getByText('Goose Hub')).not.toBeVisible();

    await page.screenshot({ path: 'evidence/issue-470/step-1.png' });
  });
});
