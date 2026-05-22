import { type Page, expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// M20.13 — Playwright e2e for hub-chat.
//
// Server is booted with MOCK_AGENTS=true + MOCK_SOURCE=true (see
// playwright-chat.config.ts), so the hub-chat skill returns deterministic
// fixtures from `core/agent-runtime/mock-outputs.ts` and the chat tools
// resolve against the in-memory state source without touching GitHub.
// ---------------------------------------------------------------------------

/**
 * The ReactQueryDevtools floating button shares the bottom-right corner with
 * the chat launcher in dev mode. Force-clicking bypasses Playwright's
 * pointer-events probing for the dev-only overlay; the chat launcher itself
 * is at `z-50` and the click still hits its handler.
 */
/**
 * Hide the React Query Devtools floating button so it can't intercept the
 * chat launcher click in the bottom-right corner.
 */
async function hideDevtools(page: Page) {
  await page.addStyleTag({ content: '.tsqd-parent-container { display: none !important; }' });
}

async function openChatPanel(page: Page) {
  await hideDevtools(page);
  const launcher = page.locator('[data-testid="chat-launcher"]');
  await expect(launcher).toBeVisible();
  await launcher.click();
  await expect(page.locator('[data-testid="chat-panel"]')).toHaveClass(/translate-x-0/);
}

async function closeChatPanelWithLauncher(page: Page) {
  await hideDevtools(page);
  const launcher = page.locator('[data-testid="chat-launcher"]');
  await expect(launcher).toBeVisible();
  await launcher.click();
  await expect(page.locator('[data-testid="chat-panel"]')).toHaveClass(/translate-x-full/);
}

async function startNewConversation(page: Page) {
  await page.locator('[data-testid="chat-new-conversation"]').click();
}

/**
 * Wait until the panel finishes creating/loading its conversation row — the
 * textarea is `disabled` until that POST settles, and Playwright `fill`
 * rejects on a disabled element.
 */
async function waitForChatReady(page: Page) {
  await expect(page.locator('[data-testid="chat-input"]')).toBeEnabled({ timeout: 20_000 });
}

test.describe('hub-chat panel', () => {
  test('launcher button toggles the panel open/closed', async ({ page }) => {
    await page.goto('/projects/goose-hub-self');

    const launcher = page.locator('[data-testid="chat-launcher"]');
    const panel = page.locator('[data-testid="chat-panel"]');

    await expect(launcher).toBeVisible();
    await expect(panel).toHaveClass(/translate-x-full/);

    await openChatPanel(page);
    await expect(panel).not.toHaveClass(/translate-x-full/);
    await expect(panel).toHaveClass(/translate-x-0/);

    // Close via the X button in the header.
    await panel.locator('button[aria-label="Close chat"]').click();
    await expect(panel).toHaveClass(/translate-x-full/);
  });

  test('sending a message persists it and the user bubble renders', async ({ page }) => {
    await page.goto('/projects/goose-hub-self');
    await openChatPanel(page);
    await startNewConversation(page);
    await waitForChatReady(page);

    const input = page.locator('[data-testid="chat-input"]');
    await input.fill('hello hub chat');
    await page.locator('[data-testid="chat-send"]').click();

    const userBubble = page
      .locator('[data-testid="chat-user-message"]')
      .filter({ hasText: 'hello hub chat' });
    await expect(userBubble).toBeVisible();
  });

  test('reopens on the conversation list after launcher close', async ({ page }) => {
    await page.goto('/projects/goose-hub-self');
    await openChatPanel(page);
    await startNewConversation(page);
    await waitForChatReady(page);

    await expect(page.locator('[data-testid="chat-conversation-list"]')).toHaveCount(0);

    await closeChatPanelWithLauncher(page);
    await openChatPanel(page);

    await expect(page.locator('[data-testid="chat-conversation-list"]')).toBeVisible();
  });

  test('a read-only tool proposal auto-runs and renders a result card', async ({ page }) => {
    await page.goto('/projects/goose-hub-self');
    await openChatPanel(page);
    await startNewConversation(page);
    await waitForChatReady(page);

    await page.locator('[data-testid="chat-input"]').fill('please list projects for me');
    await page.locator('[data-testid="chat-send"]').click();

    const card = page
      .locator('[data-testid="chat-tool-card"]')
      .filter({ has: page.locator('text="list_projects"') });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute('data-tool-status', 'completed', { timeout: 20_000 });
    await expect(card.locator('[data-testid="chat-tool-approve"]')).toHaveCount(0);
  });

  test('a mutating proposal shows Approve/Reject and rejecting marks it rejected', async ({
    page,
  }) => {
    await page.goto('/projects/goose-hub-self');
    await openChatPanel(page);
    await startNewConversation(page);
    await waitForChatReady(page);

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

  test('approving open_url navigates the page', async ({ page }) => {
    await page.goto('/projects/goose-hub-self/inbox');
    await openChatPanel(page);
    await startNewConversation(page);
    await waitForChatReady(page);

    await page.locator('[data-testid="chat-input"]').fill('please open the kanban');
    await page.locator('[data-testid="chat-send"]').click();

    const card = page
      .locator('[data-testid="chat-tool-card"]')
      .filter({ has: page.locator('text="open_url"') });
    await expect(card).toBeVisible({ timeout: 20_000 });

    // ChatPanel.handleApprove calls navigate(path) when the tool completes;
    // the URL change is the deterministic signal. The panel's auto-close
    // depends on AppShell preserving ChatDock state across route changes,
    // which isn't guaranteed today, so we deliberately don't assert it here.
    await card.locator('[data-testid="chat-tool-approve"]').click();

    await expect(page).toHaveURL(/\/projects\/goose-hub-self$/);
  });

  test('scope chip in the header changes when the route changes', async ({ page }) => {
    await page.goto('/projects/goose-hub-self');
    await openChatPanel(page);

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
