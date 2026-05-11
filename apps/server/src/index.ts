import { resolve } from 'node:path';
import { config } from 'dotenv';
config({ path: resolve(import.meta.dirname, '../../../.env') });

import { startNightlyAuditScheduler } from '@goose-hub/core/audit/nightly-scheduler.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { logger } from '@goose-hub/core/logger.js';
import { loadProjects } from '@goose-hub/core/projects/loader.js';
import { startPerProjectScheduler } from '@goose-hub/core/projects/scheduler.js';
import { serve } from '@hono/node-server';
import { runTriageBatch } from './domains/workflows/triage-batch.js';
import { app } from './server.js';

if (process.env.VITEST == null) {
  const closed = eventStore.closeOrphanedRuns();
  if (closed > 0) {
    logger.info('startup: closed orphaned agent runs', { count: closed });
  }
  if (process.env.GITHUB_WEBHOOK_SECRET == null || process.env.GITHUB_WEBHOOK_SECRET.length === 0) {
    throw new Error('GITHUB_WEBHOOK_SECRET env var is required to start the server');
  }
  const port = Number(process.env.PORT ?? 3001);
  serve({ fetch: app.fetch, port });
  logger.info('server started', { port });

  loadProjects()
    .then((projects) => {
      startPerProjectScheduler(projects, (slug) => runTriageBatch(slug));
      logger.info('per-project tick scheduler started', { projects: projects.map((p) => p.slug) });
      // Nightly code-quality-audit (#698). Delays first fire by 60s so a
      // server restart doesn't hammer every project at boot time.
      startNightlyAuditScheduler(projects, { firstDelayMs: 60_000 });
    })
    .catch((err: unknown) => {
      logger.error('failed to start per-project tick scheduler', { error: String(err) });
    });
}
