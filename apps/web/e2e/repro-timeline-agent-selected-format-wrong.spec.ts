import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.use({ video: 'on' });

const EVIDENCE_DIR = '/tmp/repro-timeline-agent-selected-format-wrong';

test('fix: Timeline agent.model-selected renders formatted display', async ({ page }) => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const consoleErrors: Array<{ message: string; type: string }> = [];
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type()))
      consoleErrors.push({ message: msg.text(), type: msg.type() });
  });

  await page.goto('/projects/goose-hub-self/items/8/timeline', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="timeline-section"]', { timeout: 15000 });
  await page.screenshot({ path: `${EVIDENCE_DIR}/step-1.png` });

  const modelSelectedEvent = page.locator('[data-event-kind="agent.model-selected"]');
  await expect(modelSelectedEvent).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/step-2.png` });

  // No raw JSON <pre> — formatted display renders instead
  const rawJsonPre = modelSelectedEvent.locator('pre');
  await expect(rawJsonPre).toHaveCount(0);

  // Header shows human label, not raw kind string
  const kindLabel = modelSelectedEvent.locator('.font-mono.uppercase');
  await expect(kindLabel.first()).toContainText('Model selected');

  console.log('CONSOLE_ERRORS', JSON.stringify(consoleErrors));
});
