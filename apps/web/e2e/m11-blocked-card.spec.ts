import { type Page, type Route, expect, test } from '@playwright/test';

/**
 * M11.05: UI — blocked status on Kanban card (#297).
 *
 * Verifies that a card with schedule:blocked-by shows the Blocked indicator,
 * the tooltip lists the blocking dep refs, and the indicator disappears when
 * the dep closes and the board re-fetches a clean schedule.
 *
 * All API calls are intercepted; no real backend required.
 */

const slug = 'goose-hub-self';

const BLOCKED_ITEM = {
  id: 'github:shaunnez/goose-hub#200',
  externalId: '200',
  repoRef: 'shaunnez/goose-hub',
  title: 'Add feature X',
  body: 'Depends on #199',
  type: 'feature',
  priority: 'medium',
  mode: 'supervised',
  state: 'factory:dev-ready',
  authorIsOwner: true,
  schedule: 'blocked-by',
  exec: 'serial',
  dependsOn: ['shaunnez/goose-hub#199'],
  blocks: [],
  createdAt: new Date().toISOString(),
};

const UNBLOCKED_ITEM = { ...BLOCKED_ITEM, schedule: 'current', dependsOn: [] };

function stubCommon(page: Page) {
  return Promise.all([
    page.route('**/projects', (r: Route) =>
      r.fulfill({ json: { projects: [{ slug, name: 'Goose Hub (self)' }] } }),
    ),
    page.route('**/projects/configs', (r: Route) =>
      r.fulfill({
        json: {
          configs: [
            {
              slug,
              name: 'Goose Hub (self)',
              colorStripe: '#7c3aed',
              activeMilestone: null,
              budgets: { perWorkflowMaxUsd: 10, dailyTokens: 5000000, perAdvisorMaxUsd: 2 },
              mode: 'supervised',
              source: { kind: 'github', repo: 'shaunnez/goose-hub' },
            },
          ],
        },
      }),
    ),
    page.route(`**/projects/${slug}/active-milestone`, (r: Route) =>
      r.fulfill({ json: { milestoneNumber: null, source: 'github-default' } }),
    ),
    page.route(`**/projects/${slug}/milestones`, (r: Route) =>
      r.fulfill({ json: { milestones: [] } }),
    ),
    page.route(`**/projects/${slug}/issues/*/costs`, (r: Route) =>
      r.fulfill({ json: { workItemId: 'w1', totalUsd: 0, hasEstimated: false, rows: [] } }),
    ),
    page.route('**/events*', (r: Route) =>
      r.fulfill({ contentType: 'text/event-stream', body: '' }),
    ),
  ]);
}

test.describe('M11.05 — blocked card indicator', () => {
  test('blocked card shows indicator with dep tooltip', async ({ page }) => {
    await stubCommon(page);
    await page.route(`**/projects/${slug}/issues`, (r: Route) =>
      r.fulfill({ json: { items: [BLOCKED_ITEM] } }),
    );

    await page.goto(`/projects/${slug}`);
    await page.waitForSelector('[data-testid="issue-card"]');

    const indicator = page.getByTestId('blocked-indicator');
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveText(/Blocked/);

    // Tooltip content is in the title attribute (native browser tooltip)
    const title = await indicator.getAttribute('title');
    expect(title).toContain('#199');
  });

  test('non-blocked card does not show blocked indicator', async ({ page }) => {
    await stubCommon(page);
    await page.route(`**/projects/${slug}/issues`, (r: Route) =>
      r.fulfill({ json: { items: [UNBLOCKED_ITEM] } }),
    );

    await page.goto(`/projects/${slug}`);
    await page.waitForSelector('[data-testid="issue-card"]');

    await expect(page.getByTestId('blocked-indicator')).toHaveCount(0);
  });

  test('card returns to normal state after dep closes (board re-fetch)', async ({ page }) => {
    await stubCommon(page);

    // First fetch: blocked
    let callCount = 0;
    await page.route(`**/projects/${slug}/issues`, (r: Route) => {
      callCount += 1;
      r.fulfill({ json: { items: callCount === 1 ? [BLOCKED_ITEM] : [UNBLOCKED_ITEM] } });
    });

    await page.goto(`/projects/${slug}`);
    await page.waitForSelector('[data-testid="issue-card"]');
    await expect(page.getByTestId('blocked-indicator')).toBeVisible();

    // Navigate away and back to force a re-fetch with the updated (unblocked) item
    await page.goto('/');
    await page.goto(`/projects/${slug}`);
    await page.waitForSelector('[data-testid="issue-card"]');

    await expect(page.getByTestId('blocked-indicator')).toHaveCount(0);
  });
});
