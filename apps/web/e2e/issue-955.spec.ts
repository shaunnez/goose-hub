import { expect, test } from '@playwright/test';

const projectSlug = 'goose-hub-self';

function costSummary() {
  return {
    projectId: projectSlug,
    dailyTokensUsed: 0,
    dailyTokensLimit: 10_000,
    dailyCostUsd: 0,
    dailyBudgetExceeded: false,
    resetsAtUtc: '2026-05-23T00:00:00.000Z',
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
  };
}

test('kanban lanes render newest items first', async ({ page }) => {
  await page.route('**/api/projects/goose-hub-self/issues**', async (route) => {
    const items = [
      {
        id: 'github:org/repo#101',
        externalId: '101',
        repoRef: 'org/repo',
        title: 'Newest triage item',
        body: '',
        type: 'bug',
        priority: 'medium',
        mode: 'supervised',
        state: 'factory:triaging',
        authorIsOwner: true,
        schedule: 'current',
        exec: 'serial',
        dependsOn: [],
        blocks: [],
        createdAt: '2026-05-22T03:00:00.000Z',
      },
      {
        id: 'github:org/repo#99',
        externalId: '99',
        repoRef: 'org/repo',
        title: 'Middle triage item',
        body: '',
        type: 'bug',
        priority: 'medium',
        mode: 'supervised',
        state: 'factory:triaging',
        authorIsOwner: true,
        schedule: 'current',
        exec: 'serial',
        dependsOn: [],
        blocks: [],
        createdAt: '2026-05-22T02:00:00.000Z',
      },
      {
        id: 'github:org/repo#88',
        externalId: '88',
        repoRef: 'org/repo',
        title: 'Oldest triage item',
        body: '',
        type: 'bug',
        priority: 'medium',
        mode: 'supervised',
        state: 'factory:triaging',
        authorIsOwner: true,
        schedule: 'current',
        exec: 'serial',
        dependsOn: [],
        blocks: [],
        createdAt: '2026-05-22T01:00:00.000Z',
      },
    ];

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items }),
    });
  });

  await page.route('**/api/projects/goose-hub-self/milestones**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ milestones: [] }),
    });
  });

  await page.route('**/api/projects/goose-hub-self/active-milestone**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ milestoneNumber: null, source: 'db' }),
    });
  });

  await page.route('**/api/projects/goose-hub-self/costs**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(costSummary()),
    });
  });

  await page.route('**/events*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'retry: 1000\n\n',
    });
  });

  await page.goto('/projects/goose-hub-self');

  const lane = page.getByTestId('lane-triage');
  await expect(lane).toBeVisible();

  const issueNumbers = await lane
    .getByTestId('issue-card')
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-issue-number')));

  expect(issueNumbers).toEqual(['101', '99', '88']);
});
