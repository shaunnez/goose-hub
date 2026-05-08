import { expect, test } from '@playwright/test';

test('Issue #612: Last Agent font size is properly scaled', async ({ page }) => {
  // Navigate to overview page with a mock issue
  await page.goto('/issues/511');

  // Wait for the overview section to load
  await page.waitForSelector('[data-testid="overview-section"]');

  // Find the "Last agent" stat card by looking for the label text
  const lastAgentCards = await page.locator('text=Last agent').locator('..').all();
  expect(lastAgentCards.length).toBeGreaterThan(0);

  // Get the value div (the agent name) which should be text-[14px]
  const lastAgentCard = lastAgentCards[0];
  const valueDiv = await lastAgentCard.locator('div').nth(1); // Skip label, get value

  // Verify font size is reasonable (14px = 0.875rem, computed as 14px)
  const fontSize = await valueDiv.evaluate((el) => {
    return window.getComputedStyle(el).fontSize;
  });

  // The font size should be 14px (not 20px which was the bug)
  expect(fontSize).toBe('14px');

  // Verify the agent name is visible and readable
  const agentNameText = await valueDiv.textContent();
  expect(agentNameText).toBeTruthy();
  expect(agentNameText?.length).toBeGreaterThan(0);

  // Take a screenshot showing the corrected layout
  await page.screenshot({ path: 'evidence/issue-612/step-1.png' });
});
