import { expect, test } from '@playwright/test';

test('Timeline agent.model-selected event renders formatted content', async ({ page }) => {
  // Mock the events API to return an agent.model-selected event
  await page.route('**/api/events/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        events: [
          {
            id: 1,
            projectId: 'test-proj',
            workItemId: 'test-wi',
            kind: 'agent.model-selected',
            payload: {
              runId: 'test-run-123',
              role: 'developer',
              selectedTier: 'haiku',
              reason: 'type-chore',
            },
            createdAt: new Date().toISOString(),
          },
        ],
        hasMore: false,
      }),
    });
  });

  // Navigate to an issue detail page
  await page.goto('/issues/1');
  await page.waitForSelector('[data-event-kind="agent.model-selected"]');

  // Verify the event is rendered with proper formatting
  const eventElement = page.locator('[data-event-kind="agent.model-selected"]');
  expect(await eventElement.isVisible()).toBe(true);

  // Verify the content shows formatted labels instead of raw JSON
  const headerText = eventElement.locator('.font-mono.uppercase.tracking-wider').first();
  expect(await headerText.textContent()).toContain('Model selected');

  // Verify payload details are displayed
  const content = await eventElement.textContent();
  expect(content).toContain('developer');
  expect(content).toContain('haiku');
  expect(content).toContain('type-chore');

  // Verify no raw JSON is visible (it should be formatted)
  expect(content).not.toContain('{');
  expect(content).not.toContain('}');

  // Take screenshot as evidence
  await page.screenshot({ path: 'evidence/issue-655/step-1.png' });
});
