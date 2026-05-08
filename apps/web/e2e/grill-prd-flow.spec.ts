import { type Route, expect, test } from '@playwright/test';

/**
 * M13.07 + M13.08 — PRD tab and Grill chat tab flows.
 *
 * All API requests are intercepted; no real backend call. The two
 * scenarios use different issue states so we can assert state-gated UI
 * behaviour: PRD-review for the approve flow, Grilling for the reply
 * flow.
 */

const slug = 'goose-hub-self';
const repo = 'owner/repo';

const PRD_FIXTURE = {
  title: 'Inline validation in onboarding',
  problem: 'Users drop off at the profile step.',
  proposedSolution: 'Add field-level validation on blur.',
  outOfScope: ['Refactor wizard nav'],
  successCriteria: ['Drop-off decreases ≥ 20%'],
  acceptanceCriteria: [{ id: 'AC-1', statement: 'Each field validates on blur', journeyId: 'J-1' }],
  journeys: [
    {
      id: 'J-1',
      persona: 'New user',
      trigger: 'Reaches profile',
      steps: [
        {
          userAction: 'Tabs out of email',
          systemResponse: 'Renders inline error',
          dataShown: 'Error',
          stateChange: 'invalid',
        },
      ],
      successState: 'All fields valid',
      errorStates: [],
      edgeCases: [],
    },
  ],
  functionalSpec: {
    behaviors: [
      {
        when: 'Field loses focus with invalid value',
        given: 'User typed at least one char',
        // biome-ignore lint/suspicious/noThenProperty: PRD FunctionalSpec.behaviors[*].then is the BDD "Then" clause, not Promise#then.
        then: 'Inline error rendered',
      },
    ],
  },
  verticalSlices: [
    {
      title: 'Slice 1: inline validation',
      goal: 'Add validation',
      estimatedSize: 'M',
      journeyRefs: ['J-1'],
    },
  ],
  estimatedComplexity: 'medium',
  implementationDecisions: [
    {
      decision: 'Validate on blur using existing form utilities',
      rationale: 'Follows CONTEXT.md pattern',
      moduleRef: 'apps/web/src/components/forms/',
    },
  ],
  testingDecisions: {
    approach: 'Verify inline error renders on blur with invalid value',
    modulesToTest: ['slices/grill-prd-ui/slice.test.ts'],
    priorArt: 'apps/web/e2e/grill-prd-flow.spec.ts',
  },
};

function prdCommentBody(): string {
  return `<!-- factory:prd -->\n# PRD\n\n\`\`\`json\n${JSON.stringify(PRD_FIXTURE, null, 2)}\n\`\`\``;
}

function buildIssue(state: string, externalId: string) {
  return {
    id: `github:${repo}#${externalId}`,
    externalId,
    repoRef: repo,
    title: 'Improve onboarding',
    body: 'body',
    type: 'feature',
    priority: 'medium',
    mode: 'supervised',
    state,
    authorIsOwner: true,
    schedule: 'current',
    exec: 'serial',
    dependsOn: [],
    blocks: [],
    createdAt: new Date().toISOString(),
  };
}

async function stubBaseEndpoints(
  page: import('@playwright/test').Page,
  externalId: string,
  state: string,
  comments: Array<{ id: number; body: string; authorLogin: string; createdAt: string }>,
) {
  await page.route('**/api/projects', (route: Route) =>
    route.fulfill({ json: { projects: [{ slug, name: 'Goose Hub (self)' }] } }),
  );
  await page.route('**/api/projects/goose-hub-self/active-milestone', (route: Route) =>
    route.fulfill({ json: { milestoneNumber: null, source: 'github-default' } }),
  );
  await page.route(`**/api/projects/${slug}/issues`, (route: Route) =>
    route.fulfill({ json: { items: [buildIssue(state, externalId)] } }),
  );
  await page.route(`**/api/projects/${slug}/issues/${externalId}`, (route: Route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { item: buildIssue(state, externalId) } });
    }
    return route.continue();
  });
  await page.route(`**/api/projects/${slug}/issues/${externalId}/comments`, (route: Route) =>
    route.fulfill({ json: { comments } }),
  );
  await page.route(`**/api/projects/${slug}/issues/${externalId}/events`, (route: Route) =>
    route.fulfill({ json: { events: [] } }),
  );
  await page.route(`**/api/projects/${slug}/issues/${externalId}/triage`, (route: Route) =>
    route.fulfill({ json: { triage: null } }),
  );
  await page.route(`**/api/projects/${slug}/issues/${externalId}/diff`, (route: Route) =>
    route.fulfill({ json: { diff: null, runId: null, reason: 'no in-flight run' } }),
  );
}

test.describe('M13 grill + prd UI', () => {
  test('PRD tab: renders parsed PRD, new sections, and Approve calls /approve-prd', async ({
    page,
  }) => {
    const externalId = '7321';
    await stubBaseEndpoints(page, externalId, 'factory:prd-review', [
      {
        id: 1,
        body: prdCommentBody(),
        authorLogin: 'factory-bot',
        createdAt: '2026-05-07T10:00:00Z',
      },
    ]);

    let approveCalls = 0;
    await page.route(`**/api/projects/${slug}/issues/${externalId}/approve-prd`, (route: Route) => {
      approveCalls += 1;
      return route.fulfill({ json: { ok: true } });
    });

    await page.goto(`/projects/${slug}/items/${externalId}/prd`);

    const section = page.getByTestId('prd-section');
    await expect(section).toBeVisible();
    await expect(page.getByTestId('prd-title')).toHaveText('Inline validation in onboarding');
    await expect(page.getByTestId('prd-problem')).toContainText('Users drop off');
    const slices = page.getByTestId('prd-slice');
    await expect(slices).toHaveCount(1);

    // Implementation decisions section
    const implDecisions = page.getByTestId('prd-implementation-decisions');
    await expect(implDecisions).toBeVisible();
    await expect(implDecisions).toContainText('Validate on blur using existing form utilities');

    // Testing approach section
    const testingDecisions = page.getByTestId('prd-testing-decisions');
    await expect(testingDecisions).toBeVisible();
    await expect(testingDecisions).toContainText('Verify inline error renders on blur');

    const approveBtn = page.getByTestId('prd-approve-btn');
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();
    await expect.poll(() => approveCalls).toBeGreaterThanOrEqual(1);
  });

  test('PRD tab: Request Changes sends concerns to /revise-prd', async ({ page }) => {
    const externalId = '7323';
    await stubBaseEndpoints(page, externalId, 'factory:prd-review', [
      {
        id: 1,
        body: prdCommentBody(),
        authorLogin: 'factory-bot',
        createdAt: '2026-05-07T10:00:00Z',
      },
    ]);

    let reviseCalls = 0;
    let sentConcerns: string[] = [];
    await page.route(`**/api/projects/${slug}/issues/${externalId}/revise-prd`, (route: Route) => {
      reviseCalls += 1;
      const body = route.request().postDataJSON() as { concerns?: string[] };
      sentConcerns = body.concerns ?? [];
      return route.fulfill({ json: { ok: true } });
    });

    await page.goto(`/projects/${slug}/items/${externalId}/prd`);
    await expect(page.getByTestId('prd-section')).toBeVisible();

    const requestChangesBtn = page.getByTestId('prd-request-changes-btn');
    await expect(requestChangesBtn).toBeVisible();
    await requestChangesBtn.click();

    const form = page.getByTestId('prd-request-changes-form');
    await expect(form).toBeVisible();

    await page.getByTestId('prd-concerns-input').fill('Journey J-1 step 2 is unclear');
    await page.getByTestId('prd-submit-changes-btn').click();

    await expect.poll(() => reviseCalls).toBeGreaterThanOrEqual(1);
    expect(sentConcerns).toContain('Journey J-1 step 2 is unclear');

    // Form should close after success
    await expect(form).not.toBeVisible();
  });

  test('Grill tab: recommended answer pill fills textarea on click', async ({ page }) => {
    const externalId = '7324';
    await stubBaseEndpoints(page, externalId, 'factory:gate-pending', [
      {
        id: 1,
        body: '<!-- factory:grill-question -->\nWhat does "better search" mean?\n<!-- factory:recommended-answer -->\nFewer misses on obvious keyword queries.',
        authorLogin: 'factory-bot',
        createdAt: '2026-05-07T09:00:00Z',
      },
    ]);

    await page.goto(`/projects/${slug}/items/${externalId}/grill`);

    const pill = page.getByTestId('grill-recommended-answer');
    await expect(pill).toBeVisible();
    await expect(pill).toContainText('Fewer misses');

    await page.getByTestId('grill-use-answer-btn').click();
    const textarea = page.getByTestId('grill-reply-input');
    await expect(textarea).toHaveValue('Fewer misses on obvious keyword queries.');
  });

  test('Grill tab: Proceed to PRD calls /proceed-to-prd', async ({ page }) => {
    const externalId = '7325';
    await stubBaseEndpoints(page, externalId, 'factory:gate-pending', [
      {
        id: 1,
        body: '<!-- factory:grill-question -->\nQ?',
        authorLogin: 'factory-bot',
        createdAt: '2026-05-07T09:00:00Z',
      },
    ]);

    let proceedCalls = 0;
    await page.route(
      `**/api/projects/${slug}/issues/${externalId}/proceed-to-prd`,
      (route: Route) => {
        proceedCalls += 1;
        return route.fulfill({ json: { ok: true } });
      },
    );

    await page.goto(`/projects/${slug}/items/${externalId}/grill`);

    const proceedBtn = page.getByTestId('grill-proceed-btn');
    await expect(proceedBtn).toBeVisible();
    await proceedBtn.click();

    await expect.poll(() => proceedCalls).toBeGreaterThanOrEqual(1);
  });

  test('Grill tab: posts a reply via /comment and transitions back to grilling', async ({
    page,
  }) => {
    const externalId = '7322';
    await stubBaseEndpoints(page, externalId, 'factory:gate-pending', [
      {
        id: 1,
        body: '<!-- factory:grill-question -->\n**Round 1** — What does "better" mean?',
        authorLogin: 'factory-bot',
        createdAt: '2026-05-07T09:00:00Z',
      },
    ]);

    let commentCalls = 0;
    let transitionCalls = 0;
    await page.route(`**/api/projects/${slug}/issues/${externalId}/comment`, (route: Route) => {
      commentCalls += 1;
      return route.fulfill({ json: { ok: true } });
    });
    await page.route(`**/api/projects/${slug}/issues/${externalId}/transition`, (route: Route) => {
      transitionCalls += 1;
      return route.fulfill({ json: { ok: true } });
    });

    await page.goto(`/projects/${slug}/items/${externalId}/grill`);

    const grillSection = page.getByTestId('grill-section');
    await expect(grillSection).toBeVisible();

    // The agent question should be visible.
    const agentMsg = page.getByTestId('grill-msg-agent');
    await expect(agentMsg).toBeVisible();
    await expect(agentMsg).toContainText('better');

    const textarea = page.getByTestId('grill-reply-input');
    await textarea.fill('Better means fewer drop-offs.');

    await page.getByTestId('grill-send-btn').click();

    await expect.poll(() => commentCalls).toBeGreaterThanOrEqual(1);
    await expect.poll(() => transitionCalls).toBeGreaterThanOrEqual(1);
  });
});
