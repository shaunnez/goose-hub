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
  /** Intended in-game texture size. PixelLab requests are clamped to its 32x32 minimum. */
  width: number;
  height: number;
}

export const MANIFEST: AssetSpec[] = [
  // Tiles
  {
    file: 'floor-tile.png',
    prompt: 'top-down office carpet tile colour #3A3D5C dark slate-blue, seamless, pixel art, 16x16',
    width: 16,
    height: 16,
  },
  {
    file: 'floor-tile-alt.png',
    prompt: 'top-down office carpet tile colour #42466A slightly lighter slate-blue, seamless, pixel art, 16x16',
    width: 16,
    height: 16,
  },
  {
    file: 'wall-tile.png',
    prompt: 'top-down office wall tile colour #2B2D42 dark navy with shadow at base, pixel art, 16x16',
    width: 16,
    height: 16,
  },
  // Furniture
  {
    file: 'desk.png',
    prompt: 'top-down pixel art office desk wood #6B4F3B with monitor showing cyan #6FE7FF screen glow, 32x24',
    width: 32,
    height: 24,
  },
  {
    file: 'stairs.png',
    prompt: 'top-down pixel art staircase wooden steps #85694F with dark rail #6B4F3B, isometric hint, 32x32',
    width: 32,
    height: 32,
  },
  // Sprite
  {
    file: 'sprite.png',
    prompt: 'top-down pixel art office goose character neutral pose, body colour #3B3D55, skin #85694F, 12x16, transparent bg',
    width: 16,
    height: 16,
  },
  // Indicators
  {
    file: 'indicator-speech.png',
    prompt: 'pixel art speech bubble colour #F2CC8F amber with three dark #2B2D42 dots, 14x16, transparent bg',
    width: 14,
    height: 16,
  },
  {
    file: 'indicator-thought.png',
    prompt: 'pixel art cloud thought bubble colour #F2CC8F amber with trailing dot, outline #2B2D42, 14x16, transparent bg',
    width: 14,
    height: 16,
  },
  {
    file: 'indicator-question.png',
    prompt: 'pixel art speech bubble #F2CC8F amber with bold #2B2D42 question mark, 14x16, transparent bg',
    width: 14,
    height: 16,
  },
  {
    file: 'indicator-coffee.png',
    prompt: 'pixel art coffee mug #F2CC8F amber with steam wisps, brown coffee #6B4F3B inside, 14x14, transparent bg',
    width: 14,
    height: 14,
  },
  {
    file: 'indicator-bang.png',
    prompt: 'pixel art red #FF6B6B warning triangle with #F2CC8F exclamation mark, outline #2B2D42, 14x14, transparent bg',
    width: 14,
    height: 14,
  },
  {
    file: 'indicator-check.png',
    prompt: 'pixel art green #8BD17C circle with #F2CC8F checkmark, outline #2B2D42, 14x14, transparent bg',
    width: 14,
    height: 14,
  },
  // Ticket variants
  {
    file: 'ticket.png',
    prompt: 'pixel art work ticket card #F2CC8F amber body with #473A55 priority strip, outline #85694F, 14x10, transparent bg',
    width: 14,
    height: 16,
  },
  {
    file: 'queue-stack-many.png',
    prompt: 'pixel art stack of 4 staggered #F2CC8F amber cards with #85694F outlines, 20x16, transparent bg',
    width: 20,
    height: 16,
  },
  {
    file: 'ticket-glow.png',
    prompt: 'pixel art glowing halo #F2CC8F amber rounded rect glow effect, 20x16, transparent bg',
    width: 20,
    height: 16,
  },
  {
    file: 'ticket-scroll.png',
    prompt: 'pixel art parchment scroll #F2CC8F amber with dark #6B4F3B rolled ends and text lines, 10x16, transparent bg',
    width: 10,
    height: 16,
  },
  {
    file: 'ticket-envelope.png',
    prompt: 'pixel art envelope #F2CC8F amber with V-flap and #6FE7FF cyan wax seal dot, 14x10, transparent bg',
    width: 14,
    height: 16,
  },
  // Phase 2.5 wall variants
  {
    file: 'wall-frosted-blue.png',
    prompt: 'top-down office wall tile #3F6B80 teal with subtle #6FE7FF cyan frost, pixel art, 16x16',
    width: 16,
    height: 16,
  },
  {
    file: 'wall-frosted-grey.png',
    prompt: 'top-down office wall tile #3B3D55 muted blue-grey with shadow at base, pixel art, 16x16',
    width: 16,
    height: 16,
  },
  {
    file: 'scout-desk.png',
    prompt: 'top-down pixel art scout desk wood #6B4F3B with #6FE7FF cyan monitor and #F2CC8F report on surface, 32x24',
    width: 32,
    height: 24,
  },
];

function pixellabImageSize(spec: AssetSpec): { width: number; height: number } {
  return {
    width: Math.max(spec.width, 32),
    height: Math.max(spec.height, 32),
  };
}

async function generate(spec: AssetSpec, apiKey: string): Promise<Uint8Array> {
  const imageSize = pixellabImageSize(spec);
  // Pixflux endpoint per https://www.pixellab.ai/docs/tools/create-image-flux
  const res = await fetch(`${API_BASE}/generate-image-pixflux`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      description: spec.prompt,
      image_size: imageSize,
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

// Only run when invoked directly (not when imported as a module in tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
