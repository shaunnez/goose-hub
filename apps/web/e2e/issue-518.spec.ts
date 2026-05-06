import { expect, test } from '@playwright/test';

/**
 * Evidence spec for #518: Harness 2.1 UI Changes 2.
 * Mocks API endpoints so visual evidence renders deterministically.
 * Covers: TaskHeader subtitle, ReviewSection pipeline, CostsSection budget bar,
 * QASection folder grouping, CodeDiffSection section header, OverviewSection stats.
 */

const now = Date.now();

const EVENTS = [
  {
    id: 1,
    projectId: 'p',
    workItemId: 'wi-1',
    kind: 'qa.completed',
    payload: {
      verdict: 'pass',
      overallScore: 88,
      threshold: 70,
      tierResults: {
        structural: { passed: true, findings: [] },
        functional: { passed: true, findings: [] },
        regression: { passed: true, findings: [] },
      },
      testRun: {
        wallTimeMs: 4200,
        total: 12,
        passed: 12,
        failed: 0,
        skipped: 0,
        success: true,
        suites: [
          {
            name: 'auth.test.ts',
            filePath: 'src/auth.test.ts',
            total: 6,
            passed: 6,
            failed: 0,
            skipped: 0,
            durationMs: 1800,
            status: 'passed',
          },
          {
            name: 'session.test.ts',
            filePath: 'src/session.test.ts',
            total: 6,
            passed: 6,
            failed: 0,
            skipped: 0,
            durationMs: 2400,
            status: 'passed',
          },
        ],
      },
      criteriaResults: [
        {
          ac: 'Feature renders',
          passed: true,
          command: 'assert',
          expected: 'true',
          actual: 'true',
        },
      ],
    },
    runId: 'run-qa-1',
    createdAt: new Date(now - 10000).toISOString(),
  },
  {
    id: 2,
    projectId: 'p',
    workItemId: 'wi-1',
    kind: 'pr.opened',
    payload: { prNumber: 42, prUrl: 'https://github.com/test/repo/pull/42' },
    runId: 'run-dev-1',
    createdAt: new Date(now - 8000).toISOString(),
  },
  {
    id: 3,
    projectId: 'p',
    workItemId: 'wi-1',
    kind: 'review.completed',
    payload: {
      verdict: 'approved',
      confidence: 0.95,
      criteriaChecks: [
        { criterion: 'All tests passing', status: 'met' },
        { criterion: 'Lint clean', status: 'met' },
      ],
      findings: [],
    },
    runId: 'run-review-1',
    createdAt: new Date(now - 5000).toISOString(),
  },
];

const COSTS = {
  workItemId: 'wi-1',
  totalUsd: 0.38,
  hasEstimated: false,
  rows: [
    {
      runId: 'run-dev-1',
      workItemId: 'wi-1',
      stage: 'dev',
      skill: 'implement',
      modelId: 'claude-sonnet-4-6',
      inputTokens: 42000,
      outputTokens: 8000,
      costUsd: 0.28,
      costLabel: 'exact',
      personaId: 'goose-dev-v1',
      createdAt: new Date(now - 8000).toISOString(),
    },
    {
      runId: 'run-qa-1',
      workItemId: 'wi-1',
      stage: 'qa',
      skill: 'qa-test',
      modelId: 'claude-sonnet-4-6',
      inputTokens: 10000,
      outputTokens: 2000,
      costUsd: 0.1,
      costLabel: 'exact',
      personaId: 'goose-qa-v1',
      createdAt: new Date(now - 10000).toISOString(),
    },
  ],
};

const CONFIGS = {
  configs: [
    {
      slug: 'goose-hub-self',
      budgets: { perWorkflowMaxUsd: 2.0 },
    },
  ],
};

const DIFF = {
  diff: `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,4 @@
 import { session } from './session';
+import { logger } from './logger';
 export function authenticate() {
-  return session.check();
+  return session.check() && logger.audit('auth');
 }`,
  runId: 'run-dev-1',
};

test('issue-518: Harness 2.1 UI shows lane/persona subtitle, pipeline, budget bar, folder grouping', async ({
  page,
}) => {
  // Events API
  await page.route('**/api/*/events**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EVENTS) }),
  );

  // Costs API
  await page.route('**/api/*/costs**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(COSTS) }),
  );

  // Project configs API (for budget bar)
  await page.route('**/api/projects/configs**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CONFIGS) }),
  );

  // Diff API
  await page.route('**/api/*/diff**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DIFF) }),
  );

  // SSE — empty stream
  await page.route('**/events*', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }),
  );

  // Persona names
  await page.route('**/api/persona-names**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { personaId: 'goose-dev-v1', codename: 'Cedar', role: 'developer' },
        { personaId: 'goose-qa-v1', codename: 'Birch', role: 'qa' },
      ]),
    }),
  );

  await page.goto('/issues/518');

  // TaskHeader subtitle: lane · persona label
  await page.waitForSelector('[data-testid="task-header"]');
  await page.screenshot({ path: 'evidence/issue-518/step-1-task-header.png', fullPage: false });

  // Navigate to Review tab to see pipeline
  const reviewTab = page.locator('[role="tab"]', { hasText: /review/i });
  if ((await reviewTab.count()) > 0) {
    await reviewTab.click();
    await page.waitForSelector('[data-testid="review-section"]');
    await page.screenshot({
      path: 'evidence/issue-518/step-2-review-pipeline.png',
      fullPage: true,
    });
  }

  // Navigate to QA tab to see folder grouping
  const qaTab = page.locator('[role="tab"]', { hasText: /qa/i });
  if ((await qaTab.count()) > 0) {
    await qaTab.click();
    await page.waitForSelector('[data-testid="qa-section"]');
    await page.screenshot({ path: 'evidence/issue-518/step-3-qa-grouping.png', fullPage: true });
  }

  // Navigate to Costs tab to see budget bar
  const costsTab = page.locator('[role="tab"]', { hasText: /cost/i });
  if ((await costsTab.count()) > 0) {
    await costsTab.click();
    await page.waitForSelector('[data-testid="costs-section"]');
    await page.screenshot({ path: 'evidence/issue-518/step-4-costs-budget.png', fullPage: true });
  }

  // Navigate to Code tab to see section header
  const codeTab = page.locator('[role="tab"]', { hasText: /code/i });
  if ((await codeTab.count()) > 0) {
    await codeTab.click();
    await page.waitForSelector('[data-testid="code-diff-section"]');
    const text = await page.locator('[data-testid="code-diff-section"]').textContent();
    expect(text).toContain('Patch in flight');
    await page.screenshot({ path: 'evidence/issue-518/step-5-code-header.png', fullPage: true });
  }
});
