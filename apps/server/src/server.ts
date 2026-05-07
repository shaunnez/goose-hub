import { logger } from '@goose-hub/core/logger.js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bootstrapRouter } from './domains/bootstrap/router.js';
import { costsRouter } from './domains/costs/router.js';
import { eventsRouter } from './domains/events/router.js';
import { inboxRouter } from './domains/inbox/router.js';
import { issuesRouter } from './domains/issues/router.js';
import { milestonesRouter } from './domains/milestones/router.js';
import { playbooksRouter } from './domains/playbooks/router.js';
import { projectsRouter } from './domains/projects/router.js';
import { rosterRouter } from './domains/roster/router.js';
import { webhooksRouter } from './domains/webhooks/router.js';
import { workflowsRouter } from './domains/workflows/router.js';

const app = new Hono();
app.use('*', cors());
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  logger.info('request', {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    ms: Date.now() - start,
  });
});

app.route('/', projectsRouter); // GET /health, GET /projects
app.route('/projects', milestonesRouter); // GET/POST /projects/:slug/milestones/**, /active-milestone
app.route('/projects', issuesRouter); // GET/POST /projects/:slug/issues/**
app.route('/projects', workflowsRouter); // POST /projects/:slug/tick
app.route('/projects', costsRouter); // GET /projects/:slug/costs/summary, /projects/:slug/issues/:id/costs
app.route('/projects', playbooksRouter); // GET/POST /projects/:slug/playbooks (M11.12)
app.route('/projects', bootstrapRouter); // POST /projects/bootstrap/{preview,run} (M12.07)
app.route('/inbox', inboxRouter); // GET/POST /inbox/**
app.route('/roster', rosterRouter); // GET /roster/**
app.route('/events', eventsRouter); // GET /events
app.route('/webhooks', webhooksRouter); // POST /webhooks/github

export { app };
