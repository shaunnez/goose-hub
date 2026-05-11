/**
 * 3A smoke test: codex provider toggle in Settings → Models.
 *
 * These tests exercise the Models settings panel at the UI level. They do not
 * require a Codex CLI token to be installed; where auth is needed the test
 * either checks for the "disabled" state or is marked to skip.
 */
import { expect, test } from '@playwright/test';

// goose-hub-self is the canonical test project; it must exist in the DB.
const PROJECT_SLUG = 'goose-hub-self';
// developer role is a non-holdout role safe to patch in tests.
const TEST_ROLE = 'developer';

test.describe('Settings → Models (3A smoke)', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the settings models tab for the test project.
    await page.goto(`/projects/${PROJECT_SLUG}/settings?tab=models`);
    await page.waitForSelector('table', { timeout: 10_000 });
  });

  test('"All → Claude" button is always enabled', async ({ page }) => {
    const btn = page.getByRole('button', { name: /All → Claude/i });
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  test('"All → Codex" pill is disabled when codex-auth is missing', async ({ page }) => {
    // The UI reads codex auth status and disables the button if not connected.
    // In CI without a real auth token this must be disabled.
    const btn = page.getByRole('button', { name: /All → Codex/i });
    await expect(btn).toBeVisible();

    // Check codex auth status via the API to decide expected state.
    const authRes = await page.request.get(`/api/projects/${PROJECT_SLUG}/settings/codex-auth`);
    const auth = (await authRes.json()) as { status: string };

    if (auth.status === 'missing') {
      await expect(btn).toBeDisabled();
    } else {
      await expect(btn).toBeEnabled();
    }
  });

  test('setting primary provider to codex persists and subtitle updates', async ({ page }) => {
    // Skip if Codex CLI is not connected — we can't meaningfully test provider
    // selection without it (the option is disabled in the UI).
    const authRes = await page.request.get(`/api/projects/${PROJECT_SLUG}/settings/codex-auth`);
    const auth = (await authRes.json()) as { status: string };
    test.skip(
      auth.status !== 'connected',
      'Codex CLI not connected — skipping codex provider assertion',
    );

    // Snapshot the current primary settings so we can restore them exactly,
    // rather than deleting the whole row (which would wipe unrelated overrides).
    const beforeRes = await page.request.get(`/api/projects/${PROJECT_SLUG}/settings/models`);
    const before = (await beforeRes.json()) as {
      roles: Record<
        string,
        { dbRoleModel: { primaryModel: string | null; primaryProvider: string | null } | null }
      >;
    };
    const priorPrimary = before.roles[TEST_ROLE]?.dbRoleModel?.primaryModel ?? null;
    const priorProvider = before.roles[TEST_ROLE]?.dbRoleModel?.primaryProvider ?? null;

    try {
      // Expand the developer role row.
      const roleBtn = page
        .locator('button')
        .filter({ hasText: new RegExp(`^${TEST_ROLE}`) })
        .first();
      await roleBtn.click();

      // Find the primary tier select in the developer row and pick sonnet.
      const primaryTierSelect = page
        .locator('tr')
        .filter({ hasText: TEST_ROLE })
        .locator('select')
        .first();
      await primaryTierSelect.selectOption('sonnet');

      // Find the provider select and pick codex.
      const primaryProviderSelect = page
        .locator('tr')
        .filter({ hasText: TEST_ROLE })
        .locator('select')
        .nth(1);
      await primaryProviderSelect.selectOption('codex');

      // After selection the resolved model subtitle should update to gpt-5-codex.
      await expect(
        page.locator('span.font-mono').filter({ hasText: 'gpt-5-codex' }).first(),
      ).toBeVisible({ timeout: 5_000 });

      // Reload and confirm the setting persisted.
      await page.reload();
      await page.waitForSelector('table', { timeout: 10_000 });

      await expect(
        page.locator('span.font-mono').filter({ hasText: 'gpt-5-codex' }).first(),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      // Restore only the fields this test changed, preserving any other overrides
      // (complexity rules, budget fields, etc.) that may exist on the row.
      await page.request.patch(`/api/projects/${PROJECT_SLUG}/settings/models/${TEST_ROLE}`, {
        data: { primaryModel: priorPrimary, primaryProvider: priorProvider },
        headers: { 'Content-Type': 'application/json' },
      });
    }
  });

  test('per-role max-turns input is visible in expanded row', async ({ page }) => {
    const roleBtn = page
      .locator('button')
      .filter({ hasText: new RegExp(`^${TEST_ROLE}`) })
      .first();
    await roleBtn.click();

    // The budget inputs should appear after expansion.
    const maxTurnsInput = page
      .locator('input[type="number"]')
      .filter({ hasAttribute: 'max' })
      .first();
    await expect(maxTurnsInput).toBeVisible({ timeout: 5_000 });
  });
});
