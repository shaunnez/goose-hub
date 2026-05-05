import { type Route, expect, test } from '@playwright/test';

/**
 * M10.09: Two-project integration verification (#285).
 *
 * All API calls are mocked — this spec verifies the UI correctly isolates
 * and aggregates data from two registered projects without requiring live
 * GitHub access.
 */

const PROJ_A = {
  slug: 'goose-hub-self',
  name: 'Goose Hub (self)',
  colorStripe: '#7c3aed',
  source: { kind: 'github', repo: 'shaunnez/goose-hub' },
  activeMilestone: 'M10: Multi-project Orchestration',
  budgets: { perWorkflowMaxUsd: 5, dailyTokens: 5_000_000, perAdvisorMaxUsd: 5 },
  mode: 'supervised',
};

const PROJ_B = {
  slug: 'nannymudnz',
  name: 'Nanny Mud NZ',
  colorStripe: '#059669',
  source: { kind: 'github', repo: 'shaunnez/nannymudnz' },
  activeMilestone: null,
  budgets: { perWorkflowMaxUsd: 3, dailyTokens: 2_000_000, perAdvisorMaxUsd: 2 },
  mode: 'supervised',
};

const ISSUE_A = {
  id: 'goose-hub-self#101',
  externalId: '101',
  title: 'Fix the widget in goose-hub',
  state: 'factory:dev-ready',
  priority: 'medium',
  labels: [],
  milestoneId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const ISSUE_B = {
  id: 'nannymudnz#42',
  externalId: '42',
  title: 'Add search page to nannymudnz',
  state: 'factory:triaging',
  priority: 'medium',
  labels: [],
  milestoneId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const PERSONA_A = {
  id: 1,
  personaName: 'goose-hub-self/developer/0',
  role: 'developer',
  runsTotal: 8,
  runsSucceeded: 7,
  runsFailed: 1,
  avgQualityScore: 0.88,
  lastRunAt: new Date(Date.now() - 3_600_000).toISOString(),
};

const PERSONA_B = {
  id: 2,
  personaName: 'nannymudnz/developer/0',
  role: 'developer',
  runsTotal: 4,
  runsSucceeded: 4,
  runsFailed: 0,
  avgQualityScore: 1.0,
  lastRunAt: new Date(Date.now() - 7_200_000).toISOString(),
};

async function setupCommonRoutes(page: import('@playwright/test').Page) {
  await page.route('**/api/projects', (route: Route) =>
    route.fulfill({
      json: {
        projects: [
          {
            id: PROJ_A.slug,
            slug: PROJ_A.slug,
            name: PROJ_A.name,
            color: PROJ_A.colorStripe,
            source: PROJ_A.source,
            defaultBranch: 'main',
          },
          {
            id: PROJ_B.slug,
            slug: PROJ_B.slug,
            name: PROJ_B.name,
            color: PROJ_B.colorStripe,
            source: PROJ_B.source,
            defaultBranch: 'main',
          },
        ],
      },
    }),
  );

  await page.route('**/api/projects/configs', (route: Route) =>
    route.fulfill({ json: { configs: [PROJ_A, PROJ_B] } }),
  );

  await page.route(`**/api/projects/${PROJ_A.slug}/issues`, (route: Route) =>
    route.fulfill({ json: { items: [ISSUE_A] } }),
  );

  await page.route(`**/api/projects/${PROJ_B.slug}/issues`, (route: Route) =>
    route.fulfill({ json: { items: [ISSUE_B] } }),
  );

  await page.route(`**/api/projects/${PROJ_A.slug}/active-milestone`, (route: Route) =>
    route.fulfill({ json: { milestoneNumber: 10, source: 'config' } }),
  );

  await page.route(`**/api/projects/${PROJ_B.slug}/active-milestone`, (route: Route) =>
    route.fulfill({ json: { milestoneNumber: null, source: 'github-default' } }),
  );

  await page.route(`**/api/projects/${PROJ_A.slug}/milestones`, (route: Route) =>
    route.fulfill({
      json: {
        milestones: [{ number: 10, title: 'M10: Multi-project Orchestration', state: 'open' }],
      },
    }),
  );

  await page.route(`**/api/projects/${PROJ_B.slug}/milestones`, (route: Route) =>
    route.fulfill({ json: { milestones: [] } }),
  );

  await page.route('**/api/roster', (route: Route) =>
    route.fulfill({ json: { personas: [PERSONA_A, PERSONA_B] } }),
  );

  await page.route('**/api/roster/runs**', (route: Route) => route.fulfill({ json: { runs: [] } }));
  await page.route('**/api/roster/candidates**', (route: Route) =>
    route.fulfill({ json: { candidates: [] } }),
  );

  // Suppress SSE — not needed for these tests.
  await page.route('**/events**', (route: Route) => route.fulfill({ status: 200, body: '' }));
}

test.describe('M10.09: Two-project integration (#285)', () => {
  test.beforeEach(async ({ page }) => {
    await setupCommonRoutes(page);
  });

  // ─── Project Switcher ────────────────────────────────────────────────────────

  test.describe('Project Switcher', () => {
    test('shows both registered projects with distinct colors', async ({ page }) => {
      await page.goto(`/projects/${PROJ_A.slug}`);
      const switcher = page.locator('[data-testid="project-switcher"]');
      await expect(switcher).toBeVisible({ timeout: 15_000 });

      await expect(switcher.locator(`option[value="${PROJ_A.slug}"]`)).toBeAttached();
      await expect(switcher.locator(`option[value="${PROJ_B.slug}"]`)).toBeAttached();
    });

    test('switching project navigates to the other project board', async ({ page }) => {
      await page.goto(`/projects/${PROJ_A.slug}`);
      const switcher = page.locator('[data-testid="project-switcher"]');
      await expect(switcher).toBeVisible({ timeout: 15_000 });

      await switcher.selectOption(PROJ_B.slug);
      await expect(page).toHaveURL(new RegExp(`/projects/${PROJ_B.slug}`), { timeout: 10_000 });
    });

    test('All Projects option navigates to /projects/all', async ({ page }) => {
      await page.goto(`/projects/${PROJ_A.slug}`);
      const switcher = page.locator('[data-testid="project-switcher"]');
      await expect(switcher).toBeVisible({ timeout: 15_000 });

      await switcher.selectOption('all');
      await expect(page).toHaveURL(/\/projects\/all/, { timeout: 10_000 });
    });
  });

  // ─── All Projects Board ──────────────────────────────────────────────────────

  test.describe('All Projects Board', () => {
    test('shows issues from both projects in correct lanes', async ({ page }) => {
      await page.goto('/projects/all');
      const board = page.locator('[data-testid="board"]');
      await expect(board).toBeVisible({ timeout: 15_000 });

      // Total issue count = 2 (one from each project).
      await expect(page.locator('[data-testid="board-issue-count"]')).toHaveText('2 issues', {
        timeout: 15_000,
      });
    });

    test('cards carry distinct project color stripes', async ({ page }) => {
      await page.goto('/projects/all');
      await expect(page.locator('[data-testid="board"]')).toBeVisible({ timeout: 15_000 });

      const cards = page.locator('[data-testid="issue-card"]');
      await expect(cards).toHaveCount(2, { timeout: 15_000 });

      const borders = await cards.evaluateAll((els: HTMLElement[]) =>
        els.map((el) => el.style.borderLeft),
      );
      const colors = new Set(borders);
      // Both projects have different colors, so both stripes should be distinct.
      expect(colors.size).toBe(2);
      for (const border of borders) {
        expect(border).toMatch(/^3px solid #[0-9a-f]{6}$/i);
      }
    });

    test('project A card has its own color stripe, project B has its own', async ({ page }) => {
      await page.goto('/projects/all');
      await expect(page.locator('[data-testid="board"]')).toBeVisible({ timeout: 15_000 });

      const cardA = page.locator(`[data-testid="issue-card"][data-project="${PROJ_A.slug}"]`);
      const cardB = page.locator(`[data-testid="issue-card"][data-project="${PROJ_B.slug}"]`);

      await expect(cardA).toBeVisible({ timeout: 15_000 });
      await expect(cardB).toBeVisible({ timeout: 15_000 });

      const borderA = await cardA.evaluate((el: HTMLElement) => el.style.borderLeft);
      const borderB = await cardB.evaluate((el: HTMLElement) => el.style.borderLeft);
      expect(borderA).toContain(PROJ_A.colorStripe);
      expect(borderB).toContain(PROJ_B.colorStripe);
    });

    test('clicking a card navigates to the correct project detail URL', async ({ page }) => {
      await page.route(
        `**/api/projects/${PROJ_A.slug}/issues/${ISSUE_A.externalId}`,
        (route: Route) => route.fulfill({ json: { item: ISSUE_A } }),
      );

      await page.goto('/projects/all');
      await expect(page.locator('[data-testid="board"]')).toBeVisible({ timeout: 15_000 });

      const cardA = page.locator(`[data-testid="issue-card"][data-project="${PROJ_A.slug}"]`);
      await expect(cardA).toBeVisible({ timeout: 15_000 });
      await cardA.click();

      await expect(page).toHaveURL(
        new RegExp(`/projects/${PROJ_A.slug}/items/${ISSUE_A.externalId}`),
        { timeout: 10_000 },
      );
    });
  });

  // ─── Roster Cross-Project Filter ─────────────────────────────────────────────

  test.describe('Roster cross-project filter', () => {
    test('shows project filter buttons for both projects', async ({ page }) => {
      await page.goto(`/projects/${PROJ_A.slug}/roster`);
      await expect(page.getByTestId('roster-page')).toBeVisible({ timeout: 15_000 });

      await expect(page.getByTestId('project-filter')).toBeVisible();
      await expect(page.getByTestId('filter-all')).toBeVisible();
      await expect(page.getByTestId(`filter-${PROJ_A.slug}`)).toBeVisible();
      await expect(page.getByTestId(`filter-${PROJ_B.slug}`)).toBeVisible();
    });

    test('"All Projects" view shows personas from both projects', async ({ page }) => {
      await page.goto(`/projects/${PROJ_A.slug}/roster`);
      await expect(page.getByTestId('roster-page')).toBeVisible({ timeout: 15_000 });

      // Default scope is "All Projects".
      await expect(page.getByTestId('persona-card')).toHaveCount(2, { timeout: 10_000 });
    });

    test('filtering by project A shows only project A personas', async ({ page }) => {
      await page.goto(`/projects/${PROJ_A.slug}/roster`);
      await expect(page.getByTestId('roster-page')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('persona-card')).toHaveCount(2, { timeout: 10_000 });

      await page.getByTestId(`filter-${PROJ_A.slug}`).click();
      await expect(page.getByTestId('persona-card')).toHaveCount(1);
    });

    test('filtering by project B shows only project B personas', async ({ page }) => {
      await page.goto(`/projects/${PROJ_A.slug}/roster`);
      await expect(page.getByTestId('roster-page')).toBeVisible({ timeout: 15_000 });

      await page.getByTestId(`filter-${PROJ_B.slug}`).click();
      await expect(page.getByTestId('persona-card')).toHaveCount(1);
    });

    test('switching back to "All Projects" restores all personas', async ({ page }) => {
      await page.goto(`/projects/${PROJ_A.slug}/roster`);
      await expect(page.getByTestId('roster-page')).toBeVisible({ timeout: 15_000 });

      await page.getByTestId(`filter-${PROJ_A.slug}`).click();
      await expect(page.getByTestId('persona-card')).toHaveCount(1);

      await page.getByTestId('filter-all').click();
      await expect(page.getByTestId('persona-card')).toHaveCount(2);
    });

    test('personas in "All Projects" view carry project color badge', async ({ page }) => {
      await page.goto(`/projects/${PROJ_A.slug}/roster`);
      await expect(page.getByTestId('roster-page')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('persona-card')).toHaveCount(2, { timeout: 10_000 });

      // Both personas should show project badges when >1 project and scope=all.
      const badges = page.locator('[data-testid="roster-project-badge"]');
      await expect(badges).toHaveCount(2);
    });
  });

  // ─── Per-project milestone isolation ─────────────────────────────────────────

  test.describe('Per-project milestone isolation', () => {
    test('project A board shows its own issue; project B board shows its own', async ({ page }) => {
      await page.goto(`/projects/${PROJ_A.slug}`);
      await expect(page.locator('[data-testid="board"]')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-testid="board-issue-count"]')).toHaveText('1 issue', {
        timeout: 15_000,
      });

      await page.goto(`/projects/${PROJ_B.slug}`);
      await expect(page.locator('[data-testid="board"]')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-testid="board-issue-count"]')).toHaveText('1 issue', {
        timeout: 15_000,
      });
    });
  });
});
