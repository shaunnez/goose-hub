import { db } from '@goose-hub/core/db/db.js';
import { wpIterations } from '@goose-hub/core/db/schema.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import type { EngineeringSpec } from '@goose-hub/skills/spec-author/schema.js';
import { and, desc, eq } from 'drizzle-orm';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WpDispatchResult {
  wpId: string;
  status: 'ok' | 'failed' | 'timeout';
  commitSha?: string;
  errorReason?: string;
  runId: string;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

export function recordWpIteration(
  runId: string,
  wpId: string,
  iteration: number,
  status: 'in-progress' | 'ok' | 'failed',
  errorReason?: string,
): void {
  db.insert(wpIterations)
    .values({ runId, wpId, iteration, status, errorReason: errorReason ?? null })
    .onConflictDoUpdate({
      target: [wpIterations.runId, wpIterations.wpId, wpIterations.iteration],
      set: { status, errorReason: errorReason ?? null },
    })
    .run();
}

export function getLastWpStatus(runId: string, wpId: string): 'ok' | 'failed' | 'in-progress' | null {
  const rows = db
    .select()
    .from(wpIterations)
    .where(and(eq(wpIterations.runId, runId), eq(wpIterations.wpId, wpId)))
    .orderBy(desc(wpIterations.iteration))
    .limit(1)
    .all();
  return (rows[0]?.status as 'ok' | 'failed' | 'in-progress' | null) ?? null;
}

// ─── Concurrency primitives ───────────────────────────────────────────────────

export async function runWithConcurrencyCap<T, R>(
  items: T[],
  cap: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(cap, items.length));
  const workers: Promise<void>[] = [];
  for (let w = 0; w < workerCount; w++) {
    workers.push(
      (async (): Promise<void> => {
        while (true) {
          const idx = next++;
          if (idx >= items.length) return;
          const item = items[idx];
          if (item === undefined) return;
          results[idx] = await fn(item, idx);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return results;
}

// ─── PR body ─────────────────────────────────────────────────────────────────

export function buildParallelPrBody(opts: {
  workItem: WorkItem;
  spec: EngineeringSpec;
  wpResults: WpDispatchResult[];
}): string {
  const wpChangelog = opts.wpResults
    .map((r) => {
      const wp = opts.spec.workPackages.find((w) => w.id === r.wpId);
      const status = r.status === 'ok' ? '✓' : '✗';
      return `- ${status} **${r.wpId}**: ${wp?.changes.slice(0, 120) ?? '(unknown)'}`;
    })
    .join('\n');

  return `## Summary

${opts.workItem.title}

## Work Packages

${wpChangelog}

Closes #${opts.workItem.externalId}
`;
}
