import { type Route, expect, test } from '@playwright/test';

/**
 * M9 Roster UI (#263).
 *
 * Verifies the Roster page loads, shows personas grouped by role,
 * and the drill-in panel opens with run history and candidate sections.
 * All API requests are intercepted.
 */
test.describe('M9 Roster UI', () => {
  const slug = 'goose-hub-self';

  const mockPersonas = [
    {
      id: 1,
      personaName: 'alice',
      role: 'developer',
      runsTotal: 5,
      runsSucceeded: 4,
      runsFailed: 1,
      avgQualityScore: 0.85,
      lastRunAt: new Date(Date.now() - 3_600_000).toISOString(),
    },
    {
      id: 2,
      personaName: 'bob',
      role: 'qa',
      runsTotal: 3,
      runsSucceeded: 3,
      runsFailed: 0,
      avgQualityScore: 1.0,
      lastRunAt: new Date(Date.now() - 7_200_000).toISOString(),
    },
  ];

  test.beforeEach(async ({ page }) => {
    await page.route('**/projects', (route: Route) =>
      route.fulfill({
        json: { projects: [{ slug, name: 'Goose Hub (self)', color: '#6366f1' }] },
      }),
    );

    await page.route('**/projects/goose-hub-self/active-milestone', (route: Route) =>
      route.fulfill({ json: { milestoneNumber: null, source: 'github-default' } }),
    );

    await page.route(`**/projects/${slug}/issues`, (route: Route) =>
      route.fulfill({ json: { items: [] } }),
    );

    await page.route('**/roster', (route: Route) =>
      route.fulfill({ json: { personas: mockPersonas } }),
    );

    await page.route('**/roster/runs**', (route: Route) => route.fulfill({ json: { runs: [] } }));

    await page.route('**/roster/candidates**', (route: Route) =>
      route.fulfill({ json: { candidates: [] } }),
    );
  });

  test('Roster page is accessible from sidebar nav', async ({ page }) => {
    await page.goto(`/projects/${slug}`);

    const rosterLink = page.getByRole('link', { name: /roster/i });
    await expect(rosterLink).toBeVisible();
    await rosterLink.click();

    await expect(page).toHaveURL(`/projects/${slug}/roster`);
    await expect(page.getByTestId('roster-page')).toBeVisible();
  });

  test('persona cards are visible grouped by role', async ({ page }) => {
    await page.goto(`/projects/${slug}/roster`);

    await expect(page.getByTestId('roster-page')).toBeVisible();

    const cards = page.getByTestId('persona-card');
    await expect(cards).toHaveCount(2);

    await expect(page.getByText('alice')).toBeVisible();
    await expect(page.getByText('bob')).toBeVisible();
    await expect(page.getByText('developer')).toBeVisible();
    await expect(page.getByText('qa')).toBeVisible();
  });

  test('drill-in panel opens when clicking a persona card', async ({ page }) => {
    await page.goto(`/projects/${slug}/roster`);

    await page.getByTestId('persona-card').first().click();

    await expect(page.getByTestId('persona-drill-in')).toBeVisible();
  });

  test('drill-in shows run history empty state when no runs exist', async ({ page }) => {
    await page.goto(`/projects/${slug}/roster`);

    await page.getByTestId('persona-card').first().click();

    await expect(page.getByTestId('runs-empty-state')).toBeVisible();
  });

  test('drill-in shows empty state when no candidates exist', async ({ page }) => {
    await page.goto(`/projects/${slug}/roster`);

    await page.getByTestId('persona-card').first().click();

    await expect(page.getByTestId('candidates-empty-state')).toBeVisible();
  });

  test('empty state shown when roster has no personas', async ({ page }) => {
    await page.route('**/roster', (route: Route) => route.fulfill({ json: { personas: [] } }));

    await page.goto(`/projects/${slug}/roster`);

    await expect(page.getByTestId('roster-empty-state')).toBeVisible();
  });

  test('drill-in shows approve and reject buttons for a pending candidate', async ({ page }) => {
    const candidate = {
      id: 1,
      personaName: 'alice',
      sourceTaskId: 'github:owner/repo#42',
      suggestionText: 'Improve error handling in the implement skill',
      suggestionType: 'skill-prompt',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    await page.route('**/roster/candidates**', (route: Route) =>
      route.fulfill({ json: { candidates: [candidate] } }),
    );

    await page.goto(`/projects/${slug}/roster`);
    await page.getByTestId('persona-card').first().click();

    await expect(page.getByTestId('candidate-row')).toBeVisible();
    await expect(page.getByTestId('approve-btn')).toBeVisible();
    await expect(page.getByTestId('reject-btn')).toBeVisible();
    await expect(page.getByText('Improve error handling in the implement skill')).toBeVisible();
  });
});
