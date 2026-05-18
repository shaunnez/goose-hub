import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Seed } from './types.js';

const TARGET = 'core/findings/priority.ts';

const ORIGINAL_BLOCK = `export function defaultQaPriority(severity: 'error' | 'warning' | 'info'): Priority {
  switch (severity) {
    case 'error':
      return 'P1';
    case 'warning':
      return 'P2';
    case 'info':
      return 'P3';
  }
}`;

const MUTATED_BLOCK = `export function defaultQaPriority(severity: 'error' | 'warning' | 'info'): Priority {
  switch (severity) {
    case 'error':
      return 'P1';
    case 'warning':
      return 'P3';
    case 'info':
      return 'P3';
  }
}`;

async function readTarget(root: string): Promise<{ full: string; src: string }> {
  const full = path.join(root, TARGET);
  const src = await fs.readFile(full, 'utf8');
  return { full, src };
}

export const seed: Seed = {
  id: 'backend-002-qa-priority-mapping',
  description: 'defaultQaPriority demotes warning to P3 (should be P2)',
  area: 'backend',
  truthSignal: {
    testFile: 'core/findings/priority.test.ts',
    testName: 'promotes error → P1, warning → P2, info → P3',
  },
  issue: {
    title: 'QA warnings are being scored as P3 instead of P2',
    body: `Warnings emitted by the QA holdout are being classified as P3 (nit / informational) when they should be classified as P2 (notable issue). The per-cycle quality score formula uses these priorities to compute point deductions; treating warnings the same as info-level notes under-counts their impact on the score.

Errors map correctly to P1 and info maps correctly to P3 — only the warning bucket is wrong.

**Expected:** a QA finding with \`severity: "warning"\` (and no explicit \`priority\`) defaults to \`P2\`.
**Actual:** the same finding defaults to \`P3\`, equivalent to a nit-level info note.

This is the default-priority mapping used when an agent emits a finding without setting \`priority\` explicitly.`,
    labels: ['type:bug', 'priority:medium', 'factory:triaging'],
  },
  async apply(root) {
    const { full, src } = await readTarget(root);
    if (src.includes(MUTATED_BLOCK) && !src.includes(ORIGINAL_BLOCK)) {
      throw new Error(`backend-002 apply: seed already applied to ${TARGET}`);
    }
    if (!src.includes(ORIGINAL_BLOCK)) {
      throw new Error(
        `backend-002 apply: expected block not found in ${TARGET}. The file has drifted from the seed authoring point — update the seed before re-running.`,
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
        `backend-002 restore: ${TARGET} is in an unexpected state — neither the original nor the mutated block is present.`,
      );
    }
    await fs.writeFile(full, src.replace(MUTATED_BLOCK, ORIGINAL_BLOCK), 'utf8');
  },
  async isApplied(root) {
    const { src } = await readTarget(root);
    return src.includes(MUTATED_BLOCK) && !src.includes(ORIGINAL_BLOCK);
  },
};
