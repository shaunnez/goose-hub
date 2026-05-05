import { expect, test } from '@playwright/test';

test.describe('issue-477: sidebar brand label', () => {
  test('sidebar header reads "Goose Hub" not "Agentic OS"', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="sidebar"]');

    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar).toContainText('Goose Hub');
    await expect(sidebar).not.toContainText('Agentic OS');

    await page.screenshot({ path: 'evidence/issue-477/step-1.png' });
  });
});
