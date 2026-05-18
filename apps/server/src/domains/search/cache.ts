import type { WorkItem } from '@goose-hub/core/state-source/interface.js';

// Process-lifetime, per-slug+milestone, TTL-bounded cache for the
// listOpenWork / listClosedWorkByMilestone fan-out. Every search request
// otherwise hits GitHub for each registered project; a single 60s window
// is enough to coalesce bursty typing without making results feel stale.

const TTL_MS = 60_000;

interface Entry {
  expires: number;
  items: WorkItem[];
}

const store = new Map<string, Entry>();

function keyFor(
  slug: string,
  kind: 'open' | 'closed',
  milestoneNumber: number | undefined,
): string {
  return `${slug}::${kind}::${milestoneNumber ?? 'all'}`;
}

export async function cachedListOpenWork(
  slug: string,
  milestoneNumber: number | undefined,
  load: () => Promise<WorkItem[]>,
  now: number = Date.now(),
): Promise<WorkItem[]> {
  return readOrFill(keyFor(slug, 'open', milestoneNumber), load, now);
}

export async function cachedListClosedByMilestone(
  slug: string,
  milestoneNumber: number,
  load: () => Promise<WorkItem[]>,
  now: number = Date.now(),
): Promise<WorkItem[]> {
  return readOrFill(keyFor(slug, 'closed', milestoneNumber), load, now);
}

async function readOrFill(
  key: string,
  load: () => Promise<WorkItem[]>,
  now: number,
): Promise<WorkItem[]> {
  const cached = store.get(key);
  if (cached != null && cached.expires > now) return cached.items;
  const items = await load();
  store.set(key, { expires: now + TTL_MS, items });
  return items;
}

/** Test-only: wipe the cache between cases. */
export function _resetSearchCache(): void {
  store.clear();
}
