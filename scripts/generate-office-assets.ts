#!/usr/bin/env tsx
/**
 * Generate the Office tab pixel-art asset bundle via the PixelLab REST API.
 *
 * Usage:
 *   PIXELLAB_API_KEY=<key> pnpm gen:office-assets
 *   # or, if your key is in .env (recommended):
 *   pnpm gen:office-assets
 *
 * The script writes PNGs into `apps/web/public/office/`. The Phaser scene
 * (apps/web/src/components/office/game/asset-loader.ts) prefers these PNGs
 * over the procedural fallback at runtime, so re-running the script is a
 * safe, idempotent quality upgrade.
 *
 * Sandbox / no-network environments: skip running this — the Office tab
 * works without it via the procedural fallback. Run locally when your
 * machine has outbound HTTPS to api.pixellab.ai.
 *
 * Manifest is intentionally narrow (~11 assets) so a full run completes in
 * under a minute and stays inside hobby-tier credit budgets.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

loadDotenv();

const API_BASE = 'https://api.pixellab.ai/v1';
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '..', 'apps', 'web', 'public', 'office');

interface AssetSpec {
  /** Output filename in apps/web/public/office/ — must match asset-loader.ts. */
  file: string;
  /** Pixel-flux text prompt. */
  prompt: string;
  /** Square dimension in pixels. */
  size: 16 | 24 | 32 | 48 | 64;
}

const MANIFEST: AssetSpec[] = [
  // Tiles
  {
    file: 'floor-tile.png',
    prompt: 'top-down dark purple office carpet tile, seamless, pixel art, 16x16',
    size: 16,
  },
  {
    file: 'floor-tile-alt.png',
    prompt: 'top-down dark indigo office carpet tile, slightly lighter, seamless, pixel art, 16x16',
    size: 16,
  },
  {
    file: 'wall-tile.png',
    prompt: 'top-down purple office wall tile with shadow at base, pixel art, 16x16',
    size: 16,
  },
  // Furniture
  {
    file: 'desk.png',
    prompt: 'top-down pixel art office desk with monitor showing blue screen, brown wood, 32x24',
    size: 32,
  },
  {
    file: 'stairs.png',
    prompt: 'top-down pixel art staircase with wooden steps and dark rail, isometric hint, 32x32',
    size: 32,
  },
  // Indicators (speech / thought / question / coffee / bang / check)
  {
    file: 'indicator-speech.png',
    prompt: 'pixel art white speech bubble with three small black dots, 14x16, transparent bg',
    size: 16,
  },
  {
    file: 'indicator-thought.png',
    prompt: 'pixel art white cloud thought bubble with trailing dot, 14x16, transparent bg',
    size: 16,
  },
  {
    file: 'indicator-question.png',
    prompt: 'pixel art white speech bubble with bold black question mark, 14x16, transparent bg',
    size: 16,
  },
  {
    file: 'indicator-coffee.png',
    prompt: 'pixel art white coffee mug with steam wisps, brown coffee inside, 14x14, transparent bg',
    size: 16,
  },
  {
    file: 'indicator-bang.png',
    prompt: 'pixel art red warning triangle with white exclamation mark, 14x14, transparent bg',
    size: 16,
  },
  {
    file: 'indicator-check.png',
    prompt: 'pixel art green circle with white checkmark, 14x14, transparent bg',
    size: 16,
  },
];

async function generate(spec: AssetSpec, apiKey: string): Promise<Uint8Array> {
  // Pixflux endpoint per https://www.pixellab.ai/docs/tools/create-image-flux
  const res = await fetch(`${API_BASE}/generate-image-pixflux`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      description: spec.prompt,
      image_size: { width: spec.size, height: spec.size },
      no_background: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PixelLab API ${res.status} for ${spec.file}: ${text}`);
  }
  const json = (await res.json()) as { image?: { base64?: string }; image_base64?: string };
  const b64 = json.image?.base64 ?? json.image_base64;
  if (b64 == null) throw new Error(`PixelLab response missing image for ${spec.file}`);
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

async function main(): Promise<void> {
  const apiKey = process.env.PIXELLAB_API_KEY;
  if (apiKey == null || apiKey.length === 0) {
    console.error('Set PIXELLAB_API_KEY (in .env or shell) — get a key at https://api.pixellab.ai/mcp');
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Generating ${MANIFEST.length} assets into ${OUT_DIR}`);
  for (const spec of MANIFEST) {
    process.stdout.write(`  ${spec.file} … `);
    try {
      const bytes = await generate(spec, apiKey);
      await writeFile(resolve(OUT_DIR, spec.file), bytes);
      console.log(`${bytes.byteLength} bytes`);
    } catch (err) {
      console.log(`FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log('Done. Restart the dev server to pick up new assets.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
