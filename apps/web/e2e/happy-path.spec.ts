import { expect, test } from '@playwright/test';

const HAS_TOKEN = (process.env.GITHUB_TOKEN ?? '').length > 0;

test.describe('M2 happy path', () => {
  test.skip(!HAS_TOKEN, 'GITHUB_TOKEN is required to talk to GitHub.');

  test('open app → kanban → detail → timeline → transition', async ({ page }) => {
    test.setTimeout(60_000);

    // 1. Open Goose Hub.
    await page.goto('/');
    await expect(page).toHaveURL(/\/projects\/goose-hub-self/);

    // 2. Project auto-selected.
    await expect(page.getByTestId('project-switcher')).toHaveValue('goose-hub-self');

    // 3. Kanban visible with at least one issue.
    const board = page.getByTestId('board');
    await expect(board).toBeVisible();
    const cards = page.getByTestId('issue-card');
    // Wait for issues to load.
    await expect.poll(async () => await cards.count(), { timeout: 15_000 }).toBeGreaterThan(0);

    // 4. Click an issue (prefer triaging so the transition flow has options).
    const triagingCard = cards
      .filter({ has: page.locator('[data-state="factory:triaging"]') })
      .first();
    const target = (await triagingCard.count()) > 0 ? triagingCard : cards.first();
    const cardNumber = await target.getAttribute('data-issue-number');
    await target.click();

    // 5. Detail page opens with the 10-section left rail.
    await expect(page.getByTestId('detail-page')).toBeVisible();
    await expect(page.getByTestId('detail-left-rail')).toBeVisible();

    // 6. Overview shows body.
    await expect(page.getByTestId('overview-section')).toBeVisible();
    await expect(page.getByTestId('overview-body')).toBeVisible();

    // 7. Right rail empty-state present.
    await expect(page.getByTestId('detail-right-rail')).toContainText(/No agent runs/i);

    // 8. Navigate to Timeline section.
    await page.getByRole('link', { name: 'Timeline' }).click();
    await expect(page.getByTestId('timeline-section')).toBeVisible();

    // 9. If the work item has legal next states, verify the popover renders them.
    const transitionBtn = page.getByTestId('transition-button');
    if ((await transitionBtn.count()) > 0) {
      await transitionBtn.click();
      const popover = page.getByTestId('transition-popover');
      await expect(popover).toBeVisible();
      const targets = popover.locator('button[data-testid^="transition-target-"]');
      await expect(targets.first()).toBeVisible();
    }

    // 10. Direct URL roundtrip works.
    if (cardNumber != null) {
      await page.goto(`/projects/goose-hub-self/items/${cardNumber}`);
      await expect(page.getByTestId('detail-page')).toBeVisible();
    }

    // 11. Back to Board returns us.
    await page.getByTestId('back-to-board').click();
    await expect(page.getByTestId('board')).toBeVisible();
  });
});
