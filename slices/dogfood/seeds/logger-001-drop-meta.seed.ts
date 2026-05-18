import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Seed } from './types.js';

const TARGET = 'apps/web/src/lib/logger.ts';

const ORIGINAL_BLOCK = `function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const prefix = \`[goose-hub:\${level}]\`;
  if (meta != null) {
    console[level === 'debug' ? 'log' : level](prefix, message, meta);
  } else {
    console[level === 'debug' ? 'log' : level](prefix, message);
  }
}`;

const MUTATED_BLOCK = `function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const prefix = \`[goose-hub:\${level}]\`;
  console[level === 'debug' ? 'log' : level](prefix, message);
}`;

async function readTarget(root: string): Promise<{ full: string; src: string }> {
  const full = path.join(root, TARGET);
  const src = await fs.readFile(full, 'utf8');
  return { full, src };
}

export const seed: Seed = {
  id: 'logger-001-drop-meta',
  description: 'logger drops the meta argument when forwarding to console',
  area: 'frontend',
  truthSignal: {
    testFile: 'apps/web/src/lib/logger.test.ts',
    testName: 'includes meta when provided',
  },
  issue: {
    title: 'Logger drops metadata when called with extra context',
    body: `When code calls a logger method with a second argument — for example \`logger.error('something broke', { code: 42 })\` — the metadata object never reaches the console output. Only the prefix and message come through.

This makes debugging painful because structured context (error codes, request IDs, user IDs, anything we attach as meta) gets silently dropped on the floor.

**Expected:** the meta object should appear alongside the prefix and message in console output, for all four log levels (\`debug\`, \`info\`, \`warn\`, \`error\`).

**Actual:** only the prefix and message reach the console. The meta object is dropped.`,
    labels: ['type:bug', 'priority:medium', 'factory:triaging'],
  },
  async apply(root) {
    const { full, src } = await readTarget(root);
    if (src.includes(MUTATED_BLOCK) && !src.includes(ORIGINAL_BLOCK)) {
      throw new Error(`logger-001 apply: seed already applied to ${TARGET}`);
    }
    if (!src.includes(ORIGINAL_BLOCK)) {
      throw new Error(
        `logger-001 apply: expected block not found in ${TARGET}. The file has drifted from the seed authoring point — update the seed before re-running.`,
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
        `logger-001 restore: ${TARGET} is in an unexpected state — neither the original nor the mutated block is present.`,
      );
    }
    await fs.writeFile(full, src.replace(MUTATED_BLOCK, ORIGINAL_BLOCK), 'utf8');
  },
  async isApplied(root) {
    const { src } = await readTarget(root);
    return src.includes(MUTATED_BLOCK) && !src.includes(ORIGINAL_BLOCK);
  },
};
