import { expect, test } from '@playwright/test';

test('Kanban board lanes show newest issues first', async ({ page }) => {
  await page.route('**/api/projects/goose-hub-self/active-milestone', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ milestoneNumber: null, source: 'test' }),
    }),
  );

  await page.route('**/api/projects/goose-hub-self/milestones', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ milestones: [] }),
    }),
  );

  await page.route('**/api/projects/goose-hub-self/issues', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            id: 'github:goose-hub-self#101',
            externalId: '101',
            repoRef: 'goose-hub-self',
            title: 'Oldest item',
            body: 'Test body',
            type: 'bug',
            priority: 'medium',
            mode: 'supervised',
            state: 'factory:in-progress',
            authorIsOwner: true,
            schedule: 'current',
            exec: 'serial',
            dependsOn: [],
            blocks: [],
            createdAt: '2024-01-01T00:00:00.000Z',
          },
          {
            id: 'github:goose-hub-self#103',
            externalId: '103',
            repoRef: 'goose-hub-self',
            title: 'Middle item',
            body: 'Test body',
            type: 'bug',
            priority: 'high',
            mode: 'supervised',
            state: 'factory:in-progress',
            authorIsOwner: true,
            schedule: 'current',
            exec: 'serial',
            dependsOn: [],
            blocks: [],
            createdAt: '2024-01-03T00:00:00.000Z',
          },
          {
            id: 'github:goose-hub-self#102',
            externalId: '102',
            repoRef: 'goose-hub-self',
            title: 'Newest item',
            body: 'Test body',
            type: 'bug',
            priority: 'low',
            mode: 'supervised',
            state: 'factory:in-progress',
            authorIsOwner: true,
            schedule: 'current',
            exec: 'serial',
            dependsOn: [],
            blocks: [],
            createdAt: '2024-01-04T00:00:00.000Z',
          },
        ],
      }),
    }),
  );

  await page.route('**/api/projects/goose-hub-self/issues/*/costs', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        workItemId: 'github:goose-hub-self#101',
        totalUsd: 0,
        hasEstimated: false,
        rows: [],
      }),
    }),
  );

  await page.route('**/api/projects/goose-hub-self/costs/summary', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        projectId: 'goose-hub-self',
        dailyTokensUsed: 0,
        dailyTokensLimit: 0,
        dailyCostUsd: 0,
        dailyBudgetExceeded: false,
        resetsAtUtc: '2024-01-01T00:00:00.000Z',
        lastExceededAt: null,
        windows: {
          week: { totalUsd: 0, totalRuns: 0, hasEstimated: false },
          month: { totalUsd: 0, totalRuns: 0, hasEstimated: false },
        },
        byStage: [],
        byProvider: {
          claude: { totalUsd: 0, totalRuns: 0, hasEstimated: false },
          codex: { totalUsd: 0, totalRuns: 0, hasEstimated: false },
        },
        symbolIndex: {
          lookupCount: 0,
          averageIdentifiersPerLookup: 0,
          averageHintsPerLookup: 0,
          staleRate: 0,
          hintsUsedEventCount: 0,
          usedHintCount: 0,
          hintsByConsumerSkill: {},
        },
      }),
    }),
  );

  await page.route('**/api/roster/names', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ names: [] }),
    }),
  );

  await page.route('**/events*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: '',
    }),
  );

  await page.goto('/projects/goose-hub-self');

  const lane = page.locator('[data-testid="lane-dev"]');
  await expect(lane).toBeVisible();

  const cards = lane.locator('[data-testid="issue-card"]');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toHaveAttribute('data-issue-number', '102');
  await expect(cards.nth(1)).toHaveAttribute('data-issue-number', '103');
  await expect(cards.nth(2)).toHaveAttribute('data-issue-number', '101');

  await page.screenshot({ path: 'evidence/issue-927/kanban-newest-first.png' });
});
