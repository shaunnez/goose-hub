import { expect, test } from '@playwright/test';

test('investigation page keeps accordion states consistent', async ({ page }) => {
  await page.route('**/api/projects', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        projects: [
          {
            id: 'goose-hub-self',
            name: 'Goose Hub',
            slug: 'goose-hub-self',
            color: '#888888',
            source: { kind: 'github', repo: 'shaunnez/goose-hub' },
            defaultBranch: 'main',
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/goose-hub-self/issues', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            id: '42',
            externalId: '42',
            repoRef: 'shaunnez/goose-hub',
            title: 'Investigation bug ui 7',
            body: 'Issue body',
            type: 'bug',
            priority: 'medium',
            mode: 'supervised',
            state: 'factory:investigation-complete',
            authorIsOwner: true,
            schedule: 'current',
            exec: 'autonomous',
            dependsOn: [],
            blocks: [],
            createdAt: '2026-05-22T00:00:00Z',
          },
        ],
      }),
    });
  });

  await page.route('**/api/projects/goose-hub-self/issues/42', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        item: {
          id: '42',
          externalId: '42',
          repoRef: 'shaunnez/goose-hub',
          title: 'Investigation bug ui 7',
          body: 'Issue body',
          type: 'bug',
          priority: 'medium',
          mode: 'supervised',
          state: 'factory:investigation-complete',
          authorIsOwner: true,
          schedule: 'current',
          exec: 'autonomous',
          dependsOn: [],
          blocks: [],
          createdAt: '2026-05-22T00:00:00Z',
        },
      }),
    });
  });

  await page.route('**/api/projects/goose-hub-self/issues/42/events**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        events: [
          {
            id: 1,
            projectId: 'goose-hub-self',
            workItemId: 'github:shaunnez/goose-hub#42',
            kind: 'agent.investigation-complete',
            runId: 'run-1',
            personaId: 'persona-1',
            createdAt: '2026-05-22T10:00:00Z',
            payload: {
              investigate: {
                findings: 'Root cause found in auth module.',
                keyFiles: [
                  { path: 'src/auth/login.ts', reason: 'Entry point for authentication flow' },
                  { path: 'src/auth/session.ts', reason: 'Session management' },
                ],
                confidence: 'high',
                openQuestions: ['Does this affect the mobile app?'],
                decisionSummaries: [{ kind: 'READ', summary: 'Reviewed auth logs' }],
              },
            },
          },
        ],
        hasMore: false,
      }),
    });
  });

  await page.route('**/api/projects/goose-hub-self/issues/42/comments', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ comments: [] }),
    });
  });

  await page.route('**/api/projects/goose-hub-self/issues/42/spec', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        spec: {
          pipelineRunId: 'pipe-test-123',
          updatedAt: '2026-05-22T10:00:00Z',
          objective: 'Build the authentication flow with token refresh.',
          workPackages: [
            {
              id: 'WP1',
              filesOwned: ['src/auth/login.ts'],
              changes: 'Update login refresh flow.',
              dependsOn: [],
              builderTier: 'sonnet',
            },
          ],
          executionOrder: [{ batch: 0, wpIds: ['WP1'] }],
          verificationTooling: [],
          acceptanceCriteria: [{ id: 'AC-1', statement: 'Users can log in.' }],
          acceptanceCriteriaCount: 1,
          interfaceContracts: [],
          constraints: [],
          riskRegister: [],
        },
      }),
    });
  });

  await page.route(
    '**/api/projects/goose-hub-self/issues/42/acceptance-contract',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          acceptanceContract: {
            source: 'engineering-spec',
            runId: 'run-1',
            criteria: [
              {
                id: 'AC1',
                statement: 'Users can log in.',
                executableChecks: [
                  {
                    id: 'check-1',
                    command:
                      'pnpm vitest run apps/web/src/components/detail/components/InvestigationSection.test.tsx',
                    expectedExitCodes: [0],
                    kind: 'unit',
                  },
                ],
              },
            ],
          },
        }),
      });
    },
  );

  await page.route('**/api/projects/goose-hub-self/issues/42/costs', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        workItemId: '42',
        totalUsd: 0,
        hasEstimated: false,
        rows: [],
      }),
    });
  });

  await page.route('**/events?*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: '',
    });
  });

  await page.goto('/projects/goose-hub-self/items/42/investigation');

  const findings = page.getByRole('button', { name: /findings/i });
  await expect(findings).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('findings-content')).toContainText(
    'Root cause found in auth module.',
  );

  const acceptance = page.getByRole('button', { name: /acceptance criteria/i });
  const spec = page.getByRole('button', { name: /engineering spec/i });
  await expect(acceptance).toHaveAttribute('aria-expanded', 'false');
  await expect(spec).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('investigation-accordion-acceptance-criteria-content')).toHaveCount(
    0,
  );
  await expect(page.getByTestId('investigation-accordion-engineering-spec-content')).toHaveCount(0);

  await acceptance.click();
  await spec.click();

  await expect(
    page.getByTestId('investigation-accordion-acceptance-criteria-content'),
  ).toContainText('Users can log in.');
  await expect(page.getByTestId('investigation-accordion-engineering-spec-content')).toContainText(
    'Build the authentication flow with token refresh.',
  );
});
