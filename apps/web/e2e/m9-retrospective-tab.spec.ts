import { type Route, expect, test } from '@playwright/test';

/**
 * M9 retrospective tab UI (#261).
 *
 * Verifies that a merged (factory:done) task shows the Retrospective tab,
 * and that the tab renders light retro output when a retrospective.completed
 * event is present. All API requests are intercepted.
 */
test.describe('M9 retrospective tab', () => {
  const slug = 'goose-hub-self';
  const issueId = '9001';
  const retroEvent = {
    id: 100,
    projectId: slug,
    workItemId: `github:owner/repo#${issueId}`,
    kind: 'retrospective.completed',
    payload: {
      tier: 'light',
      output: {
        outcome: 'success',
        workItemNumber: 9001,
        summary: {
          wentWell: 'All tests pass',
          didNotGoWell: 'No issues',
          architecturalTakeaway: 'Keep it up',
        },
        improvementCandidates: [],
        decisionSummaries: [{ kind: 'VERDICT', summary: 'Clean run' }],
      },
    },
    runId: 'run-abc',
    createdAt: new Date().toISOString(),
  };

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
      route.fulfill({
        json: {
          items: [
            {
              id: `github:owner/repo#${issueId}`,
              externalId: issueId,
              repoRef: 'owner/repo',
              title: 'Shipped feature',
              body: 'body',
              type: 'feature',
              priority: 'medium',
              mode: 'supervised',
              state: 'factory:done',
              authorIsOwner: true,
              schedule: 'current',
              exec: 'serial',
              dependsOn: [],
              blocks: [],
              createdAt: new Date().toISOString(),
            },
          ],
        },
      }),
    );

    await page.route(`**/projects/${slug}/issues/${issueId}`, (route: Route) =>
      route.fulfill({
        json: {
          id: `github:owner/repo#${issueId}`,
          externalId: issueId,
          repoRef: 'owner/repo',
          title: 'Shipped feature',
          body: 'body',
          type: 'feature',
          priority: 'medium',
          mode: 'supervised',
          state: 'factory:done',
          authorIsOwner: true,
          schedule: 'current',
          exec: 'serial',
          dependsOn: [],
          blocks: [],
          createdAt: new Date().toISOString(),
        },
      }),
    );

    await page.route(`**/projects/${slug}/issues/${issueId}/events`, (route: Route) =>
      route.fulfill({ json: { events: [retroEvent] } }),
    );
  });

  test('retrospective tab is visible for a factory:done task', async ({ page }) => {
    await page.goto(`/projects/${slug}/items/${issueId}/retrospective`);

    const retroLink = page.getByRole('link', { name: /retrospective/i });
    await expect(retroLink).toBeVisible();
  });

  test('retrospective section renders light retro summary', async ({ page }) => {
    await page.goto(`/projects/${slug}/items/${issueId}/retrospective`);

    await expect(page.getByTestId('retro-section')).toBeVisible();
    await expect(page.getByText('All tests pass')).toBeVisible();
  });

  test('retrospective section shows empty state when no retro event exists', async ({ page }) => {
    await page.route(`**/projects/${slug}/issues/${issueId}/events`, (route: Route) =>
      route.fulfill({ json: { events: [] } }),
    );

    await page.goto(`/projects/${slug}/items/${issueId}/retrospective`);

    await expect(page.getByTestId('retro-empty-state')).toBeVisible();
  });
});
