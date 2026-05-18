import { expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// M20.13 — Playwright e2e for hub-chat.
//
// Server is booted with MOCK_AGENTS=true + MOCK_SOURCE=true (see
// playwright-chat.config.ts), so the hub-chat skill returns deterministic
// fixtures from `core/agent-runtime/mock-outputs.ts` and the chat tools
// resolve against the in-memory state source without touching GitHub.
// ---------------------------------------------------------------------------

test.describe('hub-chat panel', () => {
  test('launcher button toggles the panel open/closed', async ({ page }) => {
    await page.goto('/projects/goose-hub-self');

    const launcher = page.locator('[data-testid="chat-launcher"]');
    const panel = page.locator('[data-testid="chat-panel"]');

    await expect(launcher).toBeVisible();
    // Closed state: translate-x-full is the off-screen class.
    await expect(panel).toHaveClass(/translate-x-full/);

    await launcher.click();
    await expect(panel).not.toHaveClass(/translate-x-full/);
    await expect(panel).toHaveClass(/translate-x-0/);

    // Close via the X button in the header.
    await panel.locator('button[aria-label="Close chat"]').click();
    await expect(panel).toHaveClass(/translate-x-full/);
  });

  test('sending a message persists it and the user bubble renders', async ({ page }) => {
    await page.goto('/projects/goose-hub-self');
    await page.locator('[data-testid="chat-launcher"]').click();

    const input = page.locator('[data-testid="chat-input"]');
    await input.fill('hello hub chat');
    await page.locator('[data-testid="chat-send"]').click();

    const userBubble = page
      .locator('[data-testid="chat-user-message"]')
      .filter({ hasText: 'hello hub chat' });
    await expect(userBubble).toBeVisible();
  });

  test('a read-only tool proposal auto-runs and renders a result card', async ({ page }) => {
    await page.goto('/projects/goose-hub-self');
    await page.locator('[data-testid="chat-launcher"]').click();

    await page.locator('[data-testid="chat-input"]').fill('please list projects for me');
    await page.locator('[data-testid="chat-send"]').click();

    // The mock hub-chat output proposes `list_projects`; because it's
    // read-only, the dispatcher auto-runs it and the card lands as completed.
    const card = page
      .locator('[data-testid="chat-tool-card"]')
      .filter({ has: page.locator('text="list_projects"') });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute('data-tool-status', 'completed', { timeout: 20_000 });
    // No Approve/Reject buttons on a read-only completion.
    await expect(card.locator('[data-testid="chat-tool-approve"]')).toHaveCount(0);
  });

  test('a mutating proposal shows Approve/Reject and rejecting marks it rejected', async ({
    page,
  }) => {
    await page.goto('/projects/goose-hub-self');
    await page.locator('[data-testid="chat-launcher"]').click();

    await page.locator('[data-testid="chat-input"]').fill('please post a comment for me');
    await page.locator('[data-testid="chat-send"]').click();

    const card = page
      .locator('[data-testid="chat-tool-card"]')
      .filter({ has: page.locator('text="comment_on_issue"') });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute('data-tool-status', 'proposed');
    await expect(card.locator('[data-testid="chat-tool-approve"]')).toBeVisible();

    await card.locator('[data-testid="chat-tool-reject"]').click();
    await expect(card).toHaveAttribute('data-tool-status', 'rejected', { timeout: 10_000 });
  });

  test('approving open_url navigates the page and closes the panel', async ({ page }) => {
    await page.goto('/projects/goose-hub-self/inbox');
    await page.locator('[data-testid="chat-launcher"]').click();

    await page.locator('[data-testid="chat-input"]').fill('please open the kanban');
    await page.locator('[data-testid="chat-send"]').click();

    const card = page
      .locator('[data-testid="chat-tool-card"]')
      .filter({ has: page.locator('text="open_url"') });
    await expect(card).toBeVisible({ timeout: 20_000 });

    await card.locator('[data-testid="chat-tool-approve"]').click();
    // Tool completes; the rendered "Open <path>" affordance triggers navigation.
    await expect(card).toHaveAttribute('data-tool-status', 'completed', { timeout: 10_000 });
    await card.locator('text=/^Open /').click();

    await expect(page).toHaveURL(/\/projects\/goose-hub-self$/);
    await expect(page.locator('[data-testid="chat-panel"]')).toHaveClass(/translate-x-full/);
  });

  test('scope chip in the header changes when the route changes', async ({ page }) => {
    await page.goto('/projects/goose-hub-self');
    await page.locator('[data-testid="chat-launcher"]').click();

    const chip = page.locator('[data-testid="chat-scope-chip"]');
    await expect(chip).toBeVisible();
    const projectScopeText = (await chip.textContent())?.trim() ?? '';
    expect(projectScopeText.length).toBeGreaterThan(0);

    // Navigate to an item route — scope should pivot from project → item.
    await page.goto('/projects/goose-hub-self/items/1');
    const itemScopeText = (await chip.textContent())?.trim() ?? '';
    expect(itemScopeText).not.toBe(projectScopeText);
  });
});
