import { expect, test } from '@playwright/test';

test('sidebar header reads "Agentic OS" not "Goose Hub"', async ({ page }) => {
  await page.goto('/');

  // Expand sidebar if collapsed
  const sidebar = page.getByTestId('sidebar');
  await sidebar.waitFor({ state: 'visible' });

  // Expand if the sidebar is collapsed (w-12 means collapsed)
  const sidebarClass = await sidebar.getAttribute('class');
  if (sidebarClass?.includes('w-12')) {
    const toggle = sidebar.locator('[data-testid="sidebar-toggle"], button').first();
    await toggle.click();
  }

  // Assert the header label
  await expect(page.getByText('Agentic OS')).toBeVisible();
  await expect(page.getByText('Goose Hub')).not.toBeVisible();

  await page.screenshot({ path: 'evidence/issue-462/step-1.png' });
});
