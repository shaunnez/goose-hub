import { expect, test } from '@playwright/test';

/**
 * Evidence spec for #513: Expand / Collapse all accordions on the timeline page.
 * Mocks the events API so run-groups always render regardless of live DB state.
 */
test('expand and collapse all timeline run-groups', async ({ page }) => {
  const now = Date.now();

  // Two run-groups (run-a and run-b) with 2 events each.
  const events = [
    {
      id: 1,
      projectId: 'p',
      workItemId: 'wi-1',
      kind: 'agent.run-started',
      payload: {},
      runId: 'run-a',
      createdAt: new Date(now - 8000).toISOString(),
    },
    {
      id: 2,
      projectId: 'p',
      workItemId: 'wi-1',
      kind: 'agent.run-completed',
      payload: {},
      runId: 'run-a',
      createdAt: new Date(now - 6000).toISOString(),
    },
    {
      id: 3,
      projectId: 'p',
      workItemId: 'wi-1',
      kind: 'agent.run-started',
      payload: {},
      runId: 'run-b',
      createdAt: new Date(now - 4000).toISOString(),
    },
    {
      id: 4,
      projectId: 'p',
      workItemId: 'wi-1',
      kind: 'agent.run-completed',
      payload: {},
      runId: 'run-b',
      createdAt: new Date(now - 2000).toISOString(),
    },
  ];

  await page.route('**/api/*/events**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(events) }),
  );

  // SSE endpoint — return an empty stream so the connection is established but silent.
  await page.route('**/events*', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }),
  );

  // Costs API
  await page.route('**/api/*/costs**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  );

  await page.goto('/issues/513');

  // Wait for the expand-all button to appear (signals run-groups rendered).
  await page.waitForSelector('[data-testid="timeline-expand-all"]');

  // Screenshot: initial state (all expanded by default).
  await page.screenshot({ path: 'evidence/issue-513/step-1-initial.png', fullPage: true });

  // Click "Collapse all" and assert all run-group <details> are closed.
  await page.click('[data-testid="timeline-collapse-all"]');
  await expect(page.locator('[data-run-id] details')).toHaveCount(2);
  for (const detail of await page.locator('[data-run-id] details').all()) {
    await expect(detail).not.toHaveAttribute('open');
  }
  await page.screenshot({ path: 'evidence/issue-513/step-2-collapsed.png', fullPage: true });

  // Click "Expand all" and assert all run-group <details> are open.
  await page.click('[data-testid="timeline-expand-all"]');
  for (const detail of await page.locator('[data-run-id] details').all()) {
    await expect(detail).toHaveAttribute('open');
  }
  await page.screenshot({ path: 'evidence/issue-513/step-3-expanded.png', fullPage: true });
});
