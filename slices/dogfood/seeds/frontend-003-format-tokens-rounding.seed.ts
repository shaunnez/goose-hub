import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Seed } from './types.js';

const TARGET = 'apps/web/src/lib/utils.ts';

const ORIGINAL_BLOCK = `/** Formats large token counts as e.g. "1.2k", "464k", "1.3M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return \`\${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k\`;
  return \`\${(n / 1_000_000).toFixed(1)}M\`;
}`;

const MUTATED_BLOCK = `/** Formats large token counts as e.g. "1.2k", "464k", "1.3M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return \`\${(n / 1000).toFixed(0)}k\`;
  return \`\${(n / 1_000_000).toFixed(1)}M\`;
}`;

async function readTarget(root: string): Promise<{ full: string; src: string }> {
  const full = path.join(root, TARGET);
  const src = await fs.readFile(full, 'utf8');
  return { full, src };
}

export const seed: Seed = {
  id: 'frontend-003-format-tokens-rounding',
  description: 'formatTokens drops the decimal in the 1k–10k range (always rounds to whole-k)',
  area: 'frontend',
  truthSignal: {
    testFile: 'apps/web/src/lib/utils.test.ts',
    testName: 'shows decimal-k under 10k',
  },
  issue: {
    title: 'Token counts in the 1k–10k range render without a decimal place',
    body: `Token counters in the 1,000–9,999 range are being shown as whole-k values when they should keep one decimal place.

For example, a count of 1,234 tokens is rendered as \`1k\` when it should be \`1.2k\`. The decimal is what makes it possible to distinguish 1,234 from 1,800 at a glance.

Counters under 1,000 (raw count) and at 10,000+ (whole-k) render correctly. The bug is isolated to the under-10k decimal-k branch.

**Expected:** \`1234\` renders as \`1.2k\` (one decimal place).
**Actual:** \`1234\` renders as \`1k\`.`,
    labels: ['type:bug', 'priority:low', 'factory:triaging'],
  },
  async apply(root) {
    const { full, src } = await readTarget(root);
    if (src.includes(MUTATED_BLOCK) && !src.includes(ORIGINAL_BLOCK)) {
      throw new Error(`frontend-003 apply: seed already applied to ${TARGET}`);
    }
    if (!src.includes(ORIGINAL_BLOCK)) {
      throw new Error(
        `frontend-003 apply: expected block not found in ${TARGET}. The file has drifted from the seed authoring point — update the seed before re-running.`,
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
        `frontend-003 restore: ${TARGET} is in an unexpected state — neither the original nor the mutated block is present.`,
      );
    }
    await fs.writeFile(full, src.replace(MUTATED_BLOCK, ORIGINAL_BLOCK), 'utf8');
  },
  async isApplied(root) {
    const { src } = await readTarget(root);
    return src.includes(MUTATED_BLOCK) && !src.includes(ORIGINAL_BLOCK);
  },
};
