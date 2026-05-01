import { expect, test } from '@playwright/test';

const REPO = 'shaunnez/goose-hub';
const TEST_MILESTONE_TITLE = '[E2E] Test Fixture';
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

test.describe('M3 happy path', () => {
  test.skip(!TOKEN, 'GITHUB_TOKEN is required.');

  let milestoneNumber: number;
  let issueNumber: number;

  test.beforeAll(async () => {
    // Find or create the test milestone.
    const all = (await gh(`/repos/${REPO}/milestones?state=all&per_page=100`)) as unknown as Array<{
      number: number;
      title: string;
      state: string;
    }>;
    let ms = all.find((m) => m.title === TEST_MILESTONE_TITLE);
    if (!ms) {
      ms = (await gh(`/repos/${REPO}/milestones`, 'POST', {
        title: TEST_MILESTONE_TITLE,
        state: 'open',
        description: 'Automated E2E fixture — do not use for real issues.',
      })) as { number: number; title: string; state: string };
    } else if (ms.state === 'closed') {
      await gh(`/repos/${REPO}/milestones/${ms.number}`, 'PATCH', { state: 'open' });
    }
    milestoneNumber = ms.number;

    // Create a test issue with the minimal labels the board needs.
    const issue = (await gh(`/repos/${REPO}/issues`, 'POST', {
      title: '[E2E] Test issue — safe to close',
      body: 'Automated fixture created by the happy-path E2E test.',
      milestone: milestoneNumber,
      labels: [
        'factory:triaging',
        'priority:high',
        'type:chore',
        'schedule:current',
        'mode:supervised',
        'exec:serial',
      ],
    })) as { number: number };
    issueNumber = issue.number;
  });

  test.afterAll(async () => {
    if (issueNumber) {
      await gh(`/repos/${REPO}/issues/${issueNumber}`, 'PATCH', { state: 'closed' });
    }
    if (milestoneNumber) {
      await gh(`/repos/${REPO}/milestones/${milestoneNumber}`, 'PATCH', { state: 'closed' });
    }
  });

  test('open app → kanban → detail → timeline → transition', async ({ page }) => {
    test.setTimeout(90_000);

    // 1. Open Goose Hub.
    await page.goto('/');
    await expect(page).toHaveURL(/\/projects\/goose-hub-self/);

    // 2. Project auto-selected.
    await expect(page.getByTestId('project-switcher')).toHaveValue('goose-hub-self');

    // 3. Select the test milestone so only our seeded issue appears.
    // Wait for the <select> specifically — the loading div shares the same testid.
    const milestoneSelector = page.locator('select[data-testid="milestone-selector"]');
    await expect(milestoneSelector).toBeVisible({ timeout: 15_000 });
    await milestoneSelector.selectOption({ value: String(milestoneNumber) });

    // 4. Kanban visible with the seeded issue.
    const board = page.getByTestId('board');
    await expect(board).toBeVisible();
    const cards = page.getByTestId('issue-card');
    await expect.poll(async () => cards.count(), { timeout: 15_000 }).toBeGreaterThan(0);

    // 5. Click the seeded issue card.
    const target = cards.filter({ hasText: '[E2E]' }).first();
    const cardNumber = await target.getAttribute('data-issue-number');
    await target.click();

    // 6. Detail page opens with the 10-section left rail.
    await expect(page.getByTestId('detail-page')).toBeVisible();
    await expect(page.getByTestId('detail-left-rail')).toBeVisible();

    // 7. Overview shows body.
    await expect(page.getByTestId('overview-section')).toBeVisible();
    await expect(page.getByTestId('overview-body')).toBeVisible();

    // 8. Right rail empty-state present.
    await expect(page.getByTestId('detail-right-rail')).toContainText(/No agent runs/i);

    // 8a. Post a comment via the CommentComposer.
    const composer = page.getByTestId('comment-composer');
    await expect(composer).toBeVisible();

    const textarea = composer.locator('textarea');
    await textarea.fill('E2E test comment — safe to ignore');

    // Submit button should now be enabled.
    const submitBtn = composer.getByTestId('comment-submit');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // After submit: textarea clears.
    await expect(textarea).toHaveValue('', { timeout: 5000 });

    // 8b. Markdown preview tab works.
    await textarea.fill('**bold test**');
    await composer.getByRole('button', { name: 'preview' }).click();
    const preview = page.getByTestId('markdown-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('bold test');
    // Switch back to write tab.
    await composer.getByRole('button', { name: 'write' }).click();

    // 9. Navigate to Timeline section.
    await page.getByRole('link', { name: 'Timeline' }).click();
    await expect(page.getByTestId('timeline-section')).toBeVisible();

    // 10. If the work item has legal next states, verify the popover renders them.
    const transitionBtn = page.getByTestId('transition-button');
    if ((await transitionBtn.count()) > 0) {
      await transitionBtn.click();
      const popover = page.getByTestId('transition-popover');
      await expect(popover).toBeVisible();
      const targets = popover.locator('button[data-testid^="transition-target-"]');
      await expect(targets.first()).toBeVisible();
    }

    // 11. Direct URL roundtrip works.
    if (cardNumber != null) {
      await page.goto(`/projects/goose-hub-self/items/${cardNumber}`);
      await expect(page.getByTestId('detail-page')).toBeVisible();
    }

    // 12. Back to Board returns us.
    await page.getByTestId('back-to-board').click();
    await expect(page.getByTestId('board')).toBeVisible();
  });

  test('capture → inbox → promote → gone', async ({ page }) => {
    test.setTimeout(60_000);

    const captureTitle = `[E2E Capture] ${Date.now()}`;

    try {
      // 1. Navigate to the board.
      await page.goto('/projects/goose-hub-self');

      // 2. Click the Capture button in the TopBar.
      await page.getByRole('button', { name: /capture/i }).click();

      // 3. Fill the title input.
      await page.locator('#capture-title').fill(captureTitle);

      // 4. Submit — click the "Capture" button inside the modal.
      await page.getByRole('button', { name: 'Capture' }).click();

      // 5. Wait for the modal to close.
      await expect(page.locator('#capture-title')).not.toBeVisible({ timeout: 10_000 });

      // 6. Navigate to the inbox.
      await page.goto('/projects/goose-hub-self/inbox');

      // 7. Wait for the inbox list to be visible.
      await expect(page.getByTestId('inbox-list')).toBeVisible({ timeout: 15_000 });

      // 8. The newly captured item should be visible.
      const capturedItem = page
        .locator('[data-testid="inbox-list"] li')
        .filter({ hasText: '[E2E Capture]' });
      await expect(capturedItem).toBeVisible({ timeout: 10_000 });

      // 9. Click "Promote" on that item.
      await capturedItem.getByRole('button', { name: /promote/i }).click();

      // 10. Wait for the promote modal — select project.
      const projectPicker = page.locator('select[aria-label="Select project"]');
      await expect(projectPicker).toBeVisible({ timeout: 10_000 });
      await projectPicker.selectOption('goose-hub-self');

      // 11. Click "Next".
      await page.getByRole('button', { name: /next/i }).click();

      // 12. Confirm screen — click the accent "Promote" button.
      await page.getByRole('button', { name: 'Promote' }).click();

      // 13. Wait for the modal to close.
      await expect(projectPicker).not.toBeVisible({ timeout: 10_000 });

      // 14. Assert the item is no longer in the inbox list.
      const stillPresent = page
        .locator('[data-testid="inbox-list"] li')
        .filter({ hasText: captureTitle });
      await expect(stillPresent).not.toBeVisible({ timeout: 10_000 });
    } finally {
      // cleanup: close the issue created by promote
      try {
        const open = (await gh(
          `/repos/${REPO}/issues?state=open&per_page=100`,
        )) as unknown as Array<{ number: number; title: string }>;
        const created = open.find((i) => i.title.startsWith('[E2E Capture]'));
        if (created) {
          await gh(`/repos/${REPO}/issues/${created.number}`, 'PATCH', { state: 'closed' });
        }
      } catch {
        /* best-effort */
      }
    }
  });

  test('gate-pending banner → approve → transitions state', async ({ page }) => {
    test.setTimeout(60_000);

    const gateIssue = (await gh(`/repos/${REPO}/issues`, 'POST', {
      title: `[E2E Gate] ${Date.now()}`,
      body: 'E2E fixture',
      milestone: milestoneNumber,
      labels: [
        'factory:needs-review',
        'priority:medium',
        'type:chore',
        'schedule:current',
        'mode:supervised',
        'exec:serial',
      ],
    })) as { number: number };

    try {
      // 1. Navigate directly to the detail page.
      await page.goto(`/projects/goose-hub-self/items/${gateIssue.number}`);

      // 2. Wait for the detail page to be visible.
      await expect(page.getByTestId('detail-page')).toBeVisible({ timeout: 15_000 });

      // 3. Wait for the gate-pending banner.
      await expect(page.getByTestId('gate-pending-banner')).toBeVisible({ timeout: 15_000 });

      // 4. Click Approve.
      await page.getByTestId('gate-action-approve').click();

      // 5. Wait for the banner to disappear.
      await expect(page.getByTestId('gate-pending-banner')).not.toBeVisible({ timeout: 15_000 });
    } finally {
      // cleanup: close the gate issue
      try {
        await gh(`/repos/${REPO}/issues/${gateIssue.number}`, 'PATCH', { state: 'closed' });
      } catch {
        /* best-effort */
      }
    }
  });

  test('fake-run → agent events appear in timeline → structured output in right rail', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    // 1. Navigate to the detail page for the issue created in beforeAll.
    await page.goto(`/projects/goose-hub-self/items/${issueNumber}`);

    // 2. Wait for the detail page.
    await expect(page.getByTestId('detail-page')).toBeVisible({ timeout: 15_000 });

    // 3. Navigate to the Timeline section.
    await page.getByRole('link', { name: 'Timeline' }).click();

    // 4. Wait for the timeline section.
    await expect(page.getByTestId('timeline-section')).toBeVisible({ timeout: 10_000 });

    // 5. Click the fake-run button to start the fake agent run.
    await page.getByTestId('fake-run-btn').first().click();

    // 6. Wait for agent.spawned event in the timeline.
    await expect(page.locator('[data-event-kind="agent.spawned"]')).toBeVisible({
      timeout: 15_000,
    });

    // 7. Wait for agent.terminated event (fake run takes ~5–6s with 600ms delays per log line).
    await expect(page.locator('[data-event-kind="agent.terminated"]')).toBeVisible({
      timeout: 30_000,
    });

    // 8. Verify the right rail has structured output.
    await expect(page.getByTestId('detail-right-rail')).toContainText(/"decision"\s*:/, {
      timeout: 10_000,
    });
  });
});
