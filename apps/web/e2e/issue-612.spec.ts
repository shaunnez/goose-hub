import { type Route, expect, test } from '@playwright/test';

/**
 * Regression guard for #612 — "Fix oversized 'Last Agent' text on overview".
 *
 * All API requests are intercepted; no real backend call. Verifies that the
 * "Last agent" stat card on the OverviewSection renders the persona label at
 * the corrected 14px size without overflowing the card.
 */

const slug = 'goose-hub-self';
const externalId = '612';
const PERSONA_ID = 'goose-hub-self/developer/0';

function buildIssue() {
  return {
    id: `github:owner/repo#${externalId}`,
    externalId,
    repoRef: 'owner/repo',
    title: 'Fix oversized Last Agent text on overview',
    body: 'Last Agent stat card was rendering at an oversized font.',
    type: 'bug',
    priority: 'medium',
    mode: 'supervised',
    state: 'factory:done',
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date().toISOString(),
    lastPersonaId: PERSONA_ID,
  };
}

test('Last agent stat card renders persona label at 14px without overflow', async ({ page }) => {
  await page.route('**/api/projects', (route: Route) =>
    route.fulfill({ json: { projects: [{ slug, name: 'Goose Hub (self)' }] } }),
  );
  await page.route('**/api/projects/goose-hub-self/active-milestone', (route: Route) =>
    route.fulfill({ json: { milestoneNumber: null, source: 'github-default' } }),
  );
  await page.route(`**/api/projects/${slug}/issues`, (route: Route) =>
    route.fulfill({ json: { items: [buildIssue()] } }),
  );
  await page.route(`**/api/projects/${slug}/issues/${externalId}`, (route: Route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { item: buildIssue() } });
    }
    return route.continue();
  });
  await page.route(`**/api/projects/${slug}/issues/${externalId}/comments`, (route: Route) =>
    route.fulfill({ json: { comments: [] } }),
  );
  await page.route(`**/api/projects/${slug}/issues/${externalId}/events`, (route: Route) =>
    route.fulfill({ json: { events: [] } }),
  );
  await page.route(`**/api/projects/${slug}/issues/${externalId}/triage`, (route: Route) =>
    route.fulfill({ json: { triage: null } }),
  );
  await page.route(`**/api/projects/${slug}/issues/${externalId}/diff`, (route: Route) =>
    route.fulfill({ json: { diff: null, runId: null, reason: 'no in-flight run' } }),
  );
  await page.route(`**/api/projects/${slug}/issues/${externalId}/costs`, (route: Route) =>
    route.fulfill({
      json: { workItemId: externalId, totalUsd: 0, hasEstimated: false, rows: [] },
    }),
  );
  await page.route('**/api/roster/names', (route: Route) =>
    route.fulfill({
      json: {
        names: [{ personaId: PERSONA_ID, codename: 'Spectacled Treefrog', role: 'developer' }],
      },
    }),
  );

  await page.goto(`/projects/${slug}/items/${externalId}`);

  const overview = page.getByTestId('overview-section');
  await expect(overview).toBeVisible();

  // "Last agent" label must be present in the stat row
  await expect(overview.getByText('Last agent', { exact: false })).toBeVisible();

  // Persona label rendered with role abbreviation
  const personaValue = overview.getByText('Spectacled Treefrog (DEV)');
  await expect(personaValue).toBeVisible();

  // Value element must carry the corrected 14px sizing class, not an oversized variant
  const cls = await personaValue.evaluate((el) => el.className);
  expect(cls).toContain('text-[14px]');

  // Value must not exceed the overview section width (no horizontal overflow)
  const valueBounds = await personaValue.boundingBox();
  const overviewBounds = await overview.boundingBox();
  if (valueBounds && overviewBounds) {
    expect(valueBounds.x + valueBounds.width).toBeLessThanOrEqual(
      overviewBounds.x + overviewBounds.width + 1, // 1 px rounding tolerance
    );
  }

  await page.screenshot({ path: 'evidence/issue-612/step-1.png' });
});
