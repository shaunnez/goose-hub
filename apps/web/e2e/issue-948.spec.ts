import { expect, test } from '@playwright/test';

test('kanban lanes show newest items at the top', async ({ page }) => {
  const projectSlug = 'goose-hub-self';

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === '/api/projects') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          projects: [
            {
              id: 'proj-1',
              name: 'Goose Hub Self',
              slug: projectSlug,
              color: '#7c3aed',
              source: { kind: 'github', repo: 'shaunnez/goose-hub' },
              defaultBranch: 'main',
            },
          ],
        }),
      });
      return;
    }

    if (url.pathname === '/api/projects/goose-hub-self/milestones') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ milestones: [] }),
      });
      return;
    }

    if (url.pathname === '/api/projects/goose-hub-self/active-milestone') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ milestoneNumber: null, source: 'fixture' }),
      });
      return;
    }

    if (url.pathname === '/api/projects/goose-hub-self/issues') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'github:shaunnez/goose-hub#101',
              externalId: '101',
              repoRef: 'shaunnez/goose-hub',
              title: 'Oldest dev item',
              body: '',
              type: 'bug',
              priority: 'medium',
              mode: 'supervised',
              state: 'factory:dev-ready',
              authorIsOwner: true,
              schedule: 'current',
              exec: 'serial',
              dependsOn: [],
              blocks: [],
              createdAt: '2024-01-01T09:00:00.000Z',
            },
            {
              id: 'github:shaunnez/goose-hub#103',
              externalId: '103',
              repoRef: 'shaunnez/goose-hub',
              title: 'Newest dev item',
              body: '',
              type: 'bug',
              priority: 'medium',
              mode: 'supervised',
              state: 'factory:dev-ready',
              authorIsOwner: true,
              schedule: 'current',
              exec: 'serial',
              dependsOn: [],
              blocks: [],
              createdAt: '2024-01-01T11:00:00.000Z',
            },
            {
              id: 'github:shaunnez/goose-hub#102',
              externalId: '102',
              repoRef: 'shaunnez/goose-hub',
              title: 'Middle dev item',
              body: '',
              type: 'bug',
              priority: 'medium',
              mode: 'supervised',
              state: 'factory:dev-ready',
              authorIsOwner: true,
              schedule: 'current',
              exec: 'serial',
              dependsOn: [],
              blocks: [],
              createdAt: '2024-01-01T10:00:00.000Z',
            },
          ],
        }),
      });
      return;
    }

    const costsMatch = url.pathname.match(/^\/api\/projects\/goose-hub-self\/issues\/(\d+)\/costs$/);
    if (costsMatch != null) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          workItemId: `github:shaunnez/goose-hub#${costsMatch[1]}`,
          totalUsd: 0,
          hasEstimated: false,
          rows: [],
        }),
      });
      return;
    }

    if (url.pathname === '/api/roster/names') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ names: [] }),
      });
      return;
    }

    if (url.pathname === '/api/projects/goose-hub-self/costs/summary') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          projectId: projectSlug,
          dailyTokensUsed: 0,
          dailyTokensLimit: 0,
          dailyCostUsd: 0,
          dailyBudgetExceeded: false,
          resetsAtUtc: '2024-01-02T00:00:00.000Z',
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
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });

  await page.route('**/events**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: '',
    });
  });

  await page.goto(`/projects/${projectSlug}`);

  const lane = page.getByTestId('lane-dev');
  const cards = lane.getByTestId('issue-card');

  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toHaveAttribute('data-issue-number', '103');
  await expect(cards.nth(1)).toHaveAttribute('data-issue-number', '102');
  await expect(cards.nth(2)).toHaveAttribute('data-issue-number', '101');
});
