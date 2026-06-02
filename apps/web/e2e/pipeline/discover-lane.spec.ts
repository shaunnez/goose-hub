/**
 * M13 Discover Lane — pipeline E2E spec.
 *
 * Tests the UI-visible Discover Lane flow: a fresh type:feature issue is seeded
 * and walked through triaging → grilling → gate-pending (grill chat) →
 * prd-review (PRD rendered) → delivery using the
 * MOCK_AGENTS + MOCK_SOURCE harness.
 *
 * What this covers vs. the unit-level grill-prd-flow.spec.ts:
 *   - Full server round-trip: seed-issue → tick (triage) → dispatch (grill)
 *   - State-gated UI: Grill tab present in grilling state
 *   - Grill chat: agent question renders, user reply posts + transitions state
 *   - PRD tab appears once state is factory:prd-review
 *   - PRD content (title, problem, slices) renders from the mock prd.drafted event
 *   - Approve PRD: POSTs /approve-prd and advances to factory:dev-ready
 *
 * What is intentionally deferred (see TODO comments below):
 *   - Optional WP projection issue cards with factory:from-prd label after
 *     delivery.
 *   - Sprint-review issue filing (covered by slices/discover-lane-e2e/slice.test.ts).
 *
 * NOTE on triage→grilling routing (#592): the routing from factory:triaging to
 * factory:grilling for type:feature issues IS wired in triage-batch.ts as of
 * the M13 milestone. If a future refactor breaks it the test steps that call
 * /tick will time-out on the grilling state assertion; that is intentional —
 * the failure surfaces the regression.
 */

import { type Locator, expect, test } from '@playwright/test';

const SLUG = process.env.PROJECT_SLUG ?? 'goose-hub-self';
const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3001';
const CLEAN_FEATURE_BODY = [
  'Surface: apps/web/src/components/search',
  'Acceptance criteria:',
  '- Search should return keyword matches for factory rules queries.',
  '- Results should preserve current filtering behavior.',
  '- Verify with a focused pipeline regression test.',
].join('\n');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function postServer(path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res;
}

async function seedIssue(opts: {
  title: string;
  body?: string;
  type?: string;
  state?: string;
}): Promise<{ issueNumber: number; workItemId: string }> {
  const res = await postServer(`/projects/test/${SLUG}/seed-issue`, {
    ...opts,
    body:
      opts.body ?? (opts.type === 'feature' && opts.state == null ? CLEAN_FEATURE_BODY : undefined),
  });
  return res.json() as Promise<{ issueNumber: number; workItemId: string }>;
}

async function driveFeatureToGrilling(statePill: Locator): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const currentState = ((await statePill.textContent()) ?? '').trim();
    if (currentState === 'grilling') return;

    await postServer(`/projects/${SLUG}/tick`);

    if (currentState === 'triaging' || currentState === 'accepted') {
      await expect
        .poll(async () => ((await statePill.textContent()) ?? '').trim(), { timeout: 60_000 })
        .toMatch(/^(grounding|grilling)$/);
      continue;
    }

    if (currentState === 'grounding') {
      await expect
        .poll(async () => ((await statePill.textContent()) ?? '').trim(), { timeout: 60_000 })
        .toBe('grilling');
      continue;
    }

    await expect
      .poll(async () => ((await statePill.textContent()) ?? '').trim(), { timeout: 60_000 })
      .not.toBe(currentState);
  }

  await expect(statePill).toHaveText('grilling', { timeout: 60_000 });
}

async function seedPrd(issueNumber: number, prd = buildMockPrd()): Promise<void> {
  await postServer(`/projects/test/${SLUG}/issues/${issueNumber}/seed-prd`, { prd });
}

/**
 * Minimal PRD payload for the /prd read model. The JSON blob is intentionally
 * compact — just enough fields to render title, problem, and one vertical slice.
 */
function buildMockPrd() {
  const prd = {
    title: 'Better Search',
    problem: 'Current search misses obvious keyword matches.',
    proposedSolution: 'Rebuild the query pipeline.',
    outOfScope: ['Semantic vector search'],
    successCriteria: ['Top-5 recall improves from 40% to 80%'],
    acceptanceCriteria: [
      { id: 'AC-1', statement: 'Search returns relevant results.', journeyId: 'J-1' },
    ],
    journeys: [
      {
        id: 'J-1',
        persona: 'Power user',
        trigger: 'Types a keyword',
        steps: [
          {
            userAction: 'Types "factory rules"',
            systemResponse: 'Returns top-10 results',
            dataShown: 'Result list',
            stateChange: 'Results shown',
          },
        ],
        successState: 'Relevant results shown',
        errorStates: [],
        edgeCases: [],
      },
    ],
    functionalSpec: {
      behaviors: [
        {
          when: 'A user submits a search query',
          given: 'The search index is available',
          // biome-ignore lint/suspicious/noThenProperty: BDD "then" clause in FunctionalSpec.behaviors, not Promise#then
          then: 'The system returns ranked results',
        },
      ],
    },
    verticalSlices: [
      {
        title: 'Slice 1: keyword tokenisation',
        goal: 'Rebuild query tokeniser',
        estimatedSize: 'M',
        journeyRefs: ['J-1'],
      },
    ],
    estimatedComplexity: 'medium',
    implementationDecisions: [{ decision: 'Use Drizzle for new query table' }],
    testingDecisions: {
      approach: 'Verify search returns ranked results for keyword queries',
      modulesToTest: ['slices/search/slice.test.ts'],
    },
    decisionSummaries: [{ kind: 'PLAN', summary: 'Mock PRD for E2E.' }],
  };
  return prd;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('Discover Lane (MOCK_AGENTS + MOCK_SOURCE)', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // Step 1-2: Seed a type:feature issue and confirm triage routes it to
  // factory:grilling. The routing lives in triage-batch.ts (M13); if it
  // regresses the statePill assertion below will time-out with a clear
  // indication that the routing is broken.
  // ─────────────────────────────────────────────────────────────────────────
  test('clean feature triages to grilling and shows the grill tab', async ({ page }) => {
    test.setTimeout(120_000);

    const { issueNumber } = await seedIssue({
      title: `[E2E] Discover Lane ${Date.now()}`,
      type: 'feature',
    });

    await page.goto(`/projects/${SLUG}/items/${issueNumber}`);
    const statePill = page.getByTestId('state-pill');
    await expect(statePill).toHaveText('triaging', { timeout: 15_000 });

    // Drive one local tick boundary at a time: triaging → grounding → grilling.
    await driveFeatureToGrilling(statePill);

    // Grill tab must be present in the left rail
    const grillLink = page.locator('[data-section-key="grill"]');
    await expect(grillLink).toBeVisible({ timeout: 10_000 });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Step 3-5: Grill workflow posts a question (gate-pending), user replies,
  // state returns to grilling. The /dispatch endpoint triggers the mock
  // grill-and-prd workflow which posts a question comment and transitions to
  // factory:gate-pending. The grill chat thread then becomes interactive.
  // ─────────────────────────────────────────────────────────────────────────
  test('grill chat: agent question renders, user reply posts and re-transitions to grilling', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const { issueNumber } = await seedIssue({
      title: `[E2E] Discover Grill Chat ${Date.now()}`,
      type: 'feature',
    });

    // Navigate to grill tab directly
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/grill`);
    const statePill = page.getByTestId('state-pill');

    // Drive triage → grounding → grilling first.
    await driveFeatureToGrilling(statePill);

    // Dispatch the grill-and-prd workflow: grilling → gate-pending (question posted)
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('gate-pending', { timeout: 60_000 });

    // The grill section must be visible
    const grillSection = page.getByTestId('grill-section');
    await expect(grillSection).toBeVisible({ timeout: 10_000 });

    // An agent question comment should appear in the thread
    const agentMsg = page.getByTestId('grill-msg-agent').first();
    await expect(agentMsg).toBeVisible({ timeout: 15_000 });

    // Reply textarea and send button must be present (gate-pending = awaiting user)
    const textarea = page.getByTestId('grill-reply-input');
    await expect(textarea).toBeVisible();
    await textarea.fill('I mean relevance — current search misses obvious keyword matches.');

    await page.getByTestId('grill-send-btn').click();

    // After send: the comment is posted and the issue is transitioned back to
    // factory:grilling (GrillSection.tsx calls transitionState when gate-pending).
    await expect(statePill).toHaveText('grilling', { timeout: 30_000 });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Steps 6-7: PRD tab appears and renders content once state is
  // factory:prd-review. The mock here seeds the issue directly at prd-review
  // and seeds a local prd.drafted event, then verifies
  // the PRD section renders and the Approve button works.
  //
  // This avoids a multi-round grill sequence (already covered by
  // slice.test.ts) while still exercising the UI surfaces the spec requires.
  // ─────────────────────────────────────────────────────────────────────────
  test('prd-review: Decline Feature transitions to done', async ({ page }) => {
    test.setTimeout(60_000);

    const { issueNumber } = await seedIssue({
      title: `[E2E] Discover Decline ${Date.now()}`,
      type: 'feature',
      state: 'factory:prd-review',
    });

    await seedPrd(issueNumber);

    await page.goto(`/projects/${SLUG}/items/${issueNumber}/prd`);
    const statePill = page.getByTestId('state-pill');
    await expect(statePill).toHaveText('prd-review', { timeout: 15_000 });

    // PRD section must load and show the decline button
    await expect(page.getByTestId('prd-section')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('prd-decline-btn').click();

    // Confirmation dialog appears
    await expect(page.getByTestId('prd-decline-confirm')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('prd-confirm-decline-btn').click();

    // State transitions to done
    await expect(statePill).toHaveText('done', { timeout: 15_000 });
  });

  test('prd-review: Request Changes submits concerns and v2 PRD renders', async ({ page }) => {
    test.setTimeout(60_000);

    const { issueNumber } = await seedIssue({
      title: `[E2E] Discover Revise ${Date.now()}`,
      type: 'feature',
      state: 'factory:prd-review',
    });

    await seedPrd(issueNumber);

    await page.goto(`/projects/${SLUG}/items/${issueNumber}/prd`);
    const statePill = page.getByTestId('state-pill');
    await expect(statePill).toHaveText('prd-review', { timeout: 15_000 });

    await expect(page.getByTestId('prd-section')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('prd-request-changes-btn').click();

    const form = page.getByTestId('prd-request-changes-form');
    await expect(form).toBeVisible({ timeout: 5_000 });

    await page.getByTestId('prd-concerns-input').fill('Journey J-1 step 2 needs more detail');
    await page.getByTestId('prd-submit-changes-btn').click();

    // Form closes after successful submission
    await expect(form).not.toBeVisible({ timeout: 10_000 });

    // Seed a v2 PRD event to simulate the background workflow completing.
    await seedPrd(issueNumber, { ...buildMockPrd(), title: 'Better Search v2' });

    // The PRD section should update to show v2 content once the PRD read model refreshes.
    // Reload to trigger a fresh fetch (React Query cache would need a poll cycle otherwise).
    await page.reload();
    await expect(page.getByTestId('prd-title')).toHaveText('Better Search v2', {
      timeout: 10_000,
    });
  });

  test('prd-review: PRD tab visible, PRD content renders, Approve calls /approve-prd', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Seed directly at factory:prd-review to skip the multi-round grill loop.
    const { issueNumber } = await seedIssue({
      title: `[E2E] Discover PRD Review ${Date.now()}`,
      type: 'feature',
      state: 'factory:prd-review',
    });

    // Seed a PRD event so PRDSection has content to render.
    await seedPrd(issueNumber);

    await page.goto(`/projects/${SLUG}/items/${issueNumber}/prd`);
    const statePill = page.getByTestId('state-pill');
    await expect(statePill).toHaveText('prd-review', { timeout: 15_000 });

    // Both Grill and PRD tabs must be present (state is prd-review which is in
    // both GRILL_ACTIVE_STATES and PRD_ACTIVE_STATES).
    await expect(page.locator('[data-section-key="grill"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-section-key="prd"]')).toBeVisible({ timeout: 10_000 });

    // PRD content must render
    const prdSection = page.getByTestId('prd-section');
    await expect(prdSection).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('prd-title')).toHaveText('Better Search');
    await expect(page.getByTestId('prd-problem')).toContainText(
      'Current search misses obvious keyword matches',
    );
    const slices = page.getByTestId('prd-slice');
    await expect(slices).toHaveCount(1);

    // Approve PRD → dev-ready, then the mock delivery workflow advances to needs-qa.
    const approveBtn = page.getByTestId('prd-approve-btn');
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();
    await expect(statePill).toHaveText('needs-qa', { timeout: 30_000 });
  });
});
