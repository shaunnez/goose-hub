import { expect, test } from '@playwright/test';

const slug = 'goose-hub-self';

const project = {
  id: 'project-goose-hub-self',
  name: 'Goose Hub',
  slug,
  color: '#7c3aed',
  source: { kind: 'github', repo: 'shaunnez/goose-hub' },
};

const issue = (overrides: Record<string, unknown>) => ({
  id: 'github:shaunnez/goose-hub#1',
  externalId: '1',
  repoRef: 'shaunnez/goose-hub',
  title: 'Placeholder',
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
  createdAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

const newest = issue({
  id: 'github:shaunnez/goose-hub#300',
  externalId: '300',
  title: 'Newest item',
  createdAt: '2024-01-03T12:00:00.000Z',
});

const middle = issue({
  id: 'github:shaunnez/goose-hub#200',
  externalId: '200',
  title: 'Middle item',
  createdAt: '2024-01-02T12:00:00.000Z',
});

const oldest = issue({
  id: 'github:shaunnez/goose-hub#100',
  externalId: '100',
  title: 'Oldest item',
  createdAt: '2024-01-01T12:00:00.000Z',
});

test('kanban lane cards render newest first', async ({ page }) => {
  await page.route('**/projects', (route) => route.fulfill({ json: { projects: [project] } }));
  await page.route('**/projects/configs', (route) =>
    route.fulfill({
      json: {
        configs: [
          {
            slug,
            name: 'Goose Hub',
            colorStripe: '#7c3aed',
            activeMilestone: null,
            budgets: { perWorkflowMaxUsd: 10, dailyTokens: 5_000_000, perAdvisorMaxUsd: 2 },
            mode: 'supervised',
            source: { kind: 'github', repo: 'shaunnez/goose-hub' },
          },
        ],
      },
    }),
  );
  await page.route(`**/projects/${slug}/active-milestone`, (route) =>
    route.fulfill({ json: { milestoneNumber: null, source: 'github-default' } }),
  );
  await page.route(`**/projects/${slug}/milestones`, (route) =>
    route.fulfill({ json: { milestones: [] } }),
  );
  await page.route('**/roster/names', (route) => route.fulfill({ json: { names: [] } }));
  await page.route(`**/projects/${slug}/issues`, (route) =>
    route.fulfill({ json: { items: [oldest, newest, middle] } }),
  );
  await page.route(`**/projects/${slug}/issues/*/costs`, (route) =>
    route.fulfill({ json: { workItemId: 'wi-1', totalUsd: 0, hasEstimated: false, rows: [] } }),
  );
  await page.route('**/events*', (route) =>
    route.fulfill({ contentType: 'text/event-stream', body: '' }),
  );

  await page.goto(`/projects/${slug}`);
  await expect(page.getByTestId('board')).toBeVisible();

  const lane = page.getByTestId('lane-triage');
  await expect(lane).toBeVisible();

  const cards = lane.getByTestId('issue-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toHaveAttribute('data-issue-number', '300');
  await expect(cards.nth(1)).toHaveAttribute('data-issue-number', '200');
  await expect(cards.nth(2)).toHaveAttribute('data-issue-number', '100');
});
