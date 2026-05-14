/**
 * Office Mode texture-load smoke test — used by the asset generation loop.
 *
 * For every entry in `pngManifest()` whose PNG actually exists under
 * `apps/web/public/office/`, this test boots the Office scene and asserts
 * Phaser loaded that texture by key. It also fails on any console error
 * coming out of the scene (proves no Phaser load errors fired).
 *
 * The loop runs this after each generation batch:
 *   pnpm --filter @goose-hub/web exec playwright test \
 *     --config playwright-e2e-pipeline.config.ts office-texture-load.spec.ts
 *
 * Iteration model:
 *   - asset-manifest.md `[ ]` -> `[x]` only flips after this passes.
 *   - Missing/zero-byte PNGs on disk are skipped silently — they cover the
 *     legacy entries that were never re-generated. The loop's job is to
 *     drive new entries to passing.
 *
 * MOCK_* envs come from playwright-e2e-pipeline.config.ts (MOCK_AGENTS,
 * MOCK_OPEN_PR, MOCK_SOURCE, MOCK_BOOTSTRAP). No real GitHub token needed.
 */

import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { pngManifest } from '../../src/components/office/game/asset-loader';

const SLUG = 'goose-hub-self';
const PUBLIC_OFFICE_DIR = resolve(import.meta.dirname, '..', '..', 'public');
const OUT_DIR = resolve(import.meta.dirname, '..', '..', 'test-results', 'office-texture-load');
mkdirSync(OUT_DIR, { recursive: true });

interface ManifestEntry {
  key: string;
  url: string;
}

function existingOnDisk(): ManifestEntry[] {
  return pngManifest().filter((entry) => {
    const filePath = resolve(PUBLIC_OFFICE_DIR, entry.url.replace(/^\//, ''));
    try {
      return statSync(filePath).size > 0;
    } catch {
      return false;
    }
  });
}

test.describe('Office Mode — asset generation loop validator', () => {
  test('every pngManifest entry whose PNG exists on disk is loaded by Phaser', async ({ page }) => {
    const expected = existingOnDisk();
    expect
      .soft(expected.length, 'no PNGs on disk yet — loop has nothing to validate')
      .toBeGreaterThan(0);

    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`/projects/${SLUG}/office`);
    await page.waitForSelector('[data-testid="office-canvas"]', { timeout: 20_000 });
    await page.waitForFunction(
      () => (window as unknown as { __officeScene?: unknown }).__officeScene != null,
      null,
      { timeout: 20_000 },
    );
    // Let asset-loader's HEAD-probe + Phaser load settle.
    await page.waitForTimeout(2_000);

    const keys = expected.map((e) => e.key);
    const results = await page.evaluate((keysToCheck) => {
      interface TexturesShape {
        exists?(k: string): boolean;
      }
      interface SceneShape {
        textures?: TexturesShape;
      }
      const scene = (window as unknown as { __officeScene?: SceneShape }).__officeScene;
      if (scene?.textures == null) return null;
      return keysToCheck.map((k) => ({ key: k, loaded: scene.textures?.exists?.(k) === true }));
    }, keys);

    expect(results, 'window.__officeScene.textures was not reachable').not.toBeNull();
    const missing = (results ?? []).filter((r) => !r.loaded).map((r) => r.key);
    expect(missing, `Phaser did not load these texture keys: ${missing.join(', ')}`).toEqual([]);

    await page.screenshot({
      path: resolve(OUT_DIR, `scene-${new Date().toISOString().replace(/[:.]/g, '-')}.png`),
      fullPage: false,
    });

    // Phaser logs to console.error on load failures; treat those as fatal.
    const phaserLoadErrors = errors.filter((e) =>
      /Failed to process file|Failed to load resource/i.test(e),
    );
    expect(phaserLoadErrors, `Phaser load errors: ${phaserLoadErrors.join(' | ')}`).toEqual([]);
  });
});
