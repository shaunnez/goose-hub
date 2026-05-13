/**
 * M17.05 — click-through to the issue detail panel.
 *
 * Asserts that clicking a desk/sprite opens the DeskDetailPanel for the
 * correct issue and that "Open full detail →" navigates to the existing
 * per-item detail route. Uses the dev-only `window.__officeScene` debug
 * hook to fire `desk-click` directly because Phaser canvas hit-testing
 * is unreliable through Playwright's synthetic mouse events.
 *
 * Runs in CI (Pipeline E2E mock) — it's a real assertion, not a
 * screenshot demo.
 */

import { expect, test } from '@playwright/test';

const SLUG = 'goose-hub-self';
const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3099';

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

test.describe('M17.05 — Office desk click-through', () => {
  test('clicking a desk opens the detail panel and links to the full item page', async ({
    page,
  }) => {
    // Seed one in-progress issue so a sprite is at the developer desk.
    const seedRes = await postServer(`/projects/test/${SLUG}/seed-issue`, {
      title: 'M17.05 click-through fixture',
      state: 'factory:in-progress',
      type: 'feature',
    });
    const { issueNumber } = (await seedRes.json()) as { issueNumber: number };

    await page.goto(`/projects/${SLUG}/office`);
    await page.waitForSelector('[data-testid="office-canvas"]', { timeout: 20_000 });
    // Wait for Phaser to boot — the scene emits its texture-generated assets
    // synchronously in create() but React applyPlacements runs in the next
    // tick, so a small settle gives sprites time to spawn.
    await page.waitForTimeout(1_500);

    // Fire a desk-click via the dev-only debug hook. Phaser canvas hit
    // testing through Playwright's synthetic mouse events is finicky; the
    // emit path here is the same one the real sprite pointerdown handler
    // invokes in OfficeScene.spawnSprite.
    await page.evaluate(
      ({ slug, externalId }) => {
        interface SceneShape {
          events_(): { emit(event: string, payload: unknown): void };
        }
        const scene = (window as unknown as { __officeScene?: SceneShape }).__officeScene;
        if (!scene) throw new Error('window.__officeScene is not exposed');
        scene.events_().emit('desk-click', {
          projectSlug: slug,
          workItemId: `mock:${externalId}`,
          externalId: String(externalId),
          title: 'M17.05 click-through fixture',
        });
      },
      { slug: SLUG, externalId: issueNumber },
    );

    // Panel slides in with the seeded issue's title + number.
    const panel = page.getByTestId('office-desk-detail');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('M17.05 click-through fixture');
    await expect(panel).toContainText(`#${issueNumber}`);

    // "Open full detail" routes to the per-item detail page.
    await page.getByTestId('office-open-detail').click();
    await expect(page).toHaveURL(new RegExp(`/projects/${SLUG}/items/${issueNumber}(?:[/?#]|$)`));

    // Back to the Office tab; close the panel via the X button this time.
    // (Escape works in the real browser but Phaser's keyboard manager
    // captures the keypress when its canvas has focus, swallowing it
    // before the window listener fires in the test environment.)
    await page.goto(`/projects/${SLUG}/office`);
    await page.waitForSelector('[data-testid="office-canvas"]');
    await page.waitForTimeout(1_000);
    await page.evaluate(
      ({ slug, externalId }) => {
        interface SceneShape {
          events_(): { emit(event: string, payload: unknown): void };
        }
        const scene = (window as unknown as { __officeScene?: SceneShape }).__officeScene;
        if (!scene) throw new Error('window.__officeScene is not exposed');
        scene.events_().emit('desk-click', {
          projectSlug: slug,
          workItemId: `mock:${externalId}`,
          externalId: String(externalId),
          title: 'M17.05 click-through fixture',
        });
      },
      { slug: SLUG, externalId: issueNumber },
    );
    await expect(page.getByTestId('office-desk-detail')).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByTestId('office-desk-detail')).toBeHidden();
  });
});
