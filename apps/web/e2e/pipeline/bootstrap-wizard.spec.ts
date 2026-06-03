import { expect, test } from '@playwright/test';

// E2E test for the local project creation wizard. Lives in the pipeline lane so
// it runs as a required CI check; the server is booted with MOCK_BOOTSTRAP=true
// so create returns deterministic data without writing target-project configs.

test.describe('bootstrap wizard (MOCK_BOOTSTRAP)', () => {
  test('walks all wizard steps and shows the config path on completion', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('settings-page')).toBeVisible();

    // Open the wizard via the "Add Project" button.
    await page.getByTestId('add-project-button').click();
    await expect(page.getByTestId('bootstrap-wizard')).toBeVisible();
    await expect(page.getByTestId('step-source')).toBeVisible();

    // Step 1 — choose a local-db project backed by a GitHub code repo.
    await page.getByTestId('bootstrap-mode-github-code').check();
    await page.getByTestId('bootstrap-slug-input').fill('e2e-widgets');
    await page.getByTestId('bootstrap-github-repos-input').fill('octo/widgets');
    await page.getByTestId('wizard-next').click();

    // Step 2 — generated local-db config preview.
    await expect(page.getByTestId('step-preview')).toBeVisible();
    await expect(page.getByTestId('project-config-preview')).toHaveValue(/kind: 'local-db'/);
    await expect(page.getByTestId('project-config-preview')).toHaveValue(/octo\/widgets/);
    await page.getByTestId('wizard-next').click();

    // Final step — create config and show the deterministic mock path.
    await expect(page.getByTestId('step-submit')).toBeVisible();
    await page.getByTestId('bootstrap-submit').click();
    await expect(page.getByTestId('bootstrap-result')).toBeVisible();
    await expect(page.getByTestId('bootstrap-result')).toContainText(
      'target-projects/e2e-widgets/project.config.ts',
    );
  });
});
