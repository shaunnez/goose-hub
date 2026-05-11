// core/audit/nightly-scheduler.ts
// Nightly trigger for `code-quality-audit` (M19.22, #698).
//
// One interval per registered project, firing once every
// `AUDIT_NIGHTLY_INTERVAL_MS` (default 24 h). The audit runs against the
// project's cloned target repository (`targetRepo.localPath`), persists an
// `audit_score` row to `run_quality_scores`, and emits up to three
// ImprovementCandidates.
//
// The first tick is delayed by `firstDelayMs` so a server restart doesn't
// fire audits across every project simultaneously. Errors thrown by the
// audit are caught and logged; they never affect any other project's tick.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../logger.js';
import type { ProjectConfig } from '../types.js';
import { runCodeQualityAudit } from './run-audit.js';

const HOURS = 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 24 * HOURS;

export interface NightlyAuditScheduler {
  /** Stop all per-project nightly timers. */
  stop(): void;
}

export interface StartNightlyAuditSchedulerOpts {
  /** Override the default 24h interval (test seam). */
  intervalMs?: number;
  /** Delay before the first tick fires. Default 0. */
  firstDelayMs?: number;
  /** Test seam — swap out the audit invocation. */
  runAudit?: typeof runCodeQualityAudit;
}

function resolveLocalPath(localPath: string): string {
  if (localPath.startsWith('~')) return join(homedir(), localPath.slice(2));
  return localPath;
}

/**
 * Start nightly audit timers for the supplied projects. Returns a stop
 * handle. Idempotent across restarts because the synthetic `pipelineRunId`
 * embeds the calendar date — re-running on the same day overwrites the row
 * rather than duplicating it.
 */
export function startNightlyAuditScheduler(
  projects: ProjectConfig[],
  opts: StartNightlyAuditSchedulerOpts = {},
): NightlyAuditScheduler {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const runAudit = opts.runAudit ?? runCodeQualityAudit;
  const timers: ReturnType<typeof setInterval>[] = [];

  const fire = (project: ProjectConfig): void => {
    const worktreePath = resolveLocalPath(project.targetRepo.localPath);
    if (!existsSync(worktreePath)) {
      logger.warn('nightly audit skipped — localPath missing', {
        slug: project.slug,
        worktreePath,
      });
      return;
    }
    runAudit({
      projectId: project.slug,
      worktreePath,
      trigger: 'nightly',
      mode: project.mode,
    }).catch((err: unknown) => {
      logger.error('nightly audit failed', { slug: project.slug, error: String(err) });
    });
  };

  const firstDelayMs = opts.firstDelayMs ?? 0;
  for (const project of projects) {
    const kickoff = setTimeout(() => {
      fire(project);
      const timer = setInterval(() => fire(project), intervalMs);
      timers.push(timer);
    }, firstDelayMs);
    timers.push(kickoff as unknown as ReturnType<typeof setInterval>);
    logger.info('nightly audit scheduler armed', {
      slug: project.slug,
      intervalHours: intervalMs / HOURS,
      firstDelayMs,
    });
  }

  return {
    stop() {
      for (const t of timers) clearInterval(t);
      timers.length = 0;
      logger.info('nightly audit scheduler stopped');
    },
  };
}
