import { expect, test } from '@playwright/test';

// E2E test for the bootstrap wizard. Lives in the pipeline lane so it runs as
// a required CI check; the server is booted with MOCK_BOOTSTRAP=true (see
// playwright-e2e-pipeline.config.ts) so /api/projects/bootstrap/{preview,run}
// return deterministic fixtures instead of hitting GitHub.

test.describe('bootstrap wizard (MOCK_BOOTSTRAP)', () => {
  test('walks all wizard steps and shows the PR URL on completion', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('settings-page')).toBeVisible();

    // Open the wizard via the "Add Project" button.
    await page.getByTestId('add-project-button').click();
    await expect(page.getByTestId('bootstrap-wizard')).toBeVisible();
    await expect(page.getByTestId('step-repo')).toBeVisible();

    // Step 1 — type a repo ref and advance.
    await page.getByTestId('bootstrap-repo-input').fill('octo/widgets');
    await page.getByTestId('wizard-next').click();

    // Step 2 — stack summary.
    await expect(page.getByTestId('step-stack')).toBeVisible();
    await expect(page.getByTestId('stack-summary')).toContainText('node');
    await page.getByTestId('wizard-next').click();

    // Step 3 — CLAUDE.md preview (textarea, read-only).
    await expect(page.getByTestId('step-claudemd')).toBeVisible();
    await expect(page.getByTestId('claudemd-preview')).toBeVisible();
    await page.getByTestId('wizard-next').click();

    // Step 4 — labels list (canonical Factory labels).
    await expect(page.getByTestId('step-labels')).toBeVisible();
    const labels = page.getByTestId('labels-list-item');
    await expect(labels.first()).toBeVisible();
    expect(await labels.count()).toBeGreaterThan(0);
    await page.getByTestId('wizard-next').click();

    // Step 5 — webhook setup with payload URL.
    await expect(page.getByTestId('step-webhook')).toBeVisible();
    await expect(page.getByTestId('webhook-payload-url')).toContainText('webhooks/github');
    await page.getByTestId('wizard-next').click();

    // Final step — Open PR button + result.
    await expect(page.getByTestId('step-submit')).toBeVisible();
    await page.getByTestId('bootstrap-submit').click();
    await expect(page.getByTestId('bootstrap-result')).toBeVisible();

    const link = page.getByTestId('bootstrap-pr-link');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /github\.com\/.+\/pull\//);
  });
});
