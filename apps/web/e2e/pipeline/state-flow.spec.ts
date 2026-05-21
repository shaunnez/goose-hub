import { expect, test } from '@playwright/test';

const REPO = 'shaunnez/goose-hub';
const PROJECT_SLUG = 'goose-hub-self';
const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3001';
const MILESTONE_TITLE = '[E2E Pipeline] Tests';
const TOKEN = process.env.GITHUB_TOKEN ?? '';

async function gh(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path} → ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

async function postServer(path: string, body?: unknown) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res;
}

test.describe('Pipeline e2e (MOCK_AGENTS=true)', () => {
  test.skip(!TOKEN, 'GITHUB_TOKEN is required.');

  let milestoneNumber: number;
  let choreIssueNumber: number | undefined;
  let bugIssueNumber: number | undefined;

  test.beforeAll(async () => {
    const all = (await gh(`/repos/${REPO}/milestones?state=all&per_page=100`)) as unknown as Array<{
      number: number;
      title: string;
      state: string;
    }>;
    let ms = all.find((m) => m.title === MILESTONE_TITLE);
    if (!ms) {
      ms = (await gh(`/repos/${REPO}/milestones`, 'POST', {
        title: MILESTONE_TITLE,
        state: 'open',
        description: 'Automated E2E pipeline fixture — do not use for real issues.',
      })) as { number: number; title: string; state: string };
    } else if (ms.state === 'closed') {
      await gh(`/repos/${REPO}/milestones/${ms.number}`, 'PATCH', { state: 'open' });
    }
    milestoneNumber = ms.number;

    await postServer(`/projects/${PROJECT_SLUG}/active-milestone`, { milestoneNumber });
  });

  test.afterAll(async () => {
    if (choreIssueNumber) {
      try {
        await gh(`/repos/${REPO}/issues/${choreIssueNumber}`, 'PATCH', { state: 'closed' });
      } catch {
        /* best-effort */
      }
    }
    if (bugIssueNumber) {
      try {
        await gh(`/repos/${REPO}/issues/${bugIssueNumber}`, 'PATCH', { state: 'closed' });
      } catch {
        /* best-effort */
      }
    }
    if (milestoneNumber) {
      try {
        await gh(`/repos/${REPO}/milestones/${milestoneNumber}`, 'PATCH', { state: 'closed' });
      } catch {
        /* best-effort */
      }
    }
  });

  test('chore pipeline: inbox capture → factory:approved', async ({ page }) => {
    test.setTimeout(180_000);
    const choreTitle = `[E2E Pipeline] Chore ${Date.now()}`;
    const choreBody = [
      'Need to tidy the promotion flow copy.',
      '',
      'The AI enhancement option should work outside bug promotion too.',
    ].join('\n');

    // 1. Capture an inbox idea via the top-bar button.
    await page.goto(`/projects/${PROJECT_SLUG}`);
    await page.getByTestId('capture-button').click();
    await page.getByTestId('capture-title-input').fill(choreTitle);
    await page.getByLabel('Type').selectOption('chore');
    await page.getByPlaceholder('Any additional context…').fill(choreBody);
    await page.getByTestId('capture-submit').click();

    // 2. Confirm capture modal closed, then go to inbox.
    await expect(page.getByTestId('capture-title-input')).not.toBeVisible({ timeout: 10_000 });
    await page.goto(`/projects/${PROJECT_SLUG}/inbox`);
    await expect(page.getByTestId('inbox-list')).toBeVisible({ timeout: 15_000 });

    // 3. Promote the captured item to a real GitHub issue.
    const inboxRow = page.getByTestId('inbox-item').filter({ hasText: choreTitle }).first();
    await expect(inboxRow).toBeVisible({ timeout: 10_000 });
    await inboxRow.getByTestId('promote-button').click();

    await page.getByTestId('promote-project-select').selectOption(PROJECT_SLUG);
    const enhanceCheckbox = page.getByRole('checkbox', { name: /enhance/i });
    await expect(enhanceCheckbox).toBeVisible();
    await expect(enhanceCheckbox).toBeChecked();
    await page.getByTestId('promote-next').click();
    await page.getByTestId('promote-confirm').click();

    // 4. Inbox item disappears once promoted.
    await expect(page.getByTestId('inbox-item').filter({ hasText: choreTitle })).not.toBeVisible({
      timeout: 15_000,
    });

    // 5. Find the freshly created issue on the board.
    await page.goto(`/projects/${PROJECT_SLUG}`);
    const milestoneSelector = page.locator('select[data-testid="milestone-selector"]');
    await expect(milestoneSelector).toBeVisible({ timeout: 15_000 });
    await milestoneSelector.selectOption({ value: String(milestoneNumber) });

    const cards = page.getByTestId('issue-card');
    const card = cards.filter({ hasText: choreTitle }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    const cardNumberAttr = await card.getAttribute('data-issue-number');
    if (!cardNumberAttr) throw new Error('issue-card missing data-issue-number');
    choreIssueNumber = Number(cardNumberAttr);
    const createdIssue = (await gh(`/repos/${REPO}/issues/${choreIssueNumber}`)) as {
      body?: string | null;
    };
    expect(createdIssue.body).toBeTruthy();
    expect(createdIssue.body).toContain(choreBody);
    expect(createdIssue.body).not.toBe(choreBody);
    expect(createdIssue.body).toContain('\n\n---\n\n');

    // 6. Open the detail page; switch to Timeline.
    await card.click();
    await expect(page.getByTestId('detail-page')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('link', { name: 'Timeline' }).click();
    await expect(page.getByTestId('timeline-section')).toBeVisible({ timeout: 10_000 });

    // 7. Kick off triage. With MOCK_AGENTS=true the mock honours the issue's
    //    type:chore label and routes: triaging → accepted → dev-ready.
    await postServer(`/projects/${PROJECT_SLUG}/tick`);

    const statePill = page.getByTestId('state-pill');
    await expect(statePill).toHaveText('factory:dev-ready', { timeout: 60_000 });

    // 8. Dispatch fix-issue directly (no webhook reliance): in-progress → needs-qa.
    await postServer(`/projects/${PROJECT_SLUG}/dispatch/${choreIssueNumber}`);
    await expect(statePill).toHaveText('factory:needs-qa', { timeout: 60_000 });

    // 9. Drive QA and Review per-issue (no cross-bleed onto other items).
    await postServer(`/projects/${PROJECT_SLUG}/run-qa/${choreIssueNumber}`);
    await expect(statePill).toHaveText('factory:needs-review', { timeout: 60_000 });

    await postServer(`/projects/${PROJECT_SLUG}/run-review/${choreIssueNumber}`);
    await expect(statePill).toHaveText('factory:approved', { timeout: 60_000 });

    // 9. Spot-check the timeline shows the agent + PR events the mocks produce.
    await expect(page.locator('[data-event-kind="agent.triage-complete"]').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-event-kind="agent.implement-complete"]').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-event-kind="pr.opened"]').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('bug pipeline: triaging → factory:investigation-complete', async ({ page }) => {
    test.setTimeout(120_000);

    // 1. Create the bug issue directly so triage sees type:bug already on it.
    const issue = (await gh(`/repos/${REPO}/issues`, 'POST', {
      title: `[E2E Pipeline] Bug ${Date.now()}`,
      body: 'Automated e2e fixture — safe to close.',
      milestone: milestoneNumber,
      labels: [
        'factory:triaging',
        'priority:medium',
        'type:bug',
        'schedule:current',
        'mode:supervised',
        'exec:serial',
      ],
    })) as { number: number };
    bugIssueNumber = issue.number;

    // 2. Open the detail page; switch to Timeline.
    await page.goto(`/projects/${PROJECT_SLUG}/items/${bugIssueNumber}`);
    await expect(page.getByTestId('detail-page')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('link', { name: 'Timeline' }).click();
    await expect(page.getByTestId('timeline-section')).toBeVisible({ timeout: 10_000 });

    // 3. Trigger triage. The label-aware mock returns type:bug, so triage routes
    //    triaging → accepted → investigating.
    await postServer(`/projects/${PROJECT_SLUG}/tick`);

    const statePill = page.getByTestId('state-pill');
    await expect(statePill).toHaveText('factory:investigating', { timeout: 60_000 });

    // 4. Dispatch investigate directly: investigating → investigation-complete.
    await postServer(`/projects/${PROJECT_SLUG}/dispatch/${bugIssueNumber}`);
    await expect(statePill).toHaveText('factory:investigation-complete', { timeout: 60_000 });

    await expect(page.locator('[data-event-kind="agent.triage-complete"]').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.locator('[data-event-kind="agent.investigation-complete"]').first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
