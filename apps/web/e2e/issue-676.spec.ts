import { type Route, expect, test } from '@playwright/test';

/**
 * Evidence spec for sprint review #676 (M14: Work Mode Foundation).
 *
 * The sprint review noted that issue-612 shipped without a regression spec,
 * leaving the "Last agent" stat-card fix uncovered during QA's REGRESSION_CHECK.
 * This spec ships alongside issue-612.spec.ts to close that gap.
 *
 * All API requests are intercepted; no real backend call. Verifies that the
 * "Last agent" stat card on the OverviewSection renders the persona label at
 * the corrected 14 px size (not an oversized variant) with no horizontal overflow.
 */

const slug = 'goose-hub-self';
const externalId = '676';
const PERSONA_ID = 'goose-hub-self/developer/0';

// Long codename stress-tests overflow; a persona with an abbreviated role still
// produces a label like "Magnificent Whistling Whistler (DEV)" that must fit.
const LONG_CODENAME = 'Magnificent Whistling Whistler';

function buildIssue() {
  return {
    id: `github:owner/repo#${externalId}`,
    externalId,
    repoRef: 'owner/repo',
    title: 'Sprint Review: M14: Work Mode Foundation',
    body: 'Sprint review documenting shipped items and next-sprint suggestions.',
    type: 'chore',
    priority: 'low',
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

test('Last agent stat card renders at 14px with no overflow (regression guard for #612)', async ({
  page,
}) => {
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
        names: [{ personaId: PERSONA_ID, codename: LONG_CODENAME, role: 'developer' }],
      },
    }),
  );

  await page.goto(`/projects/${slug}/items/${externalId}`);

  const overview = page.getByTestId('overview-section');
  await expect(overview).toBeVisible();

  // "Last agent" label visible in stat row
  await expect(overview.getByText('Last agent', { exact: false })).toBeVisible();

  // Persona value with role abbreviation must render
  const expectedLabel = `${LONG_CODENAME} (DEV)`;
  const personaValue = overview.getByText(expectedLabel);
  await expect(personaValue).toBeVisible();

  // Font size must be the corrected 14px — not an oversized variant.
  // This assertion would fail if StatCard regressed to a larger size class.
  const computedFontSize = await personaValue.evaluate((el) => {
    return window.getComputedStyle(el).fontSize;
  });
  // 14px == 14px; any larger value means regression
  const sizeNum = parseFloat(computedFontSize);
  expect(sizeNum).toBeLessThanOrEqual(14);

  // Persona value must not overflow the overview section horizontally
  const valueBounds = await personaValue.boundingBox();
  const overviewBounds = await overview.boundingBox();
  if (valueBounds && overviewBounds) {
    expect(valueBounds.x + valueBounds.width).toBeLessThanOrEqual(
      overviewBounds.x + overviewBounds.width + 1, // 1 px rounding tolerance
    );
  }

  await page.screenshot({ path: 'evidence/issue-676/step-1.png' });
});
