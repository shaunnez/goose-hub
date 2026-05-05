import { logger } from '../logger.js';
import type { ProjectConfig } from '../types.js';

const DEFAULT_TICK_INTERVAL_SECONDS = 60;

export interface ProjectScheduler {
  /** Stop all per-project tick timers. */
  stop(): void;
}

/**
 * Start one independent setInterval tick loop per registered project.
 *
 * Each project's interval fires at `project.tickIntervalSeconds ?? 60` seconds.
 * Errors thrown by `tickFn` for project A are caught and logged; they never
 * prevent project B's timer from firing. The caller is responsible for any
 * per-project locking inside `tickFn` (dispatch.ts handles this via its
 * per-slug in-flight sets).
 */
export function startPerProjectScheduler(
  projects: ProjectConfig[],
  tickFn: (slug: string) => Promise<void>,
): ProjectScheduler {
  const timers = new Map<string, ReturnType<typeof setInterval>>();

  for (const project of projects) {
    const intervalMs = (project.tickIntervalSeconds ?? DEFAULT_TICK_INTERVAL_SECONDS) * 1000;

    const timer = setInterval(() => {
      tickFn(project.slug).catch((err: unknown) => {
        logger.error('per-project tick failed', { slug: project.slug, error: String(err) });
      });
    }, intervalMs);

    timers.set(project.slug, timer);
    logger.info('tick scheduler started', {
      slug: project.slug,
      intervalSeconds: project.tickIntervalSeconds ?? DEFAULT_TICK_INTERVAL_SECONDS,
    });
  }

  return {
    stop() {
      for (const [slug, timer] of timers) {
        clearInterval(timer);
        logger.info('tick scheduler stopped', { slug });
      }
      timers.clear();
    },
  };
}
