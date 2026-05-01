import { expect, test } from '@playwright/test';

const REPO = 'shaunnez/goose-hub';
const TEST_MILESTONE_TITLE = '[E2E] Test Fixture';
const TOKEN = process.env.GITHUB_TOKEN ?? '';

async function gh(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path} → ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

test.describe('M2 happy path', () => {
  test.skip(!TOKEN, 'GITHUB_TOKEN is required.');

  let milestoneNumber: number;
  let issueNumber: number;

  test.beforeAll(async () => {
    // Find or create the test milestone.
    const all = (await gh(`/repos/${REPO}/milestones?state=all&per_page=100`)) as unknown as Array<{
      number: number;
      title: string;
      state: string;
    }>;
    let ms = all.find((m) => m.title === TEST_MILESTONE_TITLE);
    if (!ms) {
      ms = (await gh(`/repos/${REPO}/milestones`, 'POST', {
        title: TEST_MILESTONE_TITLE,
        state: 'open',
        description: 'Automated E2E fixture — do not use for real issues.',
      })) as { number: number; title: string; state: string };
    } else if (ms.state === 'closed') {
      await gh(`/repos/${REPO}/milestones/${ms.number}`, 'PATCH', { state: 'open' });
    }
    milestoneNumber = ms.number;

    // Create a test issue with the minimal labels the board needs.
    const issue = (await gh(`/repos/${REPO}/issues`, 'POST', {
      title: '[E2E] Test issue — safe to close',
      body: 'Automated fixture created by the happy-path E2E test.',
      milestone: milestoneNumber,
      labels: [
        'factory:triaging',
        'priority:high',
        'type:chore',
        'schedule:current',
        'mode:supervised',
        'exec:serial',
      ],
    })) as { number: number };
    issueNumber = issue.number;
  });

  test.afterAll(async () => {
    if (issueNumber) {
      await gh(`/repos/${REPO}/issues/${issueNumber}`, 'PATCH', { state: 'closed' });
    }
    if (milestoneNumber) {
      await gh(`/repos/${REPO}/milestones/${milestoneNumber}`, 'PATCH', { state: 'closed' });
    }
  });

  test('open app → kanban → detail → timeline → transition', async ({ page }) => {
    test.setTimeout(90_000);

    // 1. Open Goose Hub.
    await page.goto('/');
    await expect(page).toHaveURL(/\/projects\/goose-hub-self/);

    // 2. Project auto-selected.
    await expect(page.getByTestId('project-switcher')).toHaveValue('goose-hub-self');

    // 3. Select the test milestone so only our seeded issue appears.
    // Wait for the <select> specifically — the loading div shares the same testid.
    const milestoneSelector = page.locator('select[data-testid="milestone-selector"]');
    await expect(milestoneSelector).toBeVisible({ timeout: 15_000 });
    await milestoneSelector.selectOption({ value: String(milestoneNumber) });

    // 4. Kanban visible with the seeded issue.
    const board = page.getByTestId('board');
    await expect(board).toBeVisible();
    const cards = page.getByTestId('issue-card');
    await expect.poll(async () => cards.count(), { timeout: 15_000 }).toBeGreaterThan(0);

    // 5. Click the seeded issue card.
    const target = cards.filter({ hasText: '[E2E]' }).first();
    const cardNumber = await target.getAttribute('data-issue-number');
    await target.click();

    // 6. Detail page opens with the 10-section left rail.
    await expect(page.getByTestId('detail-page')).toBeVisible();
    await expect(page.getByTestId('detail-left-rail')).toBeVisible();

    // 7. Overview shows body.
    await expect(page.getByTestId('overview-section')).toBeVisible();
    await expect(page.getByTestId('overview-body')).toBeVisible();

    // 8. Right rail empty-state present.
    await expect(page.getByTestId('detail-right-rail')).toContainText(/No agent runs/i);

    // 9. Navigate to Timeline section.
    await page.getByRole('link', { name: 'Timeline' }).click();
    await expect(page.getByTestId('timeline-section')).toBeVisible();

    // 10. If the work item has legal next states, verify the popover renders them.
    const transitionBtn = page.getByTestId('transition-button');
    if ((await transitionBtn.count()) > 0) {
      await transitionBtn.click();
      const popover = page.getByTestId('transition-popover');
      await expect(popover).toBeVisible();
      const targets = popover.locator('button[data-testid^="transition-target-"]');
      await expect(targets.first()).toBeVisible();
    }

    // 11. Direct URL roundtrip works.
    if (cardNumber != null) {
      await page.goto(`/projects/goose-hub-self/items/${cardNumber}`);
      await expect(page.getByTestId('detail-page')).toBeVisible();
    }

    // 12. Back to Board returns us.
    await page.getByTestId('back-to-board').click();
    await expect(page.getByTestId('board')).toBeVisible();
  });
});
