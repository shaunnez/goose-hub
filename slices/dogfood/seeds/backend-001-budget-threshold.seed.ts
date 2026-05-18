import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Seed } from './types.js';

const TARGET = 'apps/server/src/shared/budget.ts';

const ORIGINAL_BLOCK = `  const usage = await getDailyUsage(projectId);
  if (limitTokens > 0 && usage.totalTokens >= limitTokens) {
    return { exceeded: true, reason: 'daily-tokens', usage, limitTokens };
  }`;

const MUTATED_BLOCK = `  const usage = await getDailyUsage(projectId);
  if (limitTokens > 0 && usage.totalTokens > limitTokens) {
    return { exceeded: true, reason: 'daily-tokens', usage, limitTokens };
  }`;

async function readTarget(root: string): Promise<{ full: string; src: string }> {
  const full = path.join(root, TARGET);
  const src = await fs.readFile(full, 'utf8');
  return { full, src };
}

export const seed: Seed = {
  id: 'backend-001-budget-threshold',
  description: 'daily-budget exceeded check is off-by-one (uses > instead of >=)',
  area: 'backend',
  truthSignal: {
    testFile: 'apps/server/src/shared/budget.test.ts',
    testName: 'returns exceeded=true with reason when daily token limit is reached',
  },
  issue: {
    title: 'Daily budget alarm does not fire when usage lands exactly on the limit',
    body: `A project that hits its daily token budget *exactly* — for example, a 500,000-token limit with 500,000 tokens used today — is not flagged as exceeded. The orchestrator continues to dispatch new runs on the same project.

The off-by-one was discovered after a project blew past its intended cap by a few thousand tokens because the boundary case was treated as "still under". Projects that exceed the limit by a comfortable margin behave correctly; projects that land exactly on the threshold do not.

**Expected:** \`exceeded\` is \`true\` when today's total tokens are *equal to or greater than* the configured limit.
**Actual:** \`exceeded\` is only \`true\` when today's total tokens are *strictly greater than* the configured limit. Hitting the limit exactly is treated as still-under.`,
    labels: ['type:bug', 'priority:high', 'factory:triaging'],
  },
  async apply(root) {
    const { full, src } = await readTarget(root);
    if (src.includes(MUTATED_BLOCK) && !src.includes(ORIGINAL_BLOCK)) {
      throw new Error(`backend-001 apply: seed already applied to ${TARGET}`);
    }
    if (!src.includes(ORIGINAL_BLOCK)) {
      throw new Error(
        `backend-001 apply: expected block not found in ${TARGET}. The file has drifted from the seed authoring point — update the seed before re-running.`,
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
        `backend-001 restore: ${TARGET} is in an unexpected state — neither the original nor the mutated block is present.`,
      );
    }
    await fs.writeFile(full, src.replace(MUTATED_BLOCK, ORIGINAL_BLOCK), 'utf8');
  },
  async isApplied(root) {
    const { src } = await readTarget(root);
    return src.includes(MUTATED_BLOCK) && !src.includes(ORIGINAL_BLOCK);
  },
};
