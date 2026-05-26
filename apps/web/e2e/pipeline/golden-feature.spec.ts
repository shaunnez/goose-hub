/**
 * Golden Feature E2E — single feature walked end-to-end through every UI surface.
 *
 * Mock harness: MOCK_AGENTS=true, MOCK_SOURCE=true, MOCK_OPEN_PR=true.
 *
 * Flow (one issue, one trace):
 *   1. Seed a feature with a unique emoji+timestamp title.
 *   2. /tick: clean feature triaging → grilling. Confirm Grill tab visible.
 *   3. /dispatch: grilling → gate-pending. Agent question rendered.
 *   4. UI reply via grill-reply-input + grill-send-btn → state returns to grilling.
 *   5. Manual transitions grilling → prd-drafting → prd-review (legal per
 *      core/state-machine/transitions.ts) to bypass the multi-round grill loop —
 *      that loop is already covered by discover-lane.spec.ts.
 *   6. Seed a PRD event so PRDSection renders content; assert it.
 *   7. Click prd-approve-btn. Current PRD approval routes the parent into
 *      delivery: dev-ready → needs-qa.
 *   8. Walk the parent through QA → review → approve → done and capture
 *      overview / qa / review / timeline surfaces along the way.
 *
 * Trace + video are recorded for every run (not just retries) so the artefact
 * is the report itself.
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

// Trace+video on every run for the golden specs (not just on-first-retry).
test.use({ trace: 'on', video: 'on' });

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

async function seedPrd(issueNumber: number, prd: unknown): Promise<void> {
  await postServer(`/projects/test/${SLUG}/issues/${issueNumber}/seed-prd`, { prd });
}

async function transition(issueNumber: number, from: string, to: string): Promise<void> {
  await postServer(`/projects/${SLUG}/issues/${issueNumber}/transition`, { from, to });
}

async function ensureFeatureRoutedToGrilling(statePill: Locator): Promise<void> {
  await expect
    .poll(async () => ((await statePill.textContent()) ?? '').trim(), { timeout: 15_000 })
    .toMatch(/^(triaging|accepted|grilling)$/);

  const currentState = ((await statePill.textContent()) ?? '').trim();
  if (currentState !== 'grilling') {
    await postServer(`/projects/${SLUG}/tick`);
  }
  await expect(statePill).toHaveText('grilling', { timeout: 60_000 });
}

// Pick a deterministic but distinct emoji per run so a human eyeballing the
// board across runs can tell golden runs apart.
const FEATURE_EMOJIS = ['🦫', '🪐', '🛸', '🦊', '🌈', '⚡️', '🐙', '🔮'];
function goldenTitle(): string {
  const ts = Date.now();
  const emoji = FEATURE_EMOJIS[ts % FEATURE_EMOJIS.length];
  const iso = new Date(ts).toISOString().replace(/[:.]/g, '-');
  return `${emoji} [GOLDEN-FEATURE] ${iso}`;
}

function buildMockPrd(title: string) {
  const prd = {
    title,
    problem: 'Golden-path coverage is missing for the feature flow.',
    proposedSolution: 'Walk one feature end-to-end via the pipeline harness.',
    outOfScope: ['Real GitHub roundtrip'],
    successCriteria: ['Each UI surface renders for its state'],
    acceptanceCriteria: [
      { id: 'AC-1', statement: 'Feature reaches done after delivery.', journeyId: 'J-1' },
    ],
    journeys: [
      {
        id: 'J-1',
        persona: 'Maintainer',
        trigger: 'Runs the golden spec',
        steps: [
          {
            userAction: 'Approves the PRD',
            systemResponse: 'Mock delivery opens a PR for the parent issue',
            dataShown: 'PR, QA, and review status',
            stateChange: 'Parent enters delivery',
          },
        ],
        successState: 'Feature delivered and approved',
        errorStates: [],
        edgeCases: [],
      },
    ],
    functionalSpec: {
      behaviors: [
        {
          when: 'Approve PRD is clicked',
          given: 'state is prd-review',
          // biome-ignore lint/suspicious/noThenProperty: BDD then clause, not Promise#then
          then: 'mock delivery completes the parent issue',
        },
      ],
    },
    verticalSlices: [
      {
        title: 'Slice 1: delivery cycle',
        goal: 'Walk the parent issue to done',
        estimatedSize: 'S',
        journeyRefs: ['J-1'],
      },
    ],
    estimatedComplexity: 'small',
    decisionSummaries: [{ kind: 'PLAN', summary: 'Golden PRD fixture.' }],
  };
  return prd;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Golden Feature flow (MOCK_AGENTS + MOCK_SOURCE + MOCK_OPEN_PR)', () => {
  test('seed → grill → PRD → delivery → done', async ({ page }) => {
    test.setTimeout(180_000);

    const title = goldenTitle();
    const { issueNumber } = await seedIssue({ title, type: 'feature' });

    // ── 1. Open detail page; baseline state.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}`);
    await expect(page.getByTestId('detail-page')).toBeVisible({ timeout: 15_000 });
    const statePill = page.getByTestId('state-pill');
    await expect(page.getByTestId('overview-section')).toBeVisible();

    // ── 2. Triage the feature. type:feature routing → grilling (M13).
    await ensureFeatureRoutedToGrilling(statePill);

    // Grill tab visible in left rail; PRD tab always rendered (tabs are disabled, not hidden).
    await expect(page.locator('[data-section-key="grill"]')).toBeVisible();
    await expect(page.locator('[data-section-key="prd"]')).toBeVisible();

    // ── 3. Dispatch the grill workflow → posts a question → gate-pending.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/grill`);
    await expect(page.getByTestId('grill-section')).toBeVisible();
    await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
    await expect(statePill).toHaveText('gate-pending', { timeout: 60_000 });

    // Agent question rendered; reply form interactive.
    await expect(page.getByTestId('grill-msg-agent').first()).toBeVisible({ timeout: 15_000 });
    const replyInput = page.getByTestId('grill-reply-input');
    await expect(replyInput).toBeVisible();

    // ── 4. Reply via UI. GrillSection.tsx posts the comment then transitions
    //      gate-pending → grilling. We assert through the state-pill.
    await replyInput.fill('Golden-path reply: covering the feature surface.');
    await page.getByTestId('grill-send-btn').click();
    await expect(statePill).toHaveText('grilling', { timeout: 30_000 });

    // ── 5. Bypass remaining grill rounds (covered by discover-lane.spec.ts).
    //      Drive grilling → prd-drafting → prd-review via the legal transition
    //      table (core/state-machine/transitions.ts).
    await transition(issueNumber, 'factory:grilling', 'factory:prd-drafting');
    await transition(issueNumber, 'factory:prd-drafting', 'factory:prd-review');
    await expect(statePill).toHaveText('prd-review', { timeout: 15_000 });

    // ── 6. Seed a PRD event so PRDSection has something to render.
    await seedPrd(issueNumber, buildMockPrd(title));

    await page.goto(`/projects/${SLUG}/items/${issueNumber}/prd`);
    await expect(page.locator('[data-section-key="prd"]')).toBeVisible();
    await expect(page.getByTestId('prd-section')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('prd-title')).toHaveText(title);
    await expect(page.getByTestId('prd-slice')).toHaveCount(1);

    // ── 7. Approve PRD. Current delivery routes the parent through dev work.
    await page.getByTestId('prd-approve-btn').click();
    await expect(statePill).toHaveText('needs-qa', { timeout: 30_000 });

    // PRD approval timeline event should be present.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/timeline`);
    await expect(page.getByTestId('timeline-section')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-event-kind="prd.approved"]').first()).toBeAttached({
      timeout: 10_000,
    });

    // ── 8. Walk the parent through QA/review/approval.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}`);
    await expect(page.getByTestId('detail-page')).toBeVisible({ timeout: 15_000 });

    // QA: needs-qa → needs-review. QA section should render its content.
    await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
    await expect(statePill).toHaveText('needs-review', { timeout: 60_000 });
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/qa`);
    await expect(page.getByTestId('qa-section')).toBeVisible({ timeout: 15_000 });

    // Review: needs-review → approved. Review section renders + PR link.
    await postServer(`/projects/${SLUG}/run-review/${issueNumber}`);
    await expect(statePill).toHaveText('approved', { timeout: 60_000 });
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/review`);
    await expect(page.getByTestId('review-section')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('review-open-pr')).toBeVisible();

    // Approval gate → retrospecting → done.
    await postServer(`/projects/${SLUG}/issues/${issueNumber}/approve`);
    await expect(statePill).toHaveText('done', { timeout: 60_000 });

    // Final timeline check: merge event must exist on the parent.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/timeline`);
    await expect(page.getByTestId('timeline-section')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-event-kind="pr.merged"]')).toBeAttached({
      timeout: 10_000,
    });
  });
});
