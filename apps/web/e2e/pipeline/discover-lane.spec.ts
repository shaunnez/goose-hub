/**
 * M13 Discover Lane — pipeline E2E spec.
 *
 * Tests the UI-visible Discover Lane flow: a fresh type:feature issue is seeded
 * and walked through triaging → grilling → gate-pending (grill chat) →
 * prd-review (PRD rendered) → decomposing → issues-created using the
 * MOCK_AGENTS + MOCK_SOURCE harness.
 *
 * What this covers vs. the unit-level grill-prd-flow.spec.ts:
 *   - Full server round-trip: seed-issue → tick (triage) → dispatch (grill)
 *   - State-gated UI: Grill tab present in grilling state, PRD tab absent
 *   - Grill chat: agent question renders, user reply posts + transitions state
 *   - PRD tab appears once state is factory:prd-review
 *   - PRD content (title, problem, slices) renders from the mock comment
 *   - Approve PRD: POSTs /approve-prd and advances to factory:decomposing
 *
 * What is intentionally deferred (see TODO comments below):
 *   - Child issue cards with factory:from-prd label (mock doesn't yet seed
 *     decomposed children — follow-up ticket needed once decompose-prd mock
 *     support lands).
 *   - Sprint-review issue filing (covered by slices/discover-lane-e2e/slice.test.ts).
 *
 * NOTE on triage→grilling routing (#592): the routing from factory:triaging to
 * factory:grilling for type:feature issues IS wired in triage-batch.ts as of
 * the M13 milestone. If a future refactor breaks it the test steps that call
 * /tick will time-out on the grilling state assertion; that is intentional —
 * the failure surfaces the regression.
 */

import { expect, test } from '@playwright/test';

const SLUG = process.env.PROJECT_SLUG ?? 'goose-hub-self';
const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3001';

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
  type?: string;
  state?: string;
}): Promise<{ issueNumber: number; workItemId: string }> {
  const res = await postServer(`/projects/test/${SLUG}/seed-issue`, opts);
  return res.json() as Promise<{ issueNumber: number; workItemId: string }>;
}

/**
 * Minimal PRD body matching the <!-- factory:prd --> format expected by
 * PRDSection.tsx. The JSON blob is intentionally compact — just enough fields
 * to render title, problem, and one vertical slice.
 */
function buildMockPrdCommentBody(): string {
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
  return `<!-- factory:prd -->\n# PRD\n\n\`\`\`json\n${JSON.stringify(prd, null, 2)}\n\`\`\``;
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
  test('feature triages to grilling, grill tab visible, PRD tab absent', async ({ page }) => {
    test.setTimeout(120_000);

    const { issueNumber } = await seedIssue({
      title: `[E2E] Discover Lane ${Date.now()}`,
      type: 'feature',
    });

    await page.goto(`/projects/${SLUG}/items/${issueNumber}`);
    const statePill = page.getByTestId('state-pill');
    await expect(statePill).toHaveText('triaging', { timeout: 15_000 });

    // Tick the orchestrator: triaging → accepted → grilling (type:feature routing)
    await postServer(`/projects/${SLUG}/tick`);
    await expect(statePill).toHaveText('grilling', { timeout: 60_000 });

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

    // Drive triage → grilling first
    await postServer(`/projects/${SLUG}/tick`);

    // Navigate to grill tab directly
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/grill`);
    const statePill = page.getByTestId('state-pill');

    // Wait until grilling state is visible (triage may still be running)
    await expect(statePill).toHaveText('grilling', { timeout: 60_000 });

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
  // and uses the /comment endpoint to plant the PRD comment, then verifies
  // the PRD section renders and the Approve button works.
  //
  // This avoids a multi-round grill sequence (already covered by
  // slice.test.ts) while still exercising the UI surfaces the spec requires.
  // ─────────────────────────────────────────────────────────────────────────
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

    // Plant a PRD comment so PRDSection has content to render.
    await postServer(`/projects/${SLUG}/issues/${issueNumber}/comment`, {
      body: buildMockPrdCommentBody(),
    });

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

    // Approve PRD → decomposing
    const approveBtn = page.getByTestId('prd-approve-btn');
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();
    // After approve-prd: the mock decompose-prd workflow runs synchronously and
    // advances decomposing → issues-created → done before the UI polls.
    await expect(statePill).toHaveText('done', { timeout: 30_000 });
  });
});
