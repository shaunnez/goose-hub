import { test, expect } from '@playwright/test';

test.describe('Issue #656: Settings Budget Page Defaults', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the settings page
    await page.goto('/settings');
  });

  test('displays default values for global budget fields', async ({ page }) => {
    // Wait for the settings page to load
    await page.waitForSelector('h3:has-text("Global budget caps")');

    // Mock the API response to include specific default values
    await page.route('**/api/projects/*/settings', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          projectId: 'test-project',
          configBudgets: {
            perWorkflowMaxUsd: 5.0,
            perAgentMaxUsd: 2.5,
            perAdvisorMaxUsd: 1.0,
            dailyTokens: 1000000,
            maxParallelAgents: 5,
            maxRetries: 3,
            perBashCommandMaxSeconds: 300,
          },
          dbGlobalOverrides: null,
          dbSkillOverrides: {},
          registeredSkills: ['implement', 'qa'],
          skillDefaults: {
            implement: { maxTurns: 150, maxBudgetUsd: 6.0, timeoutMs: 900000 },
            qa: { maxTurns: 100, maxBudgetUsd: 3.0, timeoutMs: 600000 },
          },
        }),
      });
    });

    // Reload to get the mocked data
    await page.reload();

    // Wait for the Global budget caps section to be visible
    await page.waitForSelector(':text("Global budget caps")');

    // Verify that global budget field labels show default values
    await expect(page.getByText('Per-workflow max USD (default: $5.00)')).toBeVisible();
    await expect(page.getByText('Per-agent max USD (default: $2.50)')).toBeVisible();
    await expect(page.getByText('Per-advisor max USD (default: $1.00)')).toBeVisible();
    await expect(page.getByText('Daily tokens (default: 1,000,000)')).toBeVisible();
    await expect(page.getByText('Max parallel agents (default: 5)')).toBeVisible();
    await expect(page.getByText('Max retries (default: 3)')).toBeVisible();
    await expect(page.getByText(
      'Per-bash-command max seconds (default: 300)'
    )).toBeVisible();

    // Take a screenshot showing the global budget defaults
    await page.screenshot({ path: 'evidence/issue-656/step-1-global-defaults.png' });
  });

  test('displays default values for per-skill budget fields', async ({ page }) => {
    // Wait for the settings page to load
    await page.waitForSelector('h3:has-text("Per-skill budget overrides")');

    // Mock the API response with skill defaults
    await page.route('**/api/projects/*/settings', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          projectId: 'test-project',
          configBudgets: {},
          dbGlobalOverrides: null,
          dbSkillOverrides: {},
          registeredSkills: ['implement', 'qa', 'review'],
          skillDefaults: {
            implement: { maxTurns: 150, maxBudgetUsd: 6.0, timeoutMs: 900000 },
            qa: { maxTurns: 100, maxBudgetUsd: 3.0, timeoutMs: 600000 },
            review: { maxTurns: 25, maxBudgetUsd: 0.5, timeoutMs: 180000 },
          },
        }),
      });
    });

    // Reload to get the mocked data
    await page.reload();

    // Wait for the Per-skill budget overrides section to be visible
    await page.waitForSelector(':text("Per-skill budget overrides")');

    // Verify that skill rows exist and have proper inputs
    await expect(page.getByText('implement')).toBeVisible();
    await expect(page.getByText('qa')).toBeVisible();
    await expect(page.getByText('review')).toBeVisible();

    // Verify that the inputs show default values in their placeholders
    // These are spinbutton (number input) elements
    const inputs = page.locator('input[type="number"]');
    const count = await inputs.count();
    expect(count).toBeGreaterThan(0);

    // Find inputs with the expected placeholder values (skill defaults)
    const implementMaxTurnsInput = page.locator('input[placeholder="150"]');
    const qaMaxBudgetInput = page.locator('input[placeholder="3"]');
    const reviewTimeoutInput = page.locator('input[placeholder="180000"]');

    // Verify at least one of these exists (showing defaults are displayed)
    const hasSomeDefaults =
      (await implementMaxTurnsInput.count()) > 0 ||
      (await qaMaxBudgetInput.count()) > 0 ||
      (await reviewTimeoutInput.count()) > 0;

    expect(hasSomeDefaults).toBe(true);

    // Take a screenshot showing the per-skill budget defaults
    await page.screenshot({ path: 'evidence/issue-656/step-2-skill-defaults.png' });
  });

  test('correctly formats currency and numeric values', async ({ page }) => {
    // Mock the API response with various numeric formats
    await page.route('**/api/projects/*/settings', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          projectId: 'test-project',
          configBudgets: {
            perWorkflowMaxUsd: 123.456,
            perAgentMaxUsd: 0.05,
            perAdvisorMaxUsd: 1.5,
            dailyTokens: 1500000,
            maxParallelAgents: 50,
            maxRetries: 20,
            perBashCommandMaxSeconds: 3600,
          },
          dbGlobalOverrides: null,
          dbSkillOverrides: {},
          registeredSkills: [],
          skillDefaults: {},
        }),
      });
    });

    // Navigate and reload to get the mocked data
    await page.goto('/settings');
    await page.waitForSelector('h3:has-text("Global budget caps")');

    // Verify currency values are formatted with $ and proper decimals
    await expect(page.getByText('Per-workflow max USD (default: $123.46)')).toBeVisible();
    await expect(page.getByText('Per-agent max USD (default: $0.05)')).toBeVisible();
    await expect(page.getByText('Per-advisor max USD (default: $1.50)')).toBeVisible();

    // Verify integer values have thousand separators
    await expect(page.getByText('Daily tokens (default: 1,500,000)')).toBeVisible();
    await expect(page.getByText('Max parallel agents (default: 50)')).toBeVisible();
    await expect(page.getByText('Max retries (default: 20)')).toBeVisible();
    await expect(page.getByText(
      'Per-bash-command max seconds (default: 3,600)'
    )).toBeVisible();

    // Take a screenshot showing proper formatting
    await page.screenshot({ path: 'evidence/issue-656/step-3-formatting.png' });
  });
});
