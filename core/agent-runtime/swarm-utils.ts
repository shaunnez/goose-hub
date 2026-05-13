import type { AgentEvent, AppendEventInput } from '../event-stream/store.js';

export class ScoutTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`scout timed out after ${timeoutMs}ms`);
    this.name = 'ScoutTimeoutError';
  }
}

export function runWithDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new ScoutTimeoutError(timeoutMs));
    }, timeoutMs);
    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Bounded-concurrency map: dispatches up to `cap` scouts at a time. Order of
 * results matches order of `items`.
 */
export async function runWithConcurrencyCap<T, R>(
  items: T[],
  cap: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers: Promise<void>[] = [];
  const workerCount = Math.max(1, Math.min(cap, items.length));
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

export interface HeartbeatHandle {
  stop(): void;
}

export interface StartHeartbeatOptions {
  intervalMs: number;
  parentRunId: string;
  projectId: string;
  workItemId?: string;
  scoutCount: number;
  append: (input: AppendEventInput) => AgentEvent;
}

export function startHeartbeat(opts: StartHeartbeatOptions): HeartbeatHandle {
  const interval = setInterval(() => {
    opts.append({
      projectId: opts.projectId,
      workItemId: opts.workItemId ?? null,
      kind: 'swarm.heartbeat',
      payload: { parentRunId: opts.parentRunId, scoutCount: opts.scoutCount },
      runId: opts.parentRunId,
    });
  }, opts.intervalMs);
  // Allow process to exit naturally if the parent forgets to stop us.
  if (typeof interval.unref === 'function') interval.unref();
  return {
    stop: () => clearInterval(interval),
  };
}
