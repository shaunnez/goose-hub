/**
 * Golden Feature E2E — single feature walked end-to-end through every UI surface.
 *
 * Mock harness: MOCK_AGENTS=true, MOCK_SOURCE=true, MOCK_OPEN_PR=true.
 *
 * Flow (one issue, one trace):
 *   1. Seed a feature with a unique emoji+timestamp title.
 *   2. /tick: triaging → grilling. Confirm Grill tab visible, PRD tab absent.
 *   3. /dispatch: grilling → gate-pending. Agent question rendered.
 *   4. UI reply via grill-reply-input + grill-send-btn → state returns to grilling.
 *   5. Manual transitions grilling → prd-drafting → prd-review (legal per
 *      core/state-machine/transitions.ts) to bypass the multi-round grill loop —
 *      that loop is already covered by discover-lane.spec.ts.
 *   6. Plant a PRD comment so PRDSection renders content; assert it.
 *   7. Click prd-approve-btn. Mock decompose-prd runs synchronously: parent goes
 *      decomposing → issues-created → done and child issues are created.
 *   8. Read parent comments to extract child issue numbers.
 *   9. Return to the board, confirm child cards exist.
 *  10. Walk the FIRST child through its dev cycle:
 *      triaging → dev-ready → needs-qa → needs-review → approved → done.
 *      Capture overview / qa / review / timeline (pr.opened) along the way.
 *
 * Trace + video are recorded for every run (not just retries) so the artefact
 * is the report itself.
 */

import { expect, test } from '@playwright/test';

const SLUG = process.env.PROJECT_SLUG ?? 'goose-hub-self';
const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3001';

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

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function seedIssue(opts: {
  title: string;
  type?: string;
  state?: string;
}): Promise<{ issueNumber: number; workItemId: string }> {
  const res = await postServer(`/projects/test/${SLUG}/seed-issue`, opts);
  return res.json() as Promise<{ issueNumber: number; workItemId: string }>;
}

async function transition(issueNumber: number, from: string, to: string): Promise<void> {
  await postServer(`/projects/${SLUG}/issues/${issueNumber}/transition`, { from, to });
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

function buildMockPrdCommentBody(title: string): string {
  const prd = {
    title,
    problem: 'Golden-path coverage is missing for the feature flow.',
    proposedSolution: 'Walk one feature end-to-end via the pipeline harness.',
    outOfScope: ['Real GitHub roundtrip'],
    successCriteria: ['Each UI surface renders for its state'],
    acceptanceCriteria: [
      { id: 'AC-1', statement: 'Feature reaches done with child issues.', journeyId: 'J-1' },
    ],
    journeys: [
      {
        id: 'J-1',
        persona: 'Maintainer',
        trigger: 'Runs the golden spec',
        steps: [
          {
            userAction: 'Approves the PRD',
            systemResponse: 'Decomposes into child issues',
            dataShown: 'Child issue list',
            stateChange: 'Parent → done',
          },
        ],
        successState: 'Children created and visible on the board',
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
          then: 'mock decompose-prd creates child issues',
        },
      ],
    },
    verticalSlices: [
      {
        title: 'Slice 1: child cycle',
        goal: 'Walk a child to done',
        estimatedSize: 'S',
        journeyRefs: ['J-1'],
      },
    ],
    estimatedComplexity: 'small',
    decisionSummaries: [{ kind: 'PLAN', summary: 'Golden PRD fixture.' }],
  };
  return `<!-- factory:prd -->\n# PRD\n\n\`\`\`json\n${JSON.stringify(prd, null, 2)}\n\`\`\``;
}

// Parses `- #123 — title` lines from the parent's `## Child issues` comment.
function parseChildIssueNumbers(commentBody: string): number[] {
  const out: number[] = [];
  for (const line of commentBody.split('\n')) {
    const m = /^- #(\d+)\b/.exec(line.trim());
    if (m) out.push(Number(m[1]));
  }
  return out;
}

interface CommentResponse {
  comments: Array<{ id: string; body: string }>;
}

async function findChildIssuesComment(parentNumber: number): Promise<number[]> {
  const data = await getJson<CommentResponse>(`/projects/${SLUG}/issues/${parentNumber}/comments`);
  for (const c of data.comments) {
    if (c.body.includes('## Child issues')) {
      return parseChildIssueNumbers(c.body);
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Golden Feature flow (MOCK_AGENTS + MOCK_SOURCE + MOCK_OPEN_PR)', () => {
  test('seed → grill → PRD → decompose → child cycle → done', async ({ page }) => {
    test.setTimeout(180_000);

    const title = goldenTitle();
    const { issueNumber } = await seedIssue({ title, type: 'feature' });

    // ── 1. Open detail page; baseline state.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}`);
    await expect(page.getByTestId('detail-page')).toBeVisible({ timeout: 15_000 });
    const statePill = page.getByTestId('state-pill');
    await expect(statePill).toHaveText('triaging', { timeout: 15_000 });
    await expect(page.getByTestId('overview-section')).toBeVisible();

    // ── 2. Triage the feature. type:feature routing → grilling (M13).
    await postServer(`/projects/${SLUG}/tick`);
    await expect(statePill).toHaveText('grilling', { timeout: 60_000 });

    // Grill tab visible in left rail; PRD tab not yet (state-gated).
    await expect(page.locator('[data-section-key="grill"]')).toBeVisible();
    await expect(page.locator('[data-section-key="prd"]')).toHaveCount(0);

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

    // ── 6. Plant a PRD comment so PRDSection has something to render.
    await postServer(`/projects/${SLUG}/issues/${issueNumber}/comment`, {
      body: buildMockPrdCommentBody(title),
    });

    await page.goto(`/projects/${SLUG}/items/${issueNumber}/prd`);
    await expect(page.locator('[data-section-key="prd"]')).toBeVisible();
    await expect(page.getByTestId('prd-section')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('prd-title')).toHaveText(title);
    await expect(page.getByTestId('prd-slice')).toHaveCount(1);

    // ── 7. Approve PRD. Mock decompose-prd runs synchronously: parent advances
    //      decomposing → issues-created → done and creates child issues.
    await page.getByTestId('prd-approve-btn').click();
    await expect(statePill).toHaveText('done', { timeout: 30_000 });

    // Decompose timeline event should be present.
    await page.goto(`/projects/${SLUG}/items/${issueNumber}/timeline`);
    await expect(page.getByTestId('timeline-section')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-event-kind="decompose.completed"]').first()).toBeVisible({
      timeout: 10_000,
    });

    // ── 8. Read parent's `## Child issues` comment to find children.
    const childNumbers = await findChildIssuesComment(issueNumber);
    expect(childNumbers.length).toBeGreaterThan(0);

    // ── 9. Return to the board; confirm at least one child card is visible.
    await page.goto(`/projects/${SLUG}`);
    await expect(page.getByTestId('board')).toBeVisible({ timeout: 15_000 });
    const firstChild = childNumbers[0];
    const childCard = page.locator(`[data-testid="issue-card"][data-issue-number="${firstChild}"]`);
    await expect(childCard).toBeVisible({ timeout: 15_000 });

    // ── 10. Walk the first child through its dev cycle.
    await page.goto(`/projects/${SLUG}/items/${firstChild}`);
    await expect(page.getByTestId('detail-page')).toBeVisible({ timeout: 15_000 });
    const childPill = page.getByTestId('state-pill');
    // decompose-prd creates children directly at dev-ready (skips triage; see
    // core/workflows/decompose-prd.ts), so the child opens at dev-ready.
    await expect(childPill).toHaveText('dev-ready', { timeout: 15_000 });

    // Dispatch fix-issue: dev-ready → needs-qa.
    await postServer(`/projects/${SLUG}/dispatch/${firstChild}`);
    await expect(childPill).toHaveText('needs-qa', { timeout: 60_000 });

    // QA: needs-qa → needs-review. QA section should render its content.
    await postServer(`/projects/${SLUG}/run-qa/${firstChild}`);
    await expect(childPill).toHaveText('needs-review', { timeout: 60_000 });
    await page.goto(`/projects/${SLUG}/items/${firstChild}/qa`);
    await expect(page.getByTestId('qa-section')).toBeVisible({ timeout: 15_000 });

    // Review: needs-review → approved. Review section renders + PR link.
    await postServer(`/projects/${SLUG}/run-review/${firstChild}`);
    await expect(childPill).toHaveText('approved', { timeout: 60_000 });
    await page.goto(`/projects/${SLUG}/items/${firstChild}/review`);
    await expect(page.getByTestId('review-section')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('review-open-pr')).toBeVisible();

    // Approval gate → retrospecting → done.
    await postServer(`/projects/${SLUG}/issues/${firstChild}/approve`);
    await expect(childPill).toHaveText('done', { timeout: 60_000 });

    // Final timeline check: pr.opened event must exist on the child.
    await page.goto(`/projects/${SLUG}/items/${firstChild}/timeline`);
    await expect(page.getByTestId('timeline-section')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-event-kind="pr.opened"]').first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
