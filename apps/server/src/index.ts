import { resolve } from 'node:path';
import { config } from 'dotenv';
config({ path: resolve(import.meta.dirname, '../../../.env') });

import { logger } from '@goose-hub/core/logger.js';
import { serve } from '@hono/node-server';
import { app } from './server.js';

if (process.env.VITEST == null) {
  if (process.env.GITHUB_WEBHOOK_SECRET == null || process.env.GITHUB_WEBHOOK_SECRET.length === 0) {
    throw new Error('GITHUB_WEBHOOK_SECRET env var is required to start the server');
  }
  const port = Number(process.env.PORT ?? 3001);
  serve({ fetch: app.fetch, port });
  logger.info('server started', { port });
}
