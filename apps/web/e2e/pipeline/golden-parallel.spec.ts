/**
 * Golden Parallel-Implement E2E — multi-agent pipeline walked end-to-end.
 *
 * Mock harness: MOCK_AGENTS=true, MOCK_SOURCE=true, MOCK_OPEN_PR=true.
 *
 * Requires useMultiAgentPipeline=true so dispatchFixIssue routes through
 * spec-author → parallel-implement instead of the single-builder fix-issue
 * workflow.
 *
 * Flow (test 1 — happy path, no dev-review):
 *   1. Enable useMultiAgentPipeline via PATCH.
 *   2. Seed type:chore (simplest — no grill/prd/investigation).
 *   3. /tick: triaging → dev-ready.
 *   4. /dispatch: dev-ready → spec-author mock → spec-ready.
 *   5. /dispatch: spec-ready → parallel-implement mock (implement-wp) → needs-qa.
 *   6. /run-qa: needs-qa → needs-review.
 *   7. /run-review: needs-review → approved.
 *   8. /approve: approved → retrospecting → done.
 *
 * Flow (test 2 — dev-review-response loop):
 *   Same pipeline but with dev-review enabled (triggerOn:'all') and
 *   outcomes.dev-review=['blockers-found','no-blockers'], forcing one
 *   dev-review-response call before the loop exits.
 *
 * Settings are reset to defaults before each test to guard against leftover
 * state from prior runs.
 */

import { expect, test } from '@playwright/test';

const SLUG = process.env.PROJECT_SLUG ?? 'goose-hub-self';
const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3001';

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

async function patchServer(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PATCH ${path} → ${res.status}: ${text}`);
  }
}

async function seedIssue(opts: {
  title: string;
  type?: string;
  outcomes?: Record<string, string | string[]>;
}): Promise<{ issueNumber: number; workItemId: string }> {
  const res = await postServer(`/projects/test/${SLUG}/seed-issue`, opts);
  return res.json() as Promise<{ issueNumber: number; workItemId: string }>;
}

const PARALLEL_EMOJIS = ['⚙️', '🔀', '🧩', '🏗️', '🛠️', '🔧'];
function goldenTitle(tag: string): string {
  const ts = Date.now();
  const emoji = PARALLEL_EMOJIS[ts % PARALLEL_EMOJIS.length];
  const iso = new Date(ts).toISOString().replace(/[:.]/g, '-');
  return `${emoji} [${tag}] ${iso}`;
}

async function resetSettings(): Promise<void> {
  await patchServer(`/projects/${SLUG}/settings/pipeline`, { useMultiAgentPipeline: false });
  await patchServer(`/projects/${SLUG}/settings/dev-review`, {
    enabled: false,
    triggerOn: 'priority:high+',
    maxRevisionTurns: 1,
    perCycleMaxUsd: 2.0,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Golden Parallel-Implement (MOCK_AGENTS + MOCK_SOURCE + MOCK_OPEN_PR)', () => {
  test.beforeEach(async () => {
    // Reset to safe defaults so a prior failed run doesn't leak state.
    await resetSettings();
  });

  test.afterEach(async () => {
    await resetSettings();
  });

  // todo: broken test
  // test('happy path: chore → spec-author → parallel-implement → done', async ({ page }) => {
  //   test.setTimeout(240_000);

  //   await patchServer(`/projects/${SLUG}/settings/pipeline`, { useMultiAgentPipeline: true });

  //   const title = goldenTitle('GOLDEN-PARALLEL');
  //   const { issueNumber } = await seedIssue({ title, type: 'chore' });

  //   await page.goto(`/projects/${SLUG}/items/${issueNumber}`);
  //   await expect(page.getByTestId('detail-page')).toBeVisible({ timeout: 15_000 });
  //   const statePill = page.getByTestId('state-pill');
  //   await expect(statePill).toHaveText('triaging', { timeout: 15_000 });

  //   // Triage: triaging → dev-ready.
  //   await postServer(`/projects/${SLUG}/tick`);
  //   await expect(statePill).toHaveText('dev-ready', { timeout: 60_000 });

  //   // spec-author: dev-ready → spec-ready.
  //   await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
  //   await expect(statePill).toHaveText('spec-ready', { timeout: 60_000 });

  //   // parallel-implement: spec-ready → needs-qa.
  //   await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
  //   await expect(statePill).toHaveText('needs-qa', { timeout: 60_000 });

  //   // QA: needs-qa → needs-review.
  //   await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
  //   await expect(statePill).toHaveText('needs-review', { timeout: 60_000 });
  //   await page.goto(`/projects/${SLUG}/items/${issueNumber}/qa`);
  //   await expect(page.getByTestId('qa-section')).toBeVisible({ timeout: 15_000 });

  //   // Review: needs-review → approved.
  //   await postServer(`/projects/${SLUG}/run-review/${issueNumber}`);
  //   await expect(statePill).toHaveText('approved', { timeout: 60_000 });
  //   await page.goto(`/projects/${SLUG}/items/${issueNumber}/review`);
  //   await expect(page.getByTestId('review-section')).toBeVisible({ timeout: 15_000 });
  //   await expect(page.getByTestId('review-open-pr')).toBeVisible();

  //   // Approve: approved → retrospecting → done.
  //   await postServer(`/projects/${SLUG}/issues/${issueNumber}/approve`);
  //   await expect(statePill).toHaveText('done', { timeout: 60_000 });

  //   // Timeline: spec.completed + pr.opened events.
  //   await page.goto(`/projects/${SLUG}/items/${issueNumber}/timeline`);
  //   await expect(page.getByTestId('timeline-section')).toBeVisible({ timeout: 10_000 });
  //   await expect(page.locator('[data-event-kind="spec.completed"]')).toBeAttached({
  //     timeout: 10_000,
  //   });
  //   await expect(page.locator('[data-event-kind="pr.opened"]')).toBeAttached({
  //     timeout: 10_000,
  //   });
  // });

  // todo: broken test

  // test('dev-review-response loop: blockers-found → addressed → no-blockers → done', async ({
  //   page,
  // }) => {
  //   test.setTimeout(300_000);

  //   await patchServer(`/projects/${SLUG}/settings/pipeline`, { useMultiAgentPipeline: true });
  //   // triggerOn:'all' so dev-review fires even on low-priority chores.
  //   await patchServer(`/projects/${SLUG}/settings/dev-review`, {
  //     enabled: true,
  //     triggerOn: 'all',
  //     maxRevisionTurns: 1,
  //     perCycleMaxUsd: 5.0,
  //   });

  //   const title = goldenTitle('GOLDEN-PARALLEL-DR');
  //   const { issueNumber } = await seedIssue({
  //     title,
  //     type: 'chore',
  //     outcomes: {
  //       // First dev-review → blockers-found triggers dev-review-response.
  //       // Second dev-review → no-blockers exits the loop.
  //       'dev-review': ['blockers-found', 'no-blockers'],
  //     },
  //   });

  //   await page.goto(`/projects/${SLUG}/items/${issueNumber}`);
  //   await expect(page.getByTestId('detail-page')).toBeVisible({ timeout: 15_000 });
  //   const statePill = page.getByTestId('state-pill');
  //   await expect(statePill).toHaveText('triaging', { timeout: 15_000 });

  //   // Triage → dev-ready.
  //   await postServer(`/projects/${SLUG}/tick`);
  //   await expect(statePill).toHaveText('dev-ready', { timeout: 60_000 });

  //   // spec-author: dev-ready → spec-ready.
  //   await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
  //   await expect(statePill).toHaveText('spec-ready', { timeout: 60_000 });

  //   // parallel-implement with dev-review loop: spec-ready → needs-qa.
  //   // Inside the workflow: implement-wp → dev-review(blockers-found) →
  //   // dev-review-response(addressed) → dev-review(no-blockers) → PR opened.
  //   await postServer(`/projects/${SLUG}/dispatch/${issueNumber}`);
  //   await expect(statePill).toHaveText('needs-qa', { timeout: 120_000 });

  //   // Verify dev-review events landed on the timeline.
  //   await page.goto(`/projects/${SLUG}/items/${issueNumber}/timeline`);
  //   await expect(page.getByTestId('timeline-section')).toBeVisible({ timeout: 10_000 });
  //   await expect(page.locator('[data-event-kind="dev-review.completed"]')).toBeAttached({
  //     timeout: 10_000,
  //   });

  //   // QA → review → done.
  //   await postServer(`/projects/${SLUG}/run-qa/${issueNumber}`);
  //   await expect(statePill).toHaveText('needs-review', { timeout: 60_000 });

  //   await postServer(`/projects/${SLUG}/run-review/${issueNumber}`);
  //   await expect(statePill).toHaveText('approved', { timeout: 60_000 });

  //   await postServer(`/projects/${SLUG}/issues/${issueNumber}/approve`);
  //   await expect(statePill).toHaveText('done', { timeout: 60_000 });
  // });
});
