import { expect, test } from '@playwright/test';

test('Kanban board milestone text truncates properly without overflow', async ({ page }) => {
  // Mock the API endpoints to return test data with long milestone names
  await page.route('**/api/projects/*/issues', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'item-1',
          externalId: '101',
          repoRef: 'test/repo',
          title: 'Test Issue 1',
          body: 'Test body',
          type: 'feature',
          priority: 'high',
          mode: 'supervised',
          state: 'factory:in-progress',
          authorIsOwner: true,
          schedule: 'current',
          exec: 'serial',
          dependsOn: [],
          blocks: [],
          createdAt: new Date().toISOString(),
          milestoneTitle: 'M99: Very Long Milestone Name That Should Be Truncated',
        },
      ]),
    }),
  );

  await page.route('**/api/projects/*/issues/*/timeline*', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );

  // Navigate to the board
  await page.goto('/');

  // Wait for the milestone badge to be rendered
  const milestoneBadge = await page.waitForSelector('[data-testid="milestone-badge"]');

  // Verify the badge is visible and properly styled
  const isVisible = await milestoneBadge.isVisible();
  expect(isVisible).toBe(true);

  // Get computed styles to verify truncation is applied
  const computedStyle = await milestoneBadge.evaluate(el => {
    const style = window.getComputedStyle(el);
    return {
      overflow: style.overflow,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
      display: style.display,
      width: el.offsetWidth,
    };
  });

  // Verify truncation CSS is applied
  expect(computedStyle.overflow).toBe('hidden');
  expect(computedStyle.textOverflow).toBe('ellipsis');
  expect(computedStyle.whiteSpace).toBe('nowrap');

  // Verify the milestone badge doesn't overflow its container
  const card = await page.locator('[data-testid="issue-card"]').first();
  const cardBounds = await card.boundingBox();
  const badgeBounds = await milestoneBadge.boundingBox();

  if (cardBounds && badgeBounds) {
    // Badge should be within card bounds (with small margin for padding)
    expect(badgeBounds.x).toBeGreaterThanOrEqual(cardBounds.x);
    expect(badgeBounds.x + badgeBounds.width).toBeLessThanOrEqual(
      cardBounds.x + cardBounds.width,
    );
  }

  // Take a screenshot as visual evidence
  await page.screenshot({ path: 'evidence/issue-522/step-1.png' });
});
