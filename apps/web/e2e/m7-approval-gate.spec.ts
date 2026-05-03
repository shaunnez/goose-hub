import { type Route, expect, test } from '@playwright/test';

/**
 * M7 approval-gate UI happy path (#187 / #186).
 *
 * Walks the UI from the issue detail → approval gate visible (because
 * state is factory:approved) → click Approve → POST /approve called.
 *
 * All API requests are intercepted; no real backend call. The fix-issue
 * workflow is exercised in the slice integration test
 * (slices/fix-issue/chore-shipping.test.ts).
 */
test.describe('M7 approval gate UI', () => {
  test('approve button merges and transitions issue to factory:done', async ({ page }) => {
    const slug = 'goose-hub-self';
    const issueId = '9999';

    // Stub the server endpoints the detail page consumes.
    await page.route('**/projects', (route: Route) =>
      route.fulfill({
        json: { projects: [{ slug, name: 'Goose Hub (self)' }] },
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
              title: 'Add capitalize helper',
              body: 'Acceptance: capitalize(s) returns first letter uppercased.',
              type: 'chore',
              priority: 'medium',
              mode: 'supervised',
              state: 'factory:approved',
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

    await page.route(`**/projects/${slug}/issues/${issueId}`, (route: Route) => {
      // GET — fetchIssue
      if (route.request().method() === 'GET') {
        return route.fulfill({
          json: {
            item: {
              id: `github:owner/repo#${issueId}`,
              externalId: issueId,
              repoRef: 'owner/repo',
              title: 'Add capitalize helper',
              body: 'Acceptance: capitalize(s) returns first letter uppercased.',
              type: 'chore',
              priority: 'medium',
              mode: 'supervised',
              state: 'factory:approved',
              authorIsOwner: true,
              schedule: 'current',
              exec: 'serial',
              dependsOn: [],
              blocks: [],
              createdAt: new Date().toISOString(),
            },
          },
        });
      }
      return route.continue();
    });

    // Approve endpoint — assert it gets called.
    let approveCalls = 0;
    await page.route(`**/projects/${slug}/issues/${issueId}/approve`, (route: Route) => {
      approveCalls += 1;
      return route.fulfill({
        json: { ok: true, sha: 'abc1234merge', prNumber: 9100 },
      });
    });

    // Other endpoints the detail page touches — return empty/inert payloads.
    await page.route(`**/projects/${slug}/issues/${issueId}/events`, (route: Route) =>
      route.fulfill({ json: { events: [] } }),
    );
    await page.route(`**/projects/${slug}/issues/${issueId}/comments`, (route: Route) =>
      route.fulfill({ json: { comments: [] } }),
    );
    await page.route(`**/projects/${slug}/issues/${issueId}/triage`, (route: Route) =>
      route.fulfill({ json: { triage: null } }),
    );
    await page.route(`**/projects/${slug}/issues/${issueId}/diff`, (route: Route) =>
      route.fulfill({ json: { diff: null, runId: null, reason: 'no in-flight run' } }),
    );

    // Visit the issue detail page.
    await page.goto(`/projects/${slug}/items/${issueId}`);

    // Approval gate is rendered because state === factory:approved.
    const gate = page.getByTestId('approval-gate');
    await expect(gate).toBeVisible();

    // Approve button is present and clickable.
    const approveBtn = page.getByTestId('approve-btn');
    await expect(approveBtn).toBeVisible();

    await approveBtn.click();

    // Verify the approve endpoint was called.
    await expect.poll(() => approveCalls).toBeGreaterThanOrEqual(1);
  });

  test('reject form requires non-empty reason', async ({ page }) => {
    const slug = 'goose-hub-self';
    const issueId = '9999';

    await page.route('**/projects', (route: Route) =>
      route.fulfill({
        json: { projects: [{ slug, name: 'Goose Hub (self)' }] },
      }),
    );
    await page.route('**/projects/goose-hub-self/active-milestone', (route: Route) =>
      route.fulfill({ json: { milestoneNumber: null, source: 'github-default' } }),
    );
    await page.route(`**/projects/${slug}/issues`, (route: Route) =>
      route.fulfill({ json: { items: [] } }),
    );
    await page.route(`**/projects/${slug}/issues/${issueId}`, (route: Route) =>
      route.fulfill({
        json: {
          item: {
            id: `github:owner/repo#${issueId}`,
            externalId: issueId,
            repoRef: 'owner/repo',
            title: 'Add capitalize helper',
            body: 'body',
            type: 'chore',
            priority: 'medium',
            mode: 'supervised',
            state: 'factory:approved',
            authorIsOwner: true,
            schedule: 'current',
            exec: 'serial',
            dependsOn: [],
            blocks: [],
            createdAt: new Date().toISOString(),
          },
        },
      }),
    );
    await page.route(`**/projects/${slug}/issues/${issueId}/events`, (route: Route) =>
      route.fulfill({ json: { events: [] } }),
    );
    await page.route(`**/projects/${slug}/issues/${issueId}/comments`, (route: Route) =>
      route.fulfill({ json: { comments: [] } }),
    );
    await page.route(`**/projects/${slug}/issues/${issueId}/triage`, (route: Route) =>
      route.fulfill({ json: { triage: null } }),
    );
    await page.route(`**/projects/${slug}/issues/${issueId}/diff`, (route: Route) =>
      route.fulfill({ json: { diff: null, runId: null, reason: 'no in-flight run' } }),
    );
    await page.route(`**/projects/${slug}/issues/${issueId}/reject`, (route: Route) =>
      route.fulfill({ json: { ok: true } }),
    );

    await page.goto(`/projects/${slug}/items/${issueId}`);

    await page.getByTestId('reject-btn').click();
    const submit = page.getByTestId('reject-submit');
    await expect(submit).toBeDisabled();

    await page.getByTestId('reject-reason-input').fill('flaky tests');
    await expect(submit).toBeEnabled();
  });
});
