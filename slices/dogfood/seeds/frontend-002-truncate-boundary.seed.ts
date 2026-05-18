import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Seed } from './types.js';

const TARGET = 'apps/web/src/lib/utils.ts';

const ORIGINAL_BLOCK = `export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return \`\${value.slice(0, Math.max(0, max - 1)).trimEnd()}…\`;
}`;

const MUTATED_BLOCK = `export function truncate(value: string, max: number): string {
  if (value.length < max) return value;
  return \`\${value.slice(0, Math.max(0, max - 1)).trimEnd()}…\`;
}`;

async function readTarget(root: string): Promise<{ full: string; src: string }> {
  const full = path.join(root, TARGET);
  const src = await fs.readFile(full, 'utf8');
  return { full, src };
}

export const seed: Seed = {
  id: 'frontend-002-truncate-boundary',
  description: 'truncate cuts strings that already fit (off-by-one on the boundary check)',
  area: 'frontend',
  truthSignal: {
    testFile: 'apps/web/src/lib/utils.test.ts',
    testName: 'returns string unchanged when at exactly max length',
  },
  issue: {
    title: 'Truncation adds an ellipsis to strings that already fit the limit',
    body: `Strings whose length is exactly the configured maximum are being truncated and shown with an ellipsis, even though they fit. For example, a label that's allowed up to 5 characters is rendered as \`hell…\` when the actual content is \`hello\` — which is exactly 5 characters and should be left alone.

This affects card titles and other UI labels where the truncation helper is used. Shorter strings (under the max) render correctly; only strings sitting precisely on the boundary are wrong.

**Expected:** a string whose length equals \`max\` renders unchanged, no ellipsis.
**Actual:** a string whose length equals \`max\` is shortened and gets an ellipsis appended.`,
    labels: ['type:bug', 'priority:medium', 'factory:triaging'],
  },
  async apply(root) {
    const { full, src } = await readTarget(root);
    if (src.includes(MUTATED_BLOCK) && !src.includes(ORIGINAL_BLOCK)) {
      throw new Error(`frontend-002 apply: seed already applied to ${TARGET}`);
    }
    if (!src.includes(ORIGINAL_BLOCK)) {
      throw new Error(
        `frontend-002 apply: expected block not found in ${TARGET}. The file has drifted from the seed authoring point — update the seed before re-running.`,
      );
    }
    await fs.writeFile(full, src.replace(ORIGINAL_BLOCK, MUTATED_BLOCK), 'utf8');
  },
  async restore(root) {
    const { full, src } = await readTarget(root);
    if (src.includes(ORIGINAL_BLOCK) && !src.includes(MUTATED_BLOCK)) {
      return;
    }
    if (!src.includes(MUTATED_BLOCK)) {
      throw new Error(
        `frontend-002 restore: ${TARGET} is in an unexpected state — neither the original nor the mutated block is present.`,
      );
    }
    await fs.writeFile(full, src.replace(MUTATED_BLOCK, ORIGINAL_BLOCK), 'utf8');
  },
  async isApplied(root) {
    const { src } = await readTarget(root);
    return src.includes(MUTATED_BLOCK) && !src.includes(ORIGINAL_BLOCK);
  },
};
