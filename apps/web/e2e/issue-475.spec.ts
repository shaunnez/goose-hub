import { expect, test } from '@playwright/test';

test.describe('issue-475: sidebar brand label', () => {
  test('sidebar header reads "Agentic OS" not "Goose Hub"', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="sidebar"]');

    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar).toContainText('Agentic OS');
    await expect(sidebar).not.toContainText('Goose Hub');

    await page.screenshot({ path: 'evidence/issue-475/step-1.png' });
  });
});
